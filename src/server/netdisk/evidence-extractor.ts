import { createHash } from "node:crypto";
import path from "node:path";
import type {
  CompanyScoreRecord,
  EnvironmentalActionClass,
  EnvironmentalAspectCategory,
  EnvironmentalAspectScore,
  EvidenceIdentityResolution,
  EvidenceItem,
  PdfDocumentKind,
  PdfPageBlock,
  PdfTextMode,
} from "@/types";
import { inferPublicationDate, inferReportYear, normalizeCompanyId, normalizeStockCode } from "./identity";

export const CURRENT_EVIDENCE_EXTRACTOR_VERSION = "evidence-rules-v2";

export interface CompanyIdentityCandidate {
  companyId: string;
  stockCode: string;
  companyName: string;
  aliases: string[];
  reportYears: number[];
}

export interface ExtractableDocument {
  documentId: string;
  filename: string;
  kind: PdfDocumentKind;
  textMode: PdfTextMode;
  pages: PdfPageBlock[];
  stockCode?: string;
  companyName?: string;
  reportYear?: number;
  publicationDate?: string;
}

const aspectRules: Array<{ category: EnvironmentalAspectCategory; label: string; pattern: RegExp }> = [
  { category: "emissions_climate", label: "Emissions and climate", pattern: /碳|温室气体|排放|气候|carbon|emission|climate/i },
  { category: "energy_resources", label: "Energy and resources", pattern: /能源|能耗|电力|用水|资源|energy|water|resource/i },
  { category: "waste_circularity", label: "Waste and circularity", pattern: /废弃物|固废|回收|循环|垃圾|waste|recycl|circular/i },
  { category: "pollution_control", label: "Pollution control", pattern: /污染|废水|废气|噪声|治理|pollution|wastewater/i },
  { category: "biodiversity_ecology", label: "Biodiversity and ecology", pattern: /生态|生物多样性|植被|修复|biodiversity|ecology/i },
];
const implementedPattern = /已完成|已投入|已建成|已实施|实现|同比减少|同比降低|completed|implemented|reduced/i;
const planningPattern = /计划|将于|预计|目标|拟于|未来|plan|target|will|expected/i;
const planningVerificationPatterns = [/20\d{2}年|20\d{2}[-/.]\d{1,2}/, /\d+(?:\.\d+)?%|\d+(?:\.\d+)?\s*(?:吨|万元|千瓦|兆瓦|立方米)/, /通过|采用|建设|改造|采购|实施路径/, /部门|委员会|负责人|责任单位/];
const companySuffixPattern = /(?:股份有限(?:责任)?公司|有限责任公司|有限公司|集团股份公司|集团有限公司|控股集团|集团)$/;

function stableId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function normalizeCompanyAlias(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s·•・_—\-（）()【】\[\]，,。.]/g, "").replace(companySuffixPattern, "");
}

export function buildCompanyIdentityCandidates(scores: CompanyScoreRecord[], additionalAliases: Array<{ companyId: string; alias: string }> = []): CompanyIdentityCandidate[] {
  const grouped = new Map<string, CompanyIdentityCandidate>();
  for (const score of scores) {
    const companyId = normalizeCompanyId(score.companyId ?? score.stockCode);
    const stockCode = normalizeStockCode(score.stockCode);
    if (!companyId || !stockCode) continue;
    const existing = grouped.get(companyId) ?? { companyId, stockCode, companyName: score.companyName, aliases: [], reportYears: [] };
    existing.companyName ||= score.companyName;
    existing.aliases = [...new Set([...existing.aliases, score.companyName, stockCode].filter(Boolean))];
    existing.reportYears = [...new Set([...existing.reportYears, score.reportYear])].sort((a, b) => a - b);
    grouped.set(companyId, existing);
  }
  for (const item of additionalAliases) {
    const companyId = normalizeCompanyId(item.companyId);
    const existing = companyId ? grouped.get(companyId) : undefined;
    if (existing && item.alias) existing.aliases = [...new Set([...existing.aliases, item.alias])];
  }
  return [...grouped.values()];
}

function firstFivePages(pages: PdfPageBlock[]) {
  return pages.slice(0, 5).map((page) => page.text).join("\n");
}

function exactSixDigitCodes(value: string) {
  return [...new Set([...value.matchAll(/(?<!\d)(\d{6})(?!\d)/g)].map((match) => match[1]))];
}

function reportYearFromCover(leadText: string) {
  const patterns = [
    /((?:19|20)\d{2})\s*年(?:度)?[^\n\r]{0,24}(?:年度报告|社会责任报告|环境报告|可持续发展报告|ESG\s*报告)/i,
    /(?:报告期|报告年度|报告期间)\s*[:：]?\s*((?:19|20)\d{2})/,
    /(?:annual|sustainability|environmental|ESG)\s+report[^\d]{0,12}((?:19|20)\d{2})/i,
  ];
  for (const pattern of patterns) {
    const match = leadText.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

export function resolveDocumentIdentity(
  document: ExtractableDocument,
  candidates: CompanyIdentityCandidate[],
): EvidenceIdentityResolution {
  const leadText = firstFivePages(document.pages);
  const identitySources: string[] = [];
  const strongCodes = new Map<string, number>();
  const addCode = (raw: unknown, source: string, confidence: number) => {
    const code = normalizeStockCode(raw);
    if (!code) return;
    strongCodes.set(code, Math.max(strongCodes.get(code) ?? 0, confidence));
    identitySources.push(source);
  };

  if (document.stockCode) addCode(document.stockCode, "document_metadata_stock_code", 1);
  const filenameCodes = exactSixDigitCodes(document.filename);
  if (filenameCodes.length === 1) addCode(filenameCodes[0], "filename_stock_code", 0.99);
  const coverExplicit = leadText.match(/(?:证券|股票)代码\s*[:：]?\s*(\d{6})/i)?.[1];
  if (coverExplicit) addCode(coverExplicit, "cover_stock_code", 0.99);

  const normalizedHaystack = normalizeCompanyAlias(`${document.filename}\n${leadText.slice(0, 30_000)}`);
  const nameMatches = candidates.filter((candidate) => candidate.aliases.some((alias) => {
    const normalized = normalizeCompanyAlias(alias);
    return normalized.length >= 3 && normalizedHaystack.includes(normalized);
  }));
  const strongCandidates = [...strongCodes.keys()].map((code) => candidates.find((candidate) => candidate.stockCode === code) ?? {
    companyId: `stock-${code}`, stockCode: code, companyName: document.companyName ?? code, aliases: [], reportYears: [],
  });
  const allCandidates = [...new Map([...strongCandidates, ...nameMatches].map((candidate) => [candidate.companyId, candidate])).values()];
  if (!strongCodes.size && nameMatches.length === 1) identitySources.push("score_alias_exact");

  const codeConflict = strongCodes.size > 1;
  const nameConflict = strongCandidates.length === 1 && nameMatches.length > 0 && nameMatches.every((candidate) => candidate.companyId !== strongCandidates[0].companyId);
  const company = !codeConflict && !nameConflict
    ? strongCandidates[0] ?? (nameMatches.length === 1 ? nameMatches[0] : undefined)
    : undefined;
  const identityConfidence = company
    ? strongCodes.get(company.stockCode) ?? 0.9
    : 0;

  const coverYear = reportYearFromCover(leadText);
  const metadataYear = document.reportYear && document.reportYear >= 1990 ? document.reportYear : null;
  const filenameYear = inferReportYear("", document.filename);
  const publicationDate = document.publicationDate ?? inferPublicationDate(document.filename);
  const publicationMappedYear = publicationDate ? Number(publicationDate.slice(0, 4)) - 1 : null;
  const uniqueScoreYear = company?.reportYears.length === 1 ? company.reportYears[0] : null;
  let reportYear: number | null = null;
  let yearSource: string | null = null;
  let yearConfidence = 0;
  if (coverYear) { reportYear = coverYear; yearSource = "cover_report_period"; yearConfidence = 0.99; }
  else if (metadataYear) { reportYear = metadataYear; yearSource = "document_metadata_report_year"; yearConfidence = 0.95; }
  else if (filenameYear) { reportYear = filenameYear; yearSource = "filename_report_year"; yearConfidence = 0.82; }
  else if (publicationMappedYear) { reportYear = publicationMappedYear; yearSource = "publication_date_mapping"; yearConfidence = 0.65; }
  else if (uniqueScoreYear) { reportYear = uniqueScoreYear; yearSource = "unique_score_year"; yearConfidence = 0.6; }

  const strongYearValues = [...new Set([coverYear, metadataYear, coverYear ? filenameYear : null].filter((value): value is number => value != null))];
  const yearConflict = strongYearValues.length > 1;
  const status = codeConflict || nameConflict || yearConflict || (!company && allCandidates.length > 1)
    ? "ambiguous"
    : company && reportYear
      ? "resolved"
      : "unresolved";

  return {
    resolvedCompanyId: status === "resolved" ? company!.companyId : null,
    resolvedStockCode: status === "resolved" ? company!.stockCode : null,
    reportYear: status === "resolved" ? reportYear : null,
    publicationDate: publicationDate ?? null,
    identityConfidence,
    yearConfidence,
    identitySources: [...new Set(identitySources)],
    yearSource,
    alternativeCandidates: allCandidates.map((candidate) => ({ companyId: candidate.companyId, stockCode: candidate.stockCode, companyName: candidate.companyName })),
    status,
  };
}

function pageSentences(page: PdfPageBlock) {
  return page.text.split(/(?<=[。！？!?；;])|\n+/).map((value) => value.trim()).filter((value) => value.length >= 12);
}

export function extractDocumentEvidence(input: {
  document: ExtractableDocument;
  identity: EvidenceIdentityResolution;
  extractorVersion?: string;
}) {
  const { document, identity } = input;
  const extractorVersion = input.extractorVersion ?? CURRENT_EVIDENCE_EXTRACTOR_VERSION;
  if (identity.status !== "resolved" || !identity.resolvedCompanyId || !identity.resolvedStockCode || !identity.reportYear) {
    throw new Error("Document identity must be resolved before evidence extraction.");
  }
  const evidence: EvidenceItem[] = [];
  const aspectBuckets = new Map<EnvironmentalAspectCategory, { label: string; implemented: number; planning: number; indeterminate: number; evidenceIds: string[] }>();
  for (const page of document.pages) {
    for (const sentence of pageSentences(page)) {
      const rule = aspectRules.find((candidate) => candidate.pattern.test(sentence));
      if (!rule && document.kind === "esg_report") continue;
      const actionClass: EnvironmentalActionClass = implementedPattern.test(sentence) ? "implemented" : planningPattern.test(sentence) ? "planning" : "indeterminate";
      const verifiedPlanning = actionClass !== "planning" || planningVerificationPatterns.every((pattern) => pattern.test(sentence));
      const evidenceType = actionClass === "implemented" ? "action" : "claim";
      const sentenceHash = stableId(sentence);
      const id = stableId(`${document.documentId}:${page.page}:${page.textHash}:${sentenceHash}:${evidenceType}:${extractorVersion}`);
      const aspectId = rule ? stableId(`${document.documentId}:${rule.category}:${extractorVersion}`) : undefined;
      evidence.push({
        id,
        documentId: document.documentId,
        companyId: identity.resolvedCompanyId,
        stockCode: identity.resolvedStockCode,
        reportYear: identity.reportYear,
        type: evidenceType,
        actionClass,
        aspectId,
        title: rule?.label ?? "Environmental statement",
        excerpt: sentence.slice(0, 500),
        page: page.page,
        textHash: page.textHash,
        environmentalCategory: rule?.category,
        extractorVersion,
        sourceLabel: document.filename,
        status: document.textMode === "ocr_required" || !verifiedPlanning ? "insufficient" : "pending",
      });
      if (rule) {
        const bucket = aspectBuckets.get(rule.category) ?? { label: rule.label, implemented: 0, planning: 0, indeterminate: 0, evidenceIds: [] };
        bucket[actionClass] += 1;
        bucket.evidenceIds.push(id);
        aspectBuckets.set(rule.category, bucket);
      }
    }
  }

  const aspects = [...aspectBuckets.entries()].map(([category, bucket]) => {
    const total = bucket.implemented + bucket.planning + bucket.indeterminate;
    const planningAlpha = 0.5;
    return {
      id: stableId(`${document.documentId}:${category}:${extractorVersion}`),
      documentId: document.documentId,
      companyId: identity.resolvedCompanyId!,
      reportYear: identity.reportYear!,
      aspectText: bucket.label,
      category,
      frequency: total,
      salience: total ? total / Math.max(evidence.length, 1) : 0,
      implemented: bucket.implemented,
      planning: bucket.planning,
      indeterminate: bucket.indeterminate,
      planningAlpha,
      actionScore: total ? (bucket.implemented + planningAlpha * bucket.planning) / total : null,
      evidenceIds: bucket.evidenceIds,
      calculationStatus: "calculated",
      formulaVersion: "pdf-actions-v2",
      extractorVersion,
    } satisfies EnvironmentalAspectScore;
  });
  return { evidence, aspects };
}

export function fallbackCompanyName(filename: string) {
  return path.basename(filename, path.extname(filename)).replace(/[_-]+/g, " ").replace(/(?:19|20)\d{2}.*$/, "").trim();
}
