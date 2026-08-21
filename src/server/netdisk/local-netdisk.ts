import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { WorkBook } from "xlsx";
import type { CompanyIndustryRecord, CompanyScoreRecord, DataSourceStatus, DataSourceSyncJob, EnvironmentalAspectScore, EsgRatingRecord, EvidenceItem, FinancialYearRecord, NetdiskPdfDocumentInput, PdfDocumentRecord, PdfPageBlock, SampleGroup, SourceFieldCatalog, SourceFileRecord, ViolationEvent } from "@/types";
import { loadSqliteSnapshot, pdfDerivedSummary, persistFullSnapshot, persistPdfState, type SqliteSnapshot } from "./sqlite-store";
import { normalizeStockCode } from "./identity";
import { buildCompanyIdentityCandidates, CURRENT_EVIDENCE_EXTRACTOR_VERSION, extractDocumentEvidence as extractResolvedDocumentEvidence, fallbackCompanyName, resolveDocumentIdentity } from "./evidence-extractor";
import {
  isMockDataMode,
  mockDataSourceStatus,
  mockEsgRatings,
  mockFinancialRecord,
  mockIndustries,
  mockPdfDocuments,
  mockRecordSummary,
  mockSourceFiles,
  mockViolationEvents,
} from "@/server/analysis/mock-server-data";

const rootEnvName = "GREENLENS_SOURCE_DIR";
const workbookExtensions = new Set([".xlsx", ".xls"]);
const financeFields = { Stkcd: "stockCode", ShortName: "companyName", Accper: "fiscalPeriodEnd", Typrep: "reportType", Source: "sourceType", F011201A: "assetLiabilityRatio", F050201B: "roaA", A001000000: "totalAssets" } as const;
const violationFields: Record<string, string> = {
  "\u8fdd\u89c4\u4e8b\u4ef6ID": "id", "\u8bc1\u5238\u4ee3\u7801": "stockCode", "\u8bc1\u5238\u7b80\u79f0": "companyName", "\u8fdd\u89c4\u5e74\u5ea6": "violationYears", "\u516c\u544a\u65e5\u671f": "announcementDate", "\u8fdd\u89c4\u7c7b\u578b": "violationTypes", "\u8fdd\u89c4\u884c\u4e3a": "behavior", "\u5904\u5206\u63aa\u65bd": "action", "\u5904\u7f5a\u603b\u91d1\u989d": "totalPenalty", "\u5904\u7f5a\u91d1\u989d(\u4e0a\u5e02\u516c\u53f8)": "companyPenalty", "\u4e0e\u4e0a\u5e02\u516c\u53f8\u5173\u7cfb": "relation", "\u8fdd\u89c4\u4e3b\u4f53\u540d\u79f0": "subjectName",
  "\u516c\u793a\u65f6\u95f4": "announcementDate", "\u5904\u7406\u5bf9\u8c61": "subjectName", "\u5173\u8054\u5173\u7cfb": "relation", "\u6807\u9898": "title", "\u53d1\u751f\u65e5\u671f": "occurrenceDate", "\u5904\u7406\u673a\u6784": "authority", "\u5904\u7406\u7c7b\u578b": "violationTypes", "\u5904\u7406\u539f\u56e0": "reason", "\u64cd\u4f5c": "action",
};
const companyScoreFields: Record<string, string> = {
  stock_code: "stockCode", company_short: "companyName", year: "reportYear", company: "sourceLabel",
  sample_group: "sampleGroup", include_n_ge_10: "includeNGe10", include_n_ge_20: "includeNGe20",
  analysis_scope: "analysisScope", text_length: "textLength", n_all_sentences: "nAllSentences",
  n_environmental_sentences: "nEnvironmentalSentences", EASS: "EASS", IR: "IR", UPR: "UPR",
  sentiment_raw: "sentimentRaw", sentiment_norm: "sentimentNorm", sustainability_raw: "sustainabilityRaw",
  sustainability_norm: "sustainabilityNorm", ESGSI_raw: "esgsiRaw", ESGSI_norm: "esgsiNorm",
  EAA_ESI_raw: "eaaEsiRaw", EAA_ESI_norm: "eaaEsiNorm", base_risk: "baseRisk",
  flag_high_esgsi: "flagHighEsgsi", flag_low_eass: "flagLowEass", flag_high_ir: "flagHighIr",
  flag_high_upr: "flagHighUpr", red_flags: "redFlags", risk_level: "riskLevel",
  low_sentence_count_flag: "lowSentenceCountFlag", recommended_use: "recommendedUse",
  years_available: "yearsAvailable", first_year: "firstYear", last_year: "lastYear",
  duplicate_count: "duplicateCount", selected_for_panel: "selectedForPanel", selection_note: "selectionNote",
  quality_flags: "qualityFlags", report_year_text_check: "reportYearTextCheck", code_source: "codeSource",
  source_file: "sourceFileOriginal", source_sheet: "sourceSheet", source_row: "sourceRow",
};
const companyIndustryFields: Record<string, string> = {
  stock_code: "stockCode", report_year: "reportYear", industry_code: "industryCode",
  industry_name: "industryName", industry_group: "industryGroup", source: "source", quality_flag: "qualityFlag",
};
const esgRatingFields: Record<string, string> = {
  vendor: "vendor", stock_code: "stockCode", company_name: "companyName", report_year: "reportYear",
  rating: "rating", score: "score", e_score: "eScore", s_score: "sScore", g_score: "gScore",
  score_scale: "scoreScale",
};

type SheetRow = Record<string, unknown>;
export interface NetdiskIngestFile { fsid: string; filename: string; size: number; md5?: string; rows: SheetRow[]; }
interface StoredPdfDocument extends PdfDocumentRecord { pages: PdfPageBlock[]; }
interface RuntimeStore { files: SourceFileRecord[]; catalogs: Map<string, SourceFieldCatalog>; financialRecords: FinancialYearRecord[]; companyScores: CompanyScoreRecord[]; companyIndustries: CompanyIndustryRecord[]; esgRatings: EsgRatingRecord[]; violationEvents: ViolationEvent[]; pdfDocuments: StoredPdfDocument[]; documentEvidence: EvidenceItem[]; environmentalAspects: EnvironmentalAspectScore[]; syncJobs: Map<string, DataSourceSyncJob>; lastSyncedAt?: string; }
interface PersistedStore { files: SourceFileRecord[]; catalogs: Array<[string, SourceFieldCatalog]>; financialRecords: FinancialYearRecord[]; companyScores?: CompanyScoreRecord[]; companyIndustries?: CompanyIndustryRecord[]; esgRatings?: EsgRatingRecord[]; violationEvents: ViolationEvent[]; pdfDocuments?: StoredPdfDocument[]; documentEvidence?: EvidenceItem[]; environmentalAspects?: EnvironmentalAspectScore[]; lastSyncedAt?: string; }
const runtime = globalThis as typeof globalThis & { __greenlensNetdiskStore?: RuntimeStore };
const require = createRequire(import.meta.url);
type XlsxModule = typeof import("xlsx");
let xlsxModule: XlsxModule | undefined;
function xlsx(): XlsxModule {
  return xlsxModule ??= require("xlsx") as XlsxModule;
}
function restoredStore(): RuntimeStore {
  try {
    const saved = loadSqliteSnapshot() as unknown as PersistedStore;
    return { ...saved, companyScores: saved.companyScores ?? [], companyIndustries: saved.companyIndustries ?? [], esgRatings: saved.esgRatings ?? [], pdfDocuments: saved.pdfDocuments ?? [], documentEvidence: saved.documentEvidence ?? [], environmentalAspects: saved.environmentalAspects ?? [], catalogs: new Map(saved.catalogs), syncJobs: new Map() };
  } catch {
    return { files: [], catalogs: new Map(), financialRecords: [], companyScores: [], companyIndustries: [], esgRatings: [], violationEvents: [], pdfDocuments: [], documentEvidence: [], environmentalAspects: [], syncJobs: new Map() };
  }
}
function activeStore(): RuntimeStore {
  if (!runtime.__greenlensNetdiskStore) {
    const restored = restoredStore();
    restored.companyScores ??= [];
    restored.companyIndustries ??= [];
    restored.esgRatings ??= [];
    restored.pdfDocuments ??= [];
    restored.documentEvidence ??= [];
    restored.environmentalAspects ??= [];
    runtime.__greenlensNetdiskStore = restored;
  }
  return runtime.__greenlensNetdiskStore;
}

// Importing an API route must not deserialize the complete SQLite snapshot.
// Existing callers keep the same property-based interface and initialize only
// when a non-Dashboard workflow actually touches the in-memory store.
const store = new Proxy({} as RuntimeStore, {
  get: (_target, property) => Reflect.get(activeStore(), property),
  set: (_target, property, value) => Reflect.set(activeStore(), property, value),
});

function sourceRoot() {
  const configured = process.env[rootEnvName];
  if (!configured) throw new Error(`${rootEnvName} is not configured.`);
  const root = path.resolve(/* turbopackIgnore: true */ configured);
  if (!existsSync(root)) throw new Error(`${rootEnvName} does not exist.`);
  return root;
}
function sourceId(value: string) { return createHash("sha256").update(value).digest("hex").slice(0, 24); }
function text(value: unknown) { return String(value ?? "").trim(); }
function number(value: unknown) { if (typeof value === "number" && Number.isFinite(value)) return value; const raw = text(value); if (!raw) return null; const parsed = Number(raw.replace(/,/g, "").replace(/%$/, "")); return Number.isFinite(parsed) ? raw.endsWith("%") ? parsed / 100 : parsed : null; }
function stockCode(value: unknown) { return normalizeStockCode(value); }
function date(value: unknown) { if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10); const match = text(value).match(/(\d{4})[-/.\u5e74](\d{1,2})[-/.\u6708](\d{1,2})/); return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : null; }
function years(value: unknown) { return [...new Set((text(value).match(/(?:19|20)\d{2}/g) ?? []).map(Number))].sort((a, b) => a - b); }
function split(value: unknown) { return text(value).split(/[;,\uFF1B\uFF0C\u3001]/).filter(Boolean); }
function classify(relativePath: string): SourceFileRecord["kind"] { const lower = relativePath.toLowerCase(); if (lower.endsWith(".zip")) return "archive"; if (/industry|\u884c\u4e1a/.test(lower)) return "company_industry_workbook"; if (/score|eaa_esi/.test(lower)) return "company_score_workbook"; if (/rating|\u8bc4\u7ea7/.test(lower)) return "esg_rating_workbook"; if (/\u8d22\u52a1|\u8d44\u4ea7|roa|finance|financial/.test(lower)) return "financial_workbook"; if (/\u8fdd\u89c4|\u5904\u7f5a|\u8fdd\u6cd5/.test(lower)) return "violation_workbook"; if (/\u8d1f\u9762|negative/.test(lower)) return "negative_news"; if (/esg|\u73af\u5883|\u53ef\u6301\u7eed/.test(lower)) return "esg_report"; return "unknown"; }
function knownHeaderCount(row: unknown[]) { return row.filter((value) => { const field = text(value); return field in financeFields || field in violationFields || field in companyScoreFields || field in companyIndustryFields || field in esgRatingFields; }).length; }

function inferPdfIdentity(input: NetdiskPdfDocumentInput, documentId = input.documentId ?? sourceId(`remote-pdf:${input.fsid}:${input.filename}`)) {
  const resolution = resolveDocumentIdentity({
    documentId, filename: input.filename, kind: input.kind, textMode: input.textMode, pages: input.pages,
    stockCode: input.stockCode, companyName: input.companyName, reportYear: input.reportYear,
  }, buildCompanyIdentityCandidates(store.companyScores));
  return {
    stockCode: resolution.resolvedStockCode ?? undefined,
    companyId: resolution.resolvedCompanyId ?? undefined,
    companyName: resolution.alternativeCandidates[0]?.companyName ?? (fallbackCompanyName(input.filename) || undefined),
    reportYear: resolution.reportYear ?? undefined,
    publicationDate: resolution.publicationDate ?? undefined,
    resolution,
  };
}

function extractDocumentEvidence(document: StoredPdfDocument) {
  const identity = inferPdfIdentity(document, document.id);
  if (document.kind === "negative_news") {
    const evidence = document.pages.flatMap((page) => {
      const code = page.text.match(/(?<!\d)(\d{6})(?!\d)/)?.[1] ?? identity.stockCode;
      const reportYear = page.text.match(/(?:19|20)\d{2}/)?.[0] ?? (identity.reportYear ? String(identity.reportYear) : undefined);
      if (!code || !reportYear) return [];
      return [{ id: sourceId(`${document.id}:${page.page}:${code}`), companyId: `stock-${code}`, reportYear: Number(reportYear), type: "external" as const, title: "External review signal", excerpt: page.text.slice(0, 500), page: page.page, sourceLabel: document.filename, status: "pending" as const }];
    });
    return { evidence, aspects: [] as EnvironmentalAspectScore[] };
  }
  if (identity.resolution.status !== "resolved") return { evidence: [] as EvidenceItem[], aspects: [] as EnvironmentalAspectScore[] };
  return extractResolvedDocumentEvidence({
    document: { documentId: document.id, filename: document.filename, kind: document.kind, textMode: document.textMode, pages: document.pages, stockCode: document.stockCode, companyName: document.companyName, reportYear: document.reportYear, publicationDate: document.publicationDate },
    identity: identity.resolution,
    extractorVersion: CURRENT_EVIDENCE_EXTRACTOR_VERSION,
  });
}
function sheetRows(workbook: WorkBook) {
  const XLSX = xlsx();
  return workbook.SheetNames.flatMap((sheetName) => {
    const values = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: null, blankrows: false });
    const headerIndex = values.slice(0, 5).reduce((best, row, index) => knownHeaderCount(row) > knownHeaderCount(values[best] ?? []) ? index : best, 0);
    const headers = values[headerIndex]?.map(text) ?? [];
    return values.slice(headerIndex + 1).map((valueRow) => Object.fromEntries(headers.flatMap((header, index) => header ? [[header, valueRow[index] ?? null]] : [])));
  });
}
function catalog(sourceFileId: string, workbook: WorkBook): SourceFieldCatalog {
  const XLSX = xlsx();
  const fields: SourceFieldCatalog["fields"] = [];
  workbook.SheetNames.forEach((sheetName) => {
    const values = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: null, blankrows: false });
    const headerIndex = values.slice(0, 5).reduce((best, row, index) => knownHeaderCount(row) > knownHeaderCount(values[best] ?? []) ? index : best, 0);
    values[headerIndex]?.map(text).filter(Boolean).forEach((sourceField) => {
      const targetField = financeFields[sourceField as keyof typeof financeFields] ?? violationFields[sourceField] ?? companyScoreFields[sourceField] ?? companyIndustryFields[sourceField] ?? esgRatingFields[sourceField];
      const dataType = ["assetLiabilityRatio", "roaA", "totalAssets", "totalPenalty", "companyPenalty", "EASS", "IR", "UPR", "sentimentRaw", "sentimentNorm", "sustainabilityRaw", "sustainabilityNorm", "esgsiRaw", "esgsiNorm", "eaaEsiRaw", "eaaEsiNorm", "textLength", "nAllSentences", "nEnvironmentalSentences", "redFlags", "yearsAvailable", "firstYear", "lastYear", "duplicateCount", "sourceRow", "reportYear", "score", "eScore", "sScore", "gScore"].includes(targetField ?? "") ? "number" : ["fiscalPeriodEnd", "announcementDate", "occurrenceDate"].includes(targetField ?? "") ? "date" : targetField ? "string" : "unknown";
      fields.push({ sourceField, targetField, dataType, required: ["stockCode", "fiscalPeriodEnd", "announcementDate", "violationYears", "reportYear", "vendor"].includes(targetField ?? ""), status: targetField ? "mapped" : "unmapped" });
    });
  });
  return { sourceFileId, fields };
}
function catalogRows(sourceFileId: string, rows: SheetRow[]): SourceFieldCatalog {
  const fields: SourceFieldCatalog["fields"] = [];
  [...new Set(rows.flatMap((row) => Object.keys(row)))].forEach((sourceField) => {
    const targetField = financeFields[sourceField as keyof typeof financeFields] ?? violationFields[sourceField] ?? companyScoreFields[sourceField] ?? companyIndustryFields[sourceField] ?? esgRatingFields[sourceField];
    const dataType = ["assetLiabilityRatio", "roaA", "totalAssets", "totalPenalty", "companyPenalty", "EASS", "IR", "UPR", "sentimentRaw", "sentimentNorm", "sustainabilityRaw", "sustainabilityNorm", "esgsiRaw", "esgsiNorm", "eaaEsiRaw", "eaaEsiNorm", "textLength", "nAllSentences", "nEnvironmentalSentences", "redFlags", "yearsAvailable", "firstYear", "lastYear", "duplicateCount", "sourceRow", "reportYear", "score", "eScore", "sScore", "gScore"].includes(targetField ?? "") ? "number" : ["fiscalPeriodEnd", "announcementDate", "occurrenceDate"].includes(targetField ?? "") ? "date" : targetField ? "string" : "unknown";
    fields.push({ sourceField, targetField, dataType, required: ["stockCode", "fiscalPeriodEnd", "announcementDate", "violationYears", "reportYear", "vendor"].includes(targetField ?? ""), status: targetField ? "mapped" : "unmapped" });
  });
  return { sourceFileId, fields };
}
function hasTargets(schema: SourceFieldCatalog, expected: string[]) { const targets = new Set(schema.fields.flatMap((field) => field.targetField ? [field.targetField] : [])); return expected.every((field) => targets.has(field)); }
function getByTarget(row: SheetRow, target: string) { const key = Object.keys(row).find((column) => violationFields[column] === target); return key ? row[key] : undefined; }
function scoreByTarget(row: SheetRow, target: string) { const key = Object.keys(row).find((column) => companyScoreFields[column] === target); return key ? row[key] : undefined; }

function violationEvent(source: SourceFileRecord, row: SheetRow, rowIndex: number): ViolationEvent | null {
  const code = stockCode(getByTarget(row, "stockCode"));
  const announced = date(getByTarget(row, "announcementDate"));
  const occurred = date(getByTarget(row, "occurrenceDate"));
  const eventYears = years(getByTarget(row, "violationYears"));
  const resolvedYears = eventYears.length ? eventYears : [...new Set([announced, occurred].flatMap((value) => value ? [Number(value.slice(0, 4))] : []))];
  const violationTypes = split(getByTarget(row, "violationTypes"));
  if (!code || !announced || !resolvedYears.length || !violationTypes.length) return null;
  const totalPenalty = number(getByTarget(row, "totalPenalty"));
  const companyPenalty = number(getByTarget(row, "companyPenalty"));
  return { id: text(getByTarget(row, "id")) || `${source.id}:${rowIndex}`, companyId: `stock-${code}`, stockCode: code, companyName: text(getByTarget(row, "companyName")) || code, violationYears: resolvedYears, announcementDate: announced, occurrenceDate: occurred ?? undefined, violationTypes, title: text(getByTarget(row, "title")) || undefined, reason: text(getByTarget(row, "reason")) || undefined, behavior: text(getByTarget(row, "behavior")) || "UNSPECIFIED", action: text(getByTarget(row, "action")) || "UNSPECIFIED", authority: text(getByTarget(row, "authority")) || undefined, totalPenalty, companyPenalty, relation: text(getByTarget(row, "relation")) || undefined, subjectName: text(getByTarget(row, "subjectName")) || undefined, sourceLabel: source.filename, reviewStatus: "pending", qualityFlags: [...(eventYears.length ? [] : ["VIOLATION_YEAR_DERIVED_FROM_DATE"]), ...(totalPenalty == null ? ["TOTAL_PENALTY_MISSING"] : []), ...(companyPenalty == null ? ["COMPANY_PENALTY_MISSING"] : [])] };
}
function mergeViolationEvents(events: ViolationEvent[]) {
  const merged = new Map<string, ViolationEvent>();
  events.forEach((event) => {
    const explicitId = /^\d+$/.test(event.id);
    const key = explicitId ? `id:${event.id}` : `${event.stockCode}:${event.announcementDate}:${event.title ?? event.violationTypes.join("|")}:${event.subjectName ?? ""}`;
    const current = merged.get(key);
    if (!current) { merged.set(key, { ...event, violationYears: [...new Set(event.violationYears)].sort((a, b) => a - b), violationTypes: [...new Set(event.violationTypes)], qualityFlags: [...new Set(event.qualityFlags)] }); return; }
    merged.set(key, {
      ...current,
      ...event,
      violationYears: [...new Set([...current.violationYears, ...event.violationYears])].sort((a, b) => a - b),
      violationTypes: [...new Set([...current.violationTypes, ...event.violationTypes])],
      behavior: current.behavior.length >= event.behavior.length ? current.behavior : event.behavior,
      action: current.action.length >= event.action.length ? current.action : event.action,
      qualityFlags: [...new Set([...current.qualityFlags, ...event.qualityFlags])],
    });
  });
  return [...merged.values()];
}
function mergeFinancial(sourceRows: SheetRow[]): FinancialYearRecord[] {
  const records = new Map<string, FinancialYearRecord>();
  sourceRows.forEach((row) => {
    const code = stockCode(row.Stkcd); const fiscalPeriodEnd = date(row.Accper);
    if (!code || !fiscalPeriodEnd) return;
    const sourceType = text(row.Source) || "0";
    const key = `${code}:${fiscalPeriodEnd}:${text(row.Typrep)}:${sourceType}`;
    const record = records.get(key) ?? { id: `stock-${code}:financial:${fiscalPeriodEnd}`, companyId: `stock-${code}`, stockCode: code, companyName: text(row.ShortName) || code, fiscalPeriodEnd, reportYear: Number(fiscalPeriodEnd.slice(0, 4)), reportType: text(row.Typrep) || "annual", sourceType, assetLiabilityRatio: null, roaA: null, totalAssets: null, currency: "CNY", sourceFields: { assetLiabilityRatio: "F011201A", roaA: "F050201B", totalAssets: "A001000000" }, qualityFlags: [] } satisfies FinancialYearRecord;
    if (row.F011201A !== undefined) record.assetLiabilityRatio = number(row.F011201A);
    if (row.F050201B !== undefined) record.roaA = number(row.F050201B);
    if (row.A001000000 !== undefined) record.totalAssets = number(row.A001000000);
    records.set(key, record);
  });
  return [...records.values()].map((record) => ({ ...record, qualityFlags: [...(record.assetLiabilityRatio == null ? ["ASSET_LIABILITY_RATIO_MISSING"] : []), ...(record.roaA == null ? ["ROA_MISSING"] : []), ...(record.totalAssets == null ? ["TOTAL_ASSETS_MISSING"] : [])] }));
}
function scoreSheetRows(workbook: WorkBook): SheetRow[] {
  const XLSX = xlsx();
  const fullSheet = workbook.Sheets["Company-level scoring"] ?? workbook.Sheets["Company_level_scoring"] ?? workbook.Sheets["Company-level"];
  if (fullSheet) {
    const values = XLSX.utils.sheet_to_json<unknown[]>(fullSheet, { header: 1, defval: null, blankrows: false });
    const headerIndex = values.slice(0, 5).reduce((best, row, index) => knownHeaderCount(row) > knownHeaderCount(values[best] ?? []) ? index : best, 0);
    const headers = values[headerIndex]?.map(text) ?? [];
    return values.slice(headerIndex + 1).map((valueRow) => Object.fromEntries(headers.flatMap((header, index) => header ? [[header, valueRow[index] ?? null]] : [])));
  }
  return sheetRows(workbook);
}
function hasScoreTargets(schema: SourceFieldCatalog, filename: string) {
  const targets = new Set(schema.fields.flatMap((field) => field.targetField ? [field.targetField] : []));
  const codeSource = targets.has("stockCode") || targets.has("sourceLabel");
  const yearSource = targets.has("reportYear") || /(?:19|20)\d{2}/.test(filename);
  const metricSource = targets.has("eaaEsiRaw") || targets.has("esgsiRaw");
  return codeSource && yearSource && metricSource;
}
function companyScoreRecord(source: SourceFileRecord, row: SheetRow, rowIndex: number): CompanyScoreRecord | null {
  const sourceLabel = text(scoreByTarget(row, "sourceLabel"));
  const code = stockCode(scoreByTarget(row, "stockCode")) ?? sourceLabel.match(/(?<!\d)(\d{6})(?!\d)/)?.[0] ?? null;
  const explicitYear = number(scoreByTarget(row, "reportYear"));
  const filenameYear = source.filename.match(/(?:19|20)\d{2}/)?.[0];
  const titleYear = sourceLabel.match(/(?:19|20)\d{2}\s*年度|年度[（(]?(?:19|20)\d{2}/)?.[0]?.match(/(?:19|20)\d{2}/)?.[0];
  const year = explicitYear ?? (filenameYear ? Number(filenameYear) : titleYear ? Number(titleYear) : null);
  if (!code || year == null || !Number.isInteger(year) || year < 2000 || year > 2100) return null;
  const nEnvironmental = number(scoreByTarget(row, "nEnvironmentalSentences")) ?? 0;
  const sampleGroup: SampleGroup = scoreByTarget(row, "sampleGroup") ? text(scoreByTarget(row, "sampleGroup")) as SampleGroup : nEnvironmental >= 20 ? "main_n_ge_20" : nEnvironmental >= 10 ? "robustness_n_10_19" : "low_n_lt_10";
  const numeric = (value: unknown) => number(value);
  const boolean = (value: unknown) => {
    if (typeof value === "boolean") return value;
    const raw = text(value).toLowerCase();
    return ["true", "1", "yes", "\u662f", "\u771f"].includes(raw);
  };
  const qualityFlags = split(scoreByTarget(row, "qualityFlags"));
  const duplicateCount = numeric(scoreByTarget(row, "duplicateCount"));
  return {
    id: sourceId(`score:${code}:${year}`),
    companyId: `stock-${code}`,
    stockCode: code,
    companyName: text(scoreByTarget(row, "companyName")) || code,
    reportYear: year,
    sourceLabel: text(scoreByTarget(row, "sourceLabel")) || `${code}_${year}`,
    sourceFile: text(scoreByTarget(row, "sourceFileOriginal")) || source.filename,
    sourceSheet: text(scoreByTarget(row, "sourceSheet")) || "Company-level scoring",
    sourceRow: Math.max(1, numeric(scoreByTarget(row, "sourceRow")) ?? rowIndex + 2),
    analysisScope: text(scoreByTarget(row, "analysisScope")) || (nEnvironmental >= 20 ? "Main analysis sample (n_environmental_sentences >= 20)" : nEnvironmental >= 10 ? "Robustness sample (n_environmental_sentences 10-19)" : "Low sentence-count sample (n_environmental_sentences < 10)"),
    sampleGroup,
    includeNGe10: boolean(scoreByTarget(row, "includeNGe10")) || nEnvironmental >= 10,
    includeNGe20: boolean(scoreByTarget(row, "includeNGe20")) || nEnvironmental >= 20,
    textLength: Math.max(0, numeric(scoreByTarget(row, "textLength")) ?? 0),
    nAllSentences: Math.max(0, numeric(scoreByTarget(row, "nAllSentences")) ?? 0),
    nEnvironmentalSentences: nEnvironmental,
    EASS: numeric(scoreByTarget(row, "EASS")),
    IR: numeric(scoreByTarget(row, "IR")),
    UPR: numeric(scoreByTarget(row, "UPR")),
    sentimentRaw: numeric(scoreByTarget(row, "sentimentRaw")),
    sentimentNorm: numeric(scoreByTarget(row, "sentimentNorm")),
    sustainabilityRaw: numeric(scoreByTarget(row, "sustainabilityRaw")),
    sustainabilityNorm: numeric(scoreByTarget(row, "sustainabilityNorm")),
    esgsiRaw: numeric(scoreByTarget(row, "esgsiRaw")),
    esgsiNorm: numeric(scoreByTarget(row, "esgsiNorm")),
    eaaEsiRaw: numeric(scoreByTarget(row, "eaaEsiRaw")),
    eaaEsiNorm: numeric(scoreByTarget(row, "eaaEsiNorm")),
    baseRisk: text(scoreByTarget(row, "baseRisk")),
    flagHighEsgsi: boolean(scoreByTarget(row, "flagHighEsgsi")),
    flagLowEass: boolean(scoreByTarget(row, "flagLowEass")),
    flagHighIr: boolean(scoreByTarget(row, "flagHighIr")),
    flagHighUpr: boolean(scoreByTarget(row, "flagHighUpr")),
    redFlags: Math.max(0, numeric(scoreByTarget(row, "redFlags")) ?? 0),
    riskLevel: text(scoreByTarget(row, "riskLevel")),
    lowSentenceCountFlag: boolean(scoreByTarget(row, "lowSentenceCountFlag")) || nEnvironmental < 10,
    recommendedUse: text(scoreByTarget(row, "recommendedUse")),
    yearsAvailable: numeric(scoreByTarget(row, "yearsAvailable")) ?? undefined,
    firstYear: numeric(scoreByTarget(row, "firstYear")) ?? undefined,
    lastYear: numeric(scoreByTarget(row, "lastYear")) ?? undefined,
    duplicateCount: duplicateCount == null ? 1 : Math.max(1, duplicateCount),
    selectedForPanel: scoreByTarget(row, "selectedForPanel") == null ? undefined : boolean(scoreByTarget(row, "selectedForPanel")),
    selectionNote: text(scoreByTarget(row, "selectionNote")) || undefined,
    qualityFlags,
    reportYearTextCheck: text(scoreByTarget(row, "reportYearTextCheck")) || undefined,
    codeSource: text(scoreByTarget(row, "codeSource")) || undefined,
    ingestedAt: source.discoveredAt,
  };
}
function mergeCompanyScores(sourceRows: CompanyScoreRecord[]): CompanyScoreRecord[] {
  const byKey = new Map<string, CompanyScoreRecord[]>();
  sourceRows.forEach((record) => {
    const key = `${record.stockCode}:${record.reportYear}`;
    const group = byKey.get(key) ?? [];
    group.push(record);
    byKey.set(key, group);
  });
  const rank = (record: CompanyScoreRecord) => (
    (record.selectedForPanel === true ? 0 : 8)
    + (record.sampleGroup === "main_n_ge_20" ? 0 : record.sampleGroup === "robustness_n_10_19" ? 3 : 6)
  );
  return [...byKey.values()].map((group) => {
    const sorted = [...group].sort((a, b) => rank(a) - rank(b) || b.nEnvironmentalSentences - a.nEnvironmentalSentences || a.sourceFile.localeCompare(b.sourceFile));
    const selected = { ...sorted[0], duplicateCount: Math.max(sorted[0].duplicateCount, group.length), selectionNote: sorted[0].selectionNote ?? (group.length > 1 ? "Best record selected from duplicate company-year rows." : undefined) };
    return selected;
  }).sort((a, b) => a.reportYear - b.reportYear || a.stockCode.localeCompare(b.stockCode));
}
function industryByTarget(row: SheetRow, target: string) { const key = Object.keys(row).find((column) => companyIndustryFields[column] === target); return key ? row[key] : undefined; }
function companyIndustryRecord(source: SourceFileRecord, row: SheetRow): CompanyIndustryRecord | null {
  const code = stockCode(industryByTarget(row, "stockCode"));
  const year = number(industryByTarget(row, "reportYear"));
  if (!code || year == null || !Number.isInteger(year) || year < 2000 || year > 2100) return null;
  const rawFlag = text(industryByTarget(row, "qualityFlag"));
  const qualityFlag: CompanyIndustryRecord["qualityFlag"] = rawFlag === "backfilled" ? "backfilled" : rawFlag === "unclassified" ? "unclassified" : "exact";
  return {
    id: sourceId(`industry:${code}:${year}`),
    companyId: `stock-${code}`,
    stockCode: code,
    reportYear: year,
    industryCode: text(industryByTarget(row, "industryCode")),
    industryName: text(industryByTarget(row, "industryName")),
    industryGroup: text(industryByTarget(row, "industryGroup")) || text(industryByTarget(row, "industryName")),
    source: text(industryByTarget(row, "source")) || source.filename,
    qualityFlag,
  };
}
function mergeCompanyIndustries(sourceRows: CompanyIndustryRecord[]): CompanyIndustryRecord[] {
  const byKey = new Map<string, CompanyIndustryRecord>();
  sourceRows.forEach((record) => {
    const key = `${record.stockCode}:${record.reportYear}`;
    if (!record.industryName && !record.industryGroup) return;
    const current = byKey.get(key);
    const rank = (item: CompanyIndustryRecord) => (item.qualityFlag === "exact" ? 0 : item.qualityFlag === "backfilled" ? 1 : 2);
    if (!current || rank(record) <= rank(current)) byKey.set(key, record);
  });
  return [...byKey.values()].sort((a, b) => a.reportYear - b.reportYear || a.stockCode.localeCompare(b.stockCode));
}
function ratingByTarget(row: SheetRow, target: string) { const key = Object.keys(row).find((column) => esgRatingFields[column] === target); return key ? row[key] : undefined; }
function esgRatingRecord(source: SourceFileRecord, row: SheetRow): EsgRatingRecord | null {
  const code = stockCode(ratingByTarget(row, "stockCode"));
  const year = number(ratingByTarget(row, "reportYear"));
  const vendor = text(ratingByTarget(row, "vendor"));
  if (!code || year == null || !Number.isInteger(year) || year < 2000 || year > 2100 || !vendor) return null;
  const rating = text(ratingByTarget(row, "rating"));
  const score = number(ratingByTarget(row, "score"));
  if (!rating && score == null) return null;
  return {
    id: sourceId(`esg-rating:${vendor}:${code}:${year}`),
    companyId: `stock-${code}`,
    vendor,
    stockCode: code,
    companyName: text(ratingByTarget(row, "companyName")) || code,
    reportYear: year,
    rating,
    score,
    eScore: number(ratingByTarget(row, "eScore")),
    sScore: number(ratingByTarget(row, "sScore")),
    gScore: number(ratingByTarget(row, "gScore")),
    scoreScale: text(ratingByTarget(row, "scoreScale")),
    sourceFile: source.filename,
    ingestedAt: source.discoveredAt,
  };
}
function mergeEsgRatings(sourceRows: EsgRatingRecord[]): EsgRatingRecord[] {
  const byKey = new Map<string, EsgRatingRecord>();
  sourceRows.forEach((record) => {
    const key = `${record.vendor}:${record.stockCode}:${record.reportYear}`;
    const current = byKey.get(key);
    const rank = (item: EsgRatingRecord) => (item.score == null ? 1 : 0);
    if (!current || rank(record) < rank(current)) byKey.set(key, record);
  });
  return [...byKey.values()].sort((a, b) => a.vendor.localeCompare(b.vendor) || a.reportYear - b.reportYear || a.stockCode.localeCompare(b.stockCode));
}
async function walk(current: string): Promise<string[]> { const entries = await readdir(current, { withFileTypes: true }); return (await Promise.all(entries.map((entry) => { const absolute = path.join(current, entry.name); return entry.isDirectory() ? walk(absolute) : Promise.resolve([absolute]); }))).flat(); }

export async function syncLocalNetdisk(pathPrefix?: string): Promise<DataSourceSyncJob> {
  const root = sourceRoot(); const prefix = pathPrefix?.replace(/^\/+/, "").replace(/\\/g, "/"); const discoveredAt = new Date().toISOString();
  const files: SourceFileRecord[] = await Promise.all((await walk(root)).filter((absolute) => !prefix || path.relative(root, absolute).replace(/\\/g, "/").startsWith(prefix)).map(async (absolute) => { const info = await stat(absolute); const relativePath = path.relative(root, absolute).replace(/\\/g, "/"); return { id: sourceId(relativePath), provider: "baidu_netdisk" as const, path: `/${relativePath}`, filename: path.basename(absolute), fsid: `local-${sourceId(relativePath)}`, size: info.size, kind: classify(relativePath), parseStatus: workbookExtensions.has(path.extname(absolute).toLowerCase()) ? "schema_pending" as const : "unsupported" as const, discoveredAt, modifiedAt: info.mtime.toISOString(), detectedFields: [], qualityFlags: [] }; }));
  const catalogs = new Map<string, SourceFieldCatalog>(); const financialRows: SheetRow[] = []; const violations: ViolationEvent[] = []; const scoreRows: CompanyScoreRecord[] = []; const industryRows: CompanyIndustryRecord[] = []; const ratingRows: EsgRatingRecord[] = [];
  for (const file of files) {
    if (!workbookExtensions.has(path.extname(file.filename).toLowerCase())) continue;
    try {
      const workbook = xlsx().readFile(path.join(root, file.path.slice(1)), { cellDates: true, raw: true }); const schema = catalog(file.id, workbook); catalogs.set(file.id, schema); file.detectedFields = schema.fields.map((field) => field.sourceField);
      if (file.kind === "financial_workbook") { if (!hasTargets(schema, ["stockCode", "companyName", "fiscalPeriodEnd"]) || !["F011201A", "F050201B", "A001000000"].some((field) => schema.fields.some((item) => item.sourceField === field))) file.qualityFlags.push("FINANCIAL_REQUIRED_FIELDS_MISSING"); else financialRows.push(...sheetRows(workbook)); }
      if (file.kind === "violation_workbook") { if (!hasTargets(schema, ["stockCode", "announcementDate", "violationTypes"])) file.qualityFlags.push("VIOLATION_REQUIRED_FIELDS_MISSING"); else violations.push(...sheetRows(workbook).flatMap((row, index) => { const event = violationEvent(file, row, index); return event ? [event] : []; })); }
      if (file.kind === "company_score_workbook") { if (!hasScoreTargets(schema, file.filename)) file.qualityFlags.push("SCORE_REQUIRED_FIELDS_MISSING"); else scoreSheetRows(workbook).forEach((row, index) => { const record = companyScoreRecord(file, row, index); if (record) scoreRows.push(record); }); }
      if (file.kind === "company_industry_workbook") { if (!hasTargets(schema, ["stockCode", "reportYear"])) file.qualityFlags.push("INDUSTRY_REQUIRED_FIELDS_MISSING"); else sheetRows(workbook).forEach((row) => { const record = companyIndustryRecord(file, row); if (record) industryRows.push(record); }); }
      if (file.kind === "esg_rating_workbook") { if (!hasTargets(schema, ["stockCode", "reportYear", "vendor"])) file.qualityFlags.push("RATING_REQUIRED_FIELDS_MISSING"); else sheetRows(workbook).forEach((row) => { const record = esgRatingRecord(file, row); if (record) ratingRows.push(record); }); }
      file.parseStatus = file.qualityFlags.length ? "schema_pending" : file.kind === "financial_workbook" || file.kind === "violation_workbook" || file.kind === "company_score_workbook" || file.kind === "company_industry_workbook" || file.kind === "esg_rating_workbook" ? "ready" : "schema_pending";
    } catch { file.parseStatus = "failed"; file.qualityFlags.push("WORKBOOK_READ_FAILED"); }
  }
  store.files = files; store.catalogs = catalogs; store.financialRecords = mergeFinancial(financialRows); store.companyScores = mergeCompanyScores(scoreRows); store.companyIndustries = mergeCompanyIndustries(industryRows); store.esgRatings = mergeEsgRatings(ratingRows); store.violationEvents = mergeViolationEvents(violations); store.lastSyncedAt = new Date().toISOString();
  const job: DataSourceSyncJob = { jobId: crypto.randomUUID(), provider: "baidu_netdisk", status: "completed", phase: "index", progress: 100, discoveredFileCount: files.length, readyFileCount: files.filter((file) => file.parseStatus === "ready").length }; store.syncJobs.set(job.jobId, job); return job;
}
export function ingestNetdiskRows(inputs: NetdiskIngestFile[], append = true): DataSourceSyncJob {
  const discoveredAt = new Date().toISOString(); const files: SourceFileRecord[] = []; const catalogs = new Map<string, SourceFieldCatalog>(); const financialRows: SheetRow[] = []; const violations: ViolationEvent[] = []; const scoreRows: CompanyScoreRecord[] = []; const industryRows: CompanyIndustryRecord[] = []; const ratingRows: EsgRatingRecord[] = [];
  for (const input of inputs) {
    const id = sourceId(`remote:${input.fsid}:${input.filename}`); const file: SourceFileRecord = { id, provider: "baidu_netdisk", path: `/remote/${input.filename}`, filename: input.filename, fsid: input.fsid, md5: input.md5, size: input.size, kind: classify(input.filename), parseStatus: "schema_pending", discoveredAt, detectedFields: [], qualityFlags: [] };
    const schema = catalogRows(id, input.rows); catalogs.set(id, schema); file.detectedFields = schema.fields.map((field) => field.sourceField);
    if (file.kind === "unknown" && hasTargets(schema, ["stockCode", "announcementDate", "violationTypes"])) file.kind = "violation_workbook";
    if (file.kind === "unknown" && hasTargets(schema, ["stockCode", "companyName", "fiscalPeriodEnd"])) file.kind = "financial_workbook";
    if (file.kind === "unknown" && hasScoreTargets(schema, input.filename)) file.kind = "company_score_workbook";
    if (file.kind === "unknown" && hasTargets(schema, ["stockCode", "reportYear", "industryName"])) file.kind = "company_industry_workbook";
    if (file.kind === "unknown" && hasTargets(schema, ["stockCode", "reportYear", "vendor"])) file.kind = "esg_rating_workbook";
    if (file.kind === "financial_workbook") { if (!hasTargets(schema, ["stockCode", "companyName", "fiscalPeriodEnd"]) || !["F011201A", "F050201B", "A001000000"].some((field) => schema.fields.some((item) => item.sourceField === field))) file.qualityFlags.push("FINANCIAL_REQUIRED_FIELDS_MISSING"); else input.rows.forEach((row) => financialRows.push(row)); }
    if (file.kind === "violation_workbook") { if (!hasTargets(schema, ["stockCode", "announcementDate", "violationTypes"])) file.qualityFlags.push("VIOLATION_REQUIRED_FIELDS_MISSING"); else input.rows.forEach((row, index) => { const event = violationEvent(file, row, index); if (event) violations.push(event); }); }
    if (file.kind === "company_score_workbook") { if (!hasScoreTargets(schema, file.filename)) file.qualityFlags.push("SCORE_REQUIRED_FIELDS_MISSING"); else input.rows.forEach((row, index) => { const record = companyScoreRecord(file, row, index); if (record) scoreRows.push(record); }); }
    if (file.kind === "company_industry_workbook") { if (!hasTargets(schema, ["stockCode", "reportYear"])) file.qualityFlags.push("INDUSTRY_REQUIRED_FIELDS_MISSING"); else input.rows.forEach((row) => { const record = companyIndustryRecord(file, row); if (record) industryRows.push(record); }); }
    if (file.kind === "esg_rating_workbook") { if (!hasTargets(schema, ["stockCode", "reportYear", "vendor"])) file.qualityFlags.push("RATING_REQUIRED_FIELDS_MISSING"); else input.rows.forEach((row) => { const record = esgRatingRecord(file, row); if (record) ratingRows.push(record); }); }
    file.parseStatus = file.qualityFlags.length ? "schema_pending" : file.kind === "financial_workbook" || file.kind === "violation_workbook" || file.kind === "company_score_workbook" || file.kind === "company_industry_workbook" || file.kind === "esg_rating_workbook" ? "ready" : "schema_pending"; files.push(file);
  }
  const existingFinancialRows = append ? store.financialRecords.map((record) => ({ Stkcd: record.stockCode, ShortName: record.companyName, Accper: record.fiscalPeriodEnd, Typrep: record.reportType, Source: record.sourceType === "baidu_netdisk_local_sync" ? "0" : record.sourceType, F011201A: record.assetLiabilityRatio, F050201B: record.roaA, A001000000: record.totalAssets })) : [];
  store.files = append ? [...store.files.filter((existing) => !files.some((file) => file.id === existing.id)), ...files] : files;
  if (append) catalogs.forEach((catalog, id) => store.catalogs.set(id, catalog)); else store.catalogs = catalogs;
  store.financialRecords = mergeFinancial([...existingFinancialRows, ...financialRows]); store.companyScores = mergeCompanyScores(append ? [...store.companyScores, ...scoreRows] : scoreRows); store.companyIndustries = mergeCompanyIndustries(append ? [...store.companyIndustries, ...industryRows] : industryRows); store.esgRatings = mergeEsgRatings(append ? [...store.esgRatings, ...ratingRows] : ratingRows); store.violationEvents = mergeViolationEvents(append ? [...store.violationEvents, ...violations] : violations); store.lastSyncedAt = discoveredAt;
  const job: DataSourceSyncJob = { jobId: crypto.randomUUID(), provider: "baidu_netdisk", status: "completed", phase: "index", progress: 100, discoveredFileCount: files.length, readyFileCount: files.filter((file) => file.parseStatus === "ready").length }; store.syncJobs.set(job.jobId, job); return job;
}

export function ingestNetdiskPdfDocuments(inputs: NetdiskPdfDocumentInput[], append = true): DataSourceSyncJob {
  const ingestedAt = new Date().toISOString();
  const documents = inputs.map((input): StoredPdfDocument => {
    const identity = inferPdfIdentity(input);
    const qualityFlags = [
      ...(input.textMode === "ocr_required" ? ["PDF_OCR_REQUIRED"] : []),
      ...(input.textMode === "mixed" ? ["PDF_PARTIAL_TEXT_LAYER"] : []),
      ...(!identity.stockCode ? ["COMPANY_CODE_UNRESOLVED"] : []),
      ...(!identity.reportYear ? ["REPORT_YEAR_UNRESOLVED"] : []),
    ];
    return {
      id: input.documentId ?? sourceId(`remote-pdf:${input.fsid}:${input.filename}`), provider: "baidu_netdisk", fsid: input.fsid,
      filename: input.filename, size: input.size, md5: input.md5, kind: input.kind, pageCount: input.pageCount,
      textPageCount: input.textPageCount, textCoverage: input.textCoverage, textMode: input.textMode,
      stockCode: identity.stockCode, companyName: identity.companyName, reportYear: identity.reportYear,
      parseStatus: qualityFlags.length ? "schema_pending" : "ready", qualityFlags, ingestedAt, pages: input.pages,
    };
  });
  const derived = documents.map((document) => ({ document, ...extractDocumentEvidence(document) }));
  const documentIds = new Set(documents.map((document) => document.id));
  const incomingEvidence = derived.flatMap((item) => item.evidence);
  const incomingAspects = derived.flatMap((item) => item.aspects);
  store.pdfDocuments = append ? [...store.pdfDocuments.filter((document) => !documentIds.has(document.id)), ...documents] : documents;
  const evidenceIds = new Set(incomingEvidence.map((item) => item.id));
  const aspectIds = new Set(incomingAspects.map((item) => item.id));
  const incomingSources = new Set(documents.map((document) => document.filename));
  store.documentEvidence = append ? [...store.documentEvidence.filter((item) => !evidenceIds.has(item.id) && !incomingSources.has(item.sourceLabel)), ...incomingEvidence] : incomingEvidence;
  store.environmentalAspects = append ? [...store.environmentalAspects.filter((item) => !aspectIds.has(item.id)), ...incomingAspects] : incomingAspects;
  const sourceFiles: SourceFileRecord[] = documents.map((document) => ({ id: document.id, provider: "baidu_netdisk", path: `/remote/${document.filename}`, filename: document.filename, fsid: document.fsid, md5: document.md5, size: document.size, kind: document.kind, parseStatus: document.parseStatus, discoveredAt: document.ingestedAt, detectedFields: ["page", "text", "textHash"], qualityFlags: document.qualityFlags }));
  store.files = append ? [...store.files.filter((file) => !documentIds.has(file.id)), ...sourceFiles] : sourceFiles;
  store.lastSyncedAt = ingestedAt;
  const job: DataSourceSyncJob = { jobId: crypto.randomUUID(), provider: "baidu_netdisk", status: "completed", phase: "index", progress: 100, discoveredFileCount: documents.length, readyFileCount: documents.filter((document) => document.parseStatus === "ready").length };
  store.syncJobs.set(job.jobId, job);
  return job;
}
export function netdiskStatus(): DataSourceStatus {
  if (isMockDataMode()) return mockDataSourceStatus();
  const configured = Boolean(process.env[rootEnvName] && existsSync(process.env[rootEnvName]!)); const readyFileCount = store.files.filter((file) => file.parseStatus === "ready").length; const connected = readyFileCount > 0; const schemaPendingFileCount = store.files.filter((file) => file.kind.endsWith("_workbook") && file.parseStatus === "schema_pending").length; return { provider: "baidu_netdisk", rootPath: configured ? "configured" : connected ? "memory_ingest" : "not_configured", connectionStatus: connected ? "connected" : configured ? "degraded" : "unavailable", lastSyncedAt: store.lastSyncedAt, fileCount: store.files.length, readyFileCount, schemaPendingFileCount, message: connected || configured ? undefined : `${rootEnvName} is not configured and no memory ingestion has run.` };
}
export function netdiskFiles() { return isMockDataMode() ? mockSourceFiles() : store.files; }
export function netdiskCompanyScores() { return store.companyScores; }
export function netdiskCompanyIndustries() { return isMockDataMode() ? mockIndustries() : store.companyIndustries; }
export function netdiskEsgRatings() { return isMockDataMode() ? mockEsgRatings() : store.esgRatings; }
export function netdiskPdfDocuments(): PdfDocumentRecord[] {
  if (isMockDataMode()) return mockPdfDocuments();
  return store.pdfDocuments.map((stored) => { const { pages, ...document } = stored; void pages; return document; });
}
export function netdiskFieldCatalog(sourceFileId: string) { return store.catalogs.get(sourceFileId) ?? null; }
export function netdiskSyncJob(jobId: string) { return store.syncJobs.get(jobId) ?? null; }
export function financialRecord(companyId: string, reportYear: number) {
  if (isMockDataMode()) return mockFinancialRecord(companyId, reportYear);
  return store.financialRecords.find((record) => record.companyId === companyId && record.reportYear === reportYear && record.fiscalPeriodEnd.endsWith("-12-31")) ?? null;
}
export function companyViolationEvents(companyId: string, options: number | { reportYear?: number; fromYear?: number; toYear?: number } = {}) {
  const range = typeof options === "number" ? { reportYear: options } : options;
  if (isMockDataMode()) return mockViolationEvents(companyId, range);
  return store.violationEvents.filter((event) => event.companyId === companyId && event.violationYears.some((year) => (range.reportYear == null || year === range.reportYear) && (range.fromYear == null || year >= range.fromYear) && (range.toYear == null || year <= range.toYear)));
}
export function netdiskRecordSummary() {
  if (isMockDataMode()) return mockRecordSummary();
  const persistedPdf = pdfDerivedSummary();
  const years = [...new Set([...store.financialRecords.map((record) => record.reportYear), ...store.companyScores.map((record) => record.reportYear), ...store.violationEvents.flatMap((event) => event.violationYears), ...store.pdfDocuments.flatMap((document) => document.reportYear ? [document.reportYear] : [])])].filter((year) => year >= 2000 && year <= new Date().getFullYear() + 2).sort((a, b) => a - b);
  return {
    financialRecordCount: store.financialRecords.length,
    companyScoreRecordCount: store.companyScores.length,
    companyScoreSourceFileCount: store.files.filter((file) => file.kind === "company_score_workbook").length,
    companyIndustryRecordCount: store.companyIndustries.length,
    companyIndustrySourceFileCount: store.files.filter((file) => file.kind === "company_industry_workbook").length,
    esgRatingRecordCount: store.esgRatings.length,
    esgRatingVendorCount: new Set(store.esgRatings.map((record) => record.vendor)).size,
    esgRatingSourceFileCount: store.files.filter((file) => file.kind === "esg_rating_workbook").length,
    violationEventCount: store.violationEvents.length,
    pdfDocumentCount: store.pdfDocuments.length,
    esgDocumentCount: store.pdfDocuments.filter((document) => document.kind === "esg_report").length,
    negativeNewsDocumentCount: store.pdfDocuments.filter((document) => document.kind === "negative_news").length,
    documentEvidenceCount: Math.max(store.documentEvidence.length, persistedPdf.documentEvidenceCount),
    environmentalAspectCount: Math.max(store.environmentalAspects.length, persistedPdf.environmentalAspectCount),
    ocrRequiredDocumentCount: store.pdfDocuments.filter((document) => document.textMode === "ocr_required").length,
    companyCount: new Set([...store.financialRecords.map((record) => record.companyId), ...store.companyScores.map((record) => record.companyId), ...store.violationEvents.map((event) => event.companyId), ...store.pdfDocuments.flatMap((document) => document.stockCode ? [`stock-${document.stockCode}`] : [])]).size,
    yearFrom: years[0] ?? null,
    yearTo: years.at(-1) ?? null,
  };
}
export function netdiskSnapshot(): PersistedStore { return { files: store.files, catalogs: [...store.catalogs.entries()], financialRecords: store.financialRecords, companyScores: store.companyScores, companyIndustries: store.companyIndustries, esgRatings: store.esgRatings, violationEvents: store.violationEvents, pdfDocuments: store.pdfDocuments, documentEvidence: store.documentEvidence, environmentalAspects: store.environmentalAspects, lastSyncedAt: store.lastSyncedAt }; }
export function persistNetdiskSnapshot() { persistFullSnapshot(netdiskSnapshot() as unknown as SqliteSnapshot); }
export function persistNetdiskPdfState() {
  persistPdfState(netdiskSnapshot() as unknown as SqliteSnapshot);
  store.pdfDocuments = store.pdfDocuments.map((document) => ({ ...document, pages: [] }));
  store.documentEvidence = [];
  store.environmentalAspects = [];
}
