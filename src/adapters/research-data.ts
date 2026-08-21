import type { EvidenceStatus, FinancialYearRecord, PanelMetadata, PanelYearSummary, SampleGroup, ViolationEvent } from "@/types";

export type SourceRow = Record<string, unknown>;

export const financialIndicatorDictionary = {
  F011201A: { field: "assetLiabilityRatio", label: "资产负债率", unit: "ratio" },
  F050201B: { field: "roaA", label: "总资产净利润率（ROA）A", unit: "ratio" },
  A001000000: { field: "totalAssets", label: "资产总计", unit: "CNY" },
} as const;

function firstDefined(row: SourceRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

export function normalizeStockCode(value: unknown) {
  if (value == null) return "";
  const text = String(value).trim().toUpperCase();
  if (/^D\d{5}$/.test(text)) return text;
  const match = text.match(/\d{1,6}/);
  return match ? match[0].padStart(6, "0") : text;
}

export function parseViolationYears(value: unknown) {
  if (value == null) return [];
  const years = String(value).match(/(?:19|20)\d{2}/g) ?? [];
  return [...new Set(years.map(Number))].sort((a, b) => a - b);
}

export function toNullableNumber(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/[￥¥,$,，\s]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function toIsoDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  const match = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!match) return text.slice(0, 10);
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

export function splitMultiValue(value: unknown) {
  if (value == null) return [];
  return String(value).split(/[;；,，、]/).map((item) => item.trim()).filter(Boolean);
}

function toBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "y"].includes(String(value ?? "").trim().toLowerCase());
}

function toNonnegativeInteger(value: unknown) {
  const number = toNullableNumber(value);
  return number == null ? 0 : Math.max(0, Math.trunc(number));
}

export function normalizePanelMetadata(row: SourceRow): PanelMetadata {
  const environmentalSentences = toNonnegativeInteger(firstDefined(row, ["environmentalSentenceCount", "n_environmental_sentences"]));
  const sourceGroup = String(firstDefined(row, ["sampleGroup", "sample_group"]) ?? "");
  const sampleGroup: SampleGroup = sourceGroup === "main_n_ge_20" || sourceGroup === "robustness_n_10_19" || sourceGroup === "low_n_lt_10"
    ? sourceGroup
    : environmentalSentences >= 20 ? "main_n_ge_20" : environmentalSentences >= 10 ? "robustness_n_10_19" : "low_n_lt_10";
  return {
    sampleGroup,
    includeNGe10: toBoolean(firstDefined(row, ["includeNGe10", "include_n_ge_10"])),
    includeNGe20: toBoolean(firstDefined(row, ["includeNGe20", "include_n_ge_20"])),
    analysisScope: String(firstDefined(row, ["analysisScope", "analysis_scope"]) ?? "unspecified"),
    lowSentenceCountFlag: toBoolean(firstDefined(row, ["lowSentenceCountFlag", "low_sentence_count_flag"])),
    recommendedUse: String(firstDefined(row, ["recommendedUse", "recommended_use"]) ?? ""),
    yearsAvailable: toNonnegativeInteger(firstDefined(row, ["yearsAvailable", "years_available"])),
    firstYear: toNonnegativeInteger(firstDefined(row, ["firstYear", "first_year"])),
    lastYear: toNonnegativeInteger(firstDefined(row, ["lastYear", "last_year"])),
    duplicateCount: Math.max(1, toNonnegativeInteger(firstDefined(row, ["duplicateCount", "duplicate_count"]))),
    selectedForPanel: toBoolean(firstDefined(row, ["selectedForPanel", "selected_for_panel"])),
    selectionNote: String(firstDefined(row, ["selectionNote", "selection_note"]) ?? "") || undefined,
    qualityFlags: splitMultiValue(firstDefined(row, ["qualityFlags", "quality_flags"])),
    reportYearTextCheck: String(firstDefined(row, ["reportYearTextCheck", "report_year_text_check"]) ?? ""),
    codeSource: String(firstDefined(row, ["codeSource", "code_source"]) ?? ""),
    sourceFile: String(firstDefined(row, ["sourceFile", "source_file"]) ?? ""),
    sourceSheet: String(firstDefined(row, ["sourceSheet", "source_sheet"]) ?? ""),
    sourceRow: Math.max(1, toNonnegativeInteger(firstDefined(row, ["sourceRow", "source_row"]))),
  };
}

export function normalizePanelYearSummaryRow(row: SourceRow): PanelYearSummary {
  return {
    year: toNonnegativeInteger(firstDefined(row, ["year"])),
    sourceFile: String(firstDefined(row, ["sourceFile", "source_file"]) ?? ""),
    sourceRows: toNonnegativeInteger(firstDefined(row, ["sourceRows", "source_rows"])),
    uniqueCompanyYears: toNonnegativeInteger(firstDefined(row, ["uniqueCompanyYears", "unique_company_years"])),
    duplicateGroups: toNonnegativeInteger(firstDefined(row, ["duplicateGroups", "duplicate_groups"])),
    extraDuplicateRows: toNonnegativeInteger(firstDefined(row, ["extraDuplicateRows", "extra_duplicate_rows"])),
    selectedNLt10: toNonnegativeInteger(firstDefined(row, ["selectedNLt10", "selected_n_lt_10"])),
    selectedN10To19: toNonnegativeInteger(firstDefined(row, ["selectedN10To19", "selected_n_10_19"])),
    selectedNGe20: toNonnegativeInteger(firstDefined(row, ["selectedNGe20", "selected_n_ge_20"])),
    titleTargetYearNotFound: toNonnegativeInteger(firstDefined(row, ["titleTargetYearNotFound", "title_target_year_not_found"])),
    qualityFlaggedRows: toNonnegativeInteger(firstDefined(row, ["qualityFlaggedRows", "quality_flagged_rows"])),
    codeRecoveredFromCompany: toNonnegativeInteger(firstDefined(row, ["codeRecoveredFromCompany", "code_recovered_from_company"])),
  };
}

export function normalizeViolationRow(
  row: SourceRow,
  context: { companyId: string; sourceLabel: string; sourceUrl?: string; reviewStatus?: EvidenceStatus },
): ViolationEvent {
  const eventId = firstDefined(row, ["violationEventId", "违规事件ID", "event_id"]);
  const stockCode = normalizeStockCode(firstDefined(row, ["stockCode", "证券代码", "Stkcd"]));
  const companyName = String(firstDefined(row, ["companyName", "证券简称", "ShortName"]) ?? "");
  const violationYears = parseViolationYears(firstDefined(row, ["violationYears", "违规年度", "发生年度"]));
  const totalPenalty = toNullableNumber(firstDefined(row, ["totalPenalty", "处罚总金额"]));
  const companyPenalty = toNullableNumber(firstDefined(row, ["companyPenalty", "处罚金额(上市公司)"]));
  const qualityFlags: string[] = [];
  if (!/^\d{6}$/.test(stockCode)) qualityFlags.push("stock_code_unresolved");
  if (!violationYears.length) qualityFlags.push("violation_year_missing");
  if (totalPenalty == null) qualityFlags.push("total_penalty_missing");
  if (companyPenalty == null) qualityFlags.push("company_penalty_missing");
  return {
    id: eventId == null ? `${context.companyId}-${toIsoDate(firstDefined(row, ["announcementDate", "公告日期", "公示时间"]))}` : String(eventId),
    companyId: context.companyId,
    stockCode,
    companyName,
    violationYears: violationYears.length ? violationYears : [Number(toIsoDate(firstDefined(row, ["announcementDate", "公告日期", "公示时间"])).slice(0, 4))].filter(Number.isFinite),
    announcementDate: toIsoDate(firstDefined(row, ["announcementDate", "公告日期", "公示时间"])),
    occurrenceDate: toIsoDate(firstDefined(row, ["occurrenceDate", "发生日期"])) || undefined,
    violationTypes: splitMultiValue(firstDefined(row, ["violationTypes", "违规类型", "处理类型"])),
    title: String(firstDefined(row, ["title", "标题"]) ?? "") || undefined,
    reason: String(firstDefined(row, ["reason", "处理原因"]) ?? "") || undefined,
    behavior: String(firstDefined(row, ["behavior", "违规行为"]) ?? ""),
    action: String(firstDefined(row, ["action", "处分措施", "操作"]) ?? ""),
    authority: String(firstDefined(row, ["authority", "处理机构"]) ?? "") || undefined,
    totalPenalty,
    companyPenalty,
    relation: String(firstDefined(row, ["relation", "与上市公司关系", "关联关系"]) ?? "") || undefined,
    subjectName: String(firstDefined(row, ["subjectName", "违规主体名称", "处理对象"]) ?? "") || undefined,
    sourceLabel: context.sourceLabel,
    sourceUrl: context.sourceUrl,
    reviewStatus: context.reviewStatus ?? "pending",
    qualityFlags,
  };
}

export function mergeFinancialRows(
  rows: SourceRow[],
  context: { companyId: string; currency?: string },
): FinancialYearRecord[] {
  const grouped = new Map<string, FinancialYearRecord>();
  for (const row of rows) {
    const stockCode = normalizeStockCode(firstDefined(row, ["stockCode", "Stkcd", "证券代码", "股票代码"]));
    const companyName = String(firstDefined(row, ["companyName", "ShortName", "证券简称", "股票简称"]) ?? "");
    const fiscalPeriodEnd = toIsoDate(firstDefined(row, ["fiscalPeriodEnd", "Accper", "统计截止日期"]));
    const reportYear = Number(fiscalPeriodEnd.slice(0, 4));
    const key = `${stockCode}-${fiscalPeriodEnd}`;
    const existing = grouped.get(key) ?? {
      id: `${context.companyId}-financial-${fiscalPeriodEnd}`,
      companyId: context.companyId,
      stockCode,
      companyName,
      fiscalPeriodEnd,
      reportYear,
      reportType: String(firstDefined(row, ["reportType", "Typrep", "报表类型编码"]) ?? ""),
      sourceType: String(firstDefined(row, ["sourceType", "Source", "公告来源"]) ?? ""),
      assetLiabilityRatio: null,
      roaA: null,
      totalAssets: null,
      currency: context.currency ?? "CNY",
      sourceFields: { assetLiabilityRatio: "F011201A", roaA: "F050201B", totalAssets: "A001000000" },
      qualityFlags: [],
    } satisfies FinancialYearRecord;
    if (row.F011201A !== undefined) existing.assetLiabilityRatio = toNullableNumber(row.F011201A);
    if (row.F050201B !== undefined) existing.roaA = toNullableNumber(row.F050201B);
    if (row.A001000000 !== undefined) existing.totalAssets = toNullableNumber(row.A001000000);
    grouped.set(key, existing);
  }
  for (const record of grouped.values()) {
    if (!/^\d{6}$/.test(record.stockCode)) record.qualityFlags.push("stock_code_unresolved");
    if (!Number.isInteger(record.reportYear)) record.qualityFlags.push("fiscal_period_missing");
    if (record.assetLiabilityRatio == null) record.qualityFlags.push("asset_liability_ratio_missing");
    if (record.roaA == null) record.qualityFlags.push("roa_missing");
    if (record.totalAssets == null) record.qualityFlags.push("total_assets_missing");
  }
  return [...grouped.values()].sort((a, b) => a.fiscalPeriodEnd.localeCompare(b.fiscalPeriodEnd));
}
