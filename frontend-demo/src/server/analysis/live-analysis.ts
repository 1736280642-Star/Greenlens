import type {
  AnalysisMetric,
  CompanyScoreRecord,
  CompanyMetricHistoryPoint,
  CompanyYearRecord,
  DashboardCommandCenterData,
  EnvironmentalAspectScore,
  EvidenceItem,
  FinancialYearRecord,
  PanelYearSummary,
  RedFlagCode,
  RiskBand,
  SampleGroup,
} from "@/types";
import type { CompanyYearQuery } from "@/repositories/analysis-repository";
import { buildDashboardCommandCenter, lightNodeLimitPerBand, lightNodeMaxTotal } from "@/repositories/dashboard-command-center";
import { netdiskSnapshot } from "@/server/netdisk/local-netdisk";
import {
  persistedEvidenceSummaries,
  type PersistedEvidenceSummary,
  persistedEnvironmentalAspects,
  persistedEvidenceItems,
  persistedFailedPdfIdentities,
  persistedPdfDocuments,
  persistedEvidenceSamplesByKey,
  listGsiScoreRecords,
  loadDashboardSqliteSnapshot,
  loadDashboardScoreHistoryRows,
  type DashboardScoreHistoryRow,
  runtimeDataRevision,
  releaseSqliteMemory,
  readDashboardPersistentCache,
  writeDashboardPersistentCache,
} from "@/server/netdisk/sqlite-store";
import { alignReportYearToScores } from "@/server/netdisk/identity";
import { evidenceIdsForMetric } from "@/lib/evidence-linking";

const dataVersion = "NETDISK-SQLITE-1";
const eaaDataVersion = "EAA-PANEL-2012-2024-V1";
const planningAlpha = 0.5;
/** Evidence-coverage penalty weight. Below-baseline coverage (<70%) raises risk by up to ~6pp. */
const evidenceAdjustmentWeight = 0.06;
const evidenceCoverageBaseline = 0.7;
const parameters = { planningAlpha, lambdaAction: 0.3, lambdaIndeterminate: 0.2, lambdaPlanning: 0.1, parameterVersion: "metric-contract-v2-live-1" };

function currentDataVersion(base: string) {
  return `${base}:${liveDataRevision()}`;
}

function ratio(numerator: number, denominator: number) {
  return denominator ? Number((numerator / denominator).toFixed(6)) : null;
}

function metric(code: AnalysisMetric["code"], label: string, value: number | null, riskValue: number | null, options: Partial<AnalysisMetric> = {}): AnalysisMetric {
  const unavailable = value == null;
  return {
    code, label, rawValue: value, normalizedValue: value, riskValue,
    riskDirection: code === "EASS" ? "lower_is_risk" : code === "IMBALANCE" ? "contextual" : "higher_is_risk",
    formulaVersion: options.formulaVersion ?? `${code.toLowerCase()}-live-v1`,
    normalizationVersion: unavailable ? "not_available" : "identity-v1",
    normalizationScope: "none",
    calculationStatus: unavailable ? "unavailable" : "calculated",
    unavailableReason: unavailable ? options.unavailableReason ?? "Required model input is not available from the current read-only source." : undefined,
    evidenceIds: [],
    ...options,
  };
}

function sampleGroup(total: number): SampleGroup {
  return total >= 20 ? "main_n_ge_20" : total >= 10 ? "robustness_n_10_19" : "low_n_lt_10";
}

const esgTopicPatterns = {
  e: /碳|温室气体|排放|气候|能源|资源|用水|废弃物|固废|回收|循环|污染|废水|废气|生态|生物多样性|环境|climate|carbon|emission|energy|water|waste|recycl|pollution|biodiversity|ecology|environment/i,
  s: /员工|劳工|劳动|培训|安全|健康|社区|公益|慈善|人权|消费者|供应链|社会|employee|labor|labour|training|safety|health|community|charity|human rights|consumer|supply chain|social/i,
  g: /治理|董事会|监事会|委员会|反腐败|商业贿赂|合规|信息披露|股东|内部控制|governance|board|committee|anti-corruption|compliance|disclosure|shareholder|internal control/i,
};

function deriveEsgTopics(items: EvidenceItem[]): CompanyYearRecord["esgTopics"] {
  const texts = items.flatMap((item) => [item.title ?? "", item.excerpt ?? ""]).filter(Boolean);
  let eCount = 0;
  let sCount = 0;
  let gCount = 0;
  for (const text of texts) {
    if (esgTopicPatterns.e.test(text)) eCount += 1;
    if (esgTopicPatterns.s.test(text)) sCount += 1;
    if (esgTopicPatterns.g.test(text)) gCount += 1;
  }
  const total = eCount + sCount + gCount;
  const eFocus = total ? eCount / total : 0;
  const sFocus = total ? sCount / total : 0;
  const gFocus = total ? gCount / total : 0;
  const entropy = -[eFocus, sFocus, gFocus].filter((value) => value > 0).reduce((sum, value) => sum + value * Math.log(value), 0) / Math.log(3);
  return {
    eCount,
    sCount,
    gCount,
    eFocus: round(eFocus),
    sFocus: round(sFocus),
    gFocus: round(gFocus),
    imbalanceScore: round(total ? Math.min(1, Math.max(0, 1 - entropy)) : 0),
  };
}

function deriveTokenCount(textLength: number, items: EvidenceItem[]): number {
  if (textLength > 0) return Math.max(0, Math.round(textLength / 1.5));
  const excerptChars = items.reduce((sum, item) => sum + (item.excerpt?.length ?? 0), 0);
  return Math.max(0, Math.round(excerptChars / 1.5));
}

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function resolvedDocumentYear(document: ReturnType<typeof persistedPdfDocuments>[number]) {
  const maximumYear = new Date().getFullYear() + 1;
  return document.reportYear && document.reportYear >= 2010 && document.reportYear <= maximumYear ? document.reportYear : null;
}

function riskBandFromLabel(label: string): RiskBand {
  if (/high/i.test(label)) return "high";
  if (/medium/i.test(label)) return "medium";
  if (/low/i.test(label)) return "low";
  return "unavailable";
}

function baseRiskFromLabel(label: string): CompanyYearRecord["riskClassification"]["baseRisk"] {
  if (/high/i.test(label)) return "relatively_high";
  if (/medium/i.test(label)) return "relatively_medium";
  if (/low/i.test(label)) return "relatively_low";
  return "unavailable";
}

function scoreRedFlags(score: CompanyScoreRecord): RedFlagCode[] {
  const flags: RedFlagCode[] = [];
  if (score.flagHighEsgsi) flags.push("HIGH_ESGSI");
  if (score.flagLowEass) flags.push("LOW_EASS");
  if (score.flagHighIr) flags.push("HIGH_IR");
  if (score.flagHighUpr) flags.push("HIGH_UPR");
  return flags;
}

function scorePublishDate(score: CompanyScoreRecord) {
  return score.sourceLabel.match(/_(\d{4}-\d{2}-\d{2})_/)?.[1] ?? `${score.reportYear}-12-31`;
}

function scoreCompanyRecord(score: CompanyScoreRecord, financial: FinancialYearRecord | undefined, evidence: PersistedEvidenceSummary | undefined, eventCount: number, industry: string, evidenceItems: EvidenceItem[] = [], hasMatchedDocument = false, version = currentDataVersion(eaaDataVersion)): CompanyYearRecord {
  const companyId = `stock-${score.stockCode}`;
  const reportYear = score.reportYear;
  const total = evidence?.total ?? 0;
  const evidenceCoverage = total ? Math.round((1 - (evidence?.insufficient ?? 0) / total) * 100) : 0;
  const evidenceLinkageStatus = total > 0 ? (evidenceCoverage < 70 ? "low_coverage" : "linked") : hasMatchedDocument ? "parse_failed" : "unlinked";
  const implemented = evidence?.implemented ?? 0;
  const planning = evidence?.planning ?? 0;
  const indeterminate = evidence?.indeterminate ?? 0;
  const unverifiedPlanning = evidence?.unverifiedPlanning ?? 0;
  const esgsiAvailable = score.esgsiRaw != null && score.esgsiNorm != null;
  const finalAvailable = score.eaaEsiRaw != null && score.eaaEsiNorm != null;
  const hasActionEvidence = total > 0;
  const eass = hasActionEvidence ? ratio(implemented + planningAlpha * planning, total) : score.EASS;
  const ir = hasActionEvidence ? ratio(indeterminate, total) : score.IR;
  const upr = hasActionEvidence ? ratio(unverifiedPlanning, planning) : score.UPR;
  const actionFormulaVersion = hasActionEvidence ? "evidence-actions-v2" : "eaa-panel-v1";
  const redFlags = scoreRedFlags(score);
  const riskBand = riskBandFromLabel(score.riskLevel);
  const topics = deriveEsgTopics(evidenceItems);
  const topicAvailable = evidenceItems.length > 0;
  const metrics = [
    metric("EASS", "Environmental action substance", eass, eass == null ? null : 1 - eass, { threshold: 0.5, formulaVersion: actionFormulaVersion, evidenceIds: evidenceIdsForMetric("EASS", evidenceItems), ...(eass != null ? { normalizationVersion: hasActionEvidence ? "evidence-identity-v2" : "eaa-panel-identity-v1" } : {}) }),
    metric("IR", "Indeterminate statement ratio", ir, ir, { threshold: 0.33, formulaVersion: actionFormulaVersion, evidenceIds: evidenceIdsForMetric("IR", evidenceItems), ...(ir != null ? { normalizationVersion: hasActionEvidence ? "evidence-identity-v2" : "eaa-panel-identity-v1" } : {}) }),
    metric("UPR", "Unverified planning ratio", upr, upr, { threshold: 0.6, formulaVersion: actionFormulaVersion, evidenceIds: evidenceIdsForMetric("UPR", evidenceItems), ...(upr != null ? { normalizationVersion: hasActionEvidence ? "evidence-identity-v2" : "eaa-panel-identity-v1" } : {}) }),
    metric("ESGSI", "Rhetoric-content gap", esgsiAvailable ? score.esgsiRaw : null, esgsiAvailable ? score.esgsiNorm : null, {
      ...(esgsiAvailable ? { normalizedValue: score.esgsiNorm } : {}),
      formulaVersion: "eaa-panel-v1",
      normalizationVersion: esgsiAvailable ? "eaa-panel-norm-v1" : "not_available",
      normalizationScope: esgsiAvailable ? "year" : "none",
      ...(esgsiAvailable ? {} : { unavailableReason: "EAA panel did not provide a usable ESGSI value." }),
    }),
    metric("EAA_ESI", "Environment-action-adjusted risk index", finalAvailable ? score.eaaEsiRaw : null, finalAvailable ? score.eaaEsiNorm : null, {
      ...(finalAvailable ? { normalizedValue: score.eaaEsiNorm } : {}),
      formulaVersion: "eaa-panel-v1",
      normalizationVersion: finalAvailable ? "eaa-panel-norm-v1" : "not_available",
      normalizationScope: finalAvailable ? "year" : "none",
      ...(finalAvailable ? {} : { unavailableReason: "EAA panel did not provide a usable EAA-ESI value." }),
    }),
    metric("IMBALANCE", "ESG topic imbalance", topicAvailable ? topics.imbalanceScore : null, topicAvailable ? topics.imbalanceScore : null, {
      evidenceIds: evidenceIdsForMetric("IMBALANCE", evidenceItems),
      formulaVersion: "esg-topics-v1",
      normalizationVersion: topicAvailable ? "identity-v1" : "not_available",
      normalizationScope: topicAvailable ? "none" : "none",
      ...(topicAvailable ? {} : { unavailableReason: "No evidence text is available for E/S/G topic extraction." }),
    }),
  ];
  return {
    id: `${companyId}:${reportYear}`,
    reportId: score.id,
    companyId,
    companyName: financial?.companyName ?? score.companyName,
    stockCode: score.stockCode,
    industry,
    reportYear,
    publishDate: scorePublishDate(score),
    finalIndexRaw: finalAvailable ? score.eaaEsiRaw : null,
    finalIndex: finalAvailable ? score.eaaEsiNorm : null,
    riskBand,
    evidenceCoverage,
    evidenceStatus: total === 0 || evidenceCoverage < 70 ? "insufficient" : "pending",
    evidenceLinkageStatus,
    reviewStatus: "pending",
    eventCount,
    textProcessing: { textLength: score.textLength, totalWords: score.nAllSentences, sentenceCount: score.nAllSentences, environmentalSentenceCount: score.nEnvironmentalSentences, tokenCount: deriveTokenCount(score.textLength, evidenceItems) },
    esgTopics: topics,
    environmentalActions: { totalStatements: implemented + planning + indeterminate, implemented, planning, indeterminate, planningAlpha },
    planningVerification: { totalPlanning: planning, verifiedPlanning: Math.max(0, planning - unverifiedPlanning), unverifiedPlanning, requiredAttributes: ["deadline", "quantified_target", "implementation_path", "responsible_entity"], ruleVersion: "evidence-actions-v1" },
    scoreInputs: {
      sentiment: { rawValue: score.sentimentRaw, normalizedValue: score.sentimentNorm, normalizationVersion: "eaa-panel-v1", normalizationScope: "year" },
      sustainability: { rawValue: score.sustainabilityRaw, normalizedValue: score.sustainabilityNorm, normalizationVersion: "eaa-panel-v1", normalizationScope: "year" },
    },
    scoringParameters: parameters,
    metrics,
    indexBreakdown: {
      baseEsgsiNormalized: esgsiAvailable ? score.esgsiNorm : null,
      actionPenalty: { inputValue: eass == null ? null : 1 - eass, weight: parameters.lambdaAction, contribution: eass == null ? null : parameters.lambdaAction * (1 - eass) },
      indeterminatePenalty: { inputValue: ir, weight: parameters.lambdaIndeterminate, contribution: ir == null ? null : parameters.lambdaIndeterminate * ir },
      planningPenalty: { inputValue: upr, weight: parameters.lambdaPlanning, contribution: upr == null ? null : parameters.lambdaPlanning * upr },
      evidenceAdjustment: {
        inputValue: evidenceCoverage / 100,
        weight: evidenceAdjustmentWeight,
        contribution: evidenceAdjustmentWeight * Math.max(0, evidenceCoverageBaseline - evidenceCoverage / 100),
      },
      finalRaw: finalAvailable ? score.eaaEsiRaw : null,
      finalNormalized: finalAvailable ? score.eaaEsiNorm : null,
      normalizationVersion: finalAvailable ? "eaa-panel-v1" : "not_available",
      normalizationScope: finalAvailable ? "year" : "none",
    },
    riskClassification: {
      baseRisk: baseRiskFromLabel(score.baseRisk),
      redFlags,
      redFlagCount: redFlags.length,
      assignedBand: riskBand,
      classificationVersion: "eaa-panel-v1",
      reason: score.recommendedUse || "EAA-ESI panel output; treat as a review signal, not a confirmed judgment.",
    },
    panelMetadata: {
      sampleGroup: score.sampleGroup,
      includeNGe10: score.includeNGe10,
      includeNGe20: score.includeNGe20,
      analysisScope: score.analysisScope || "EAA-ESI company-level scoring",
      lowSentenceCountFlag: score.lowSentenceCountFlag,
      recommendedUse: score.recommendedUse,
      yearsAvailable: score.yearsAvailable ?? 1,
      firstYear: score.firstYear ?? reportYear,
      lastYear: score.lastYear ?? reportYear,
      duplicateCount: score.duplicateCount,
      selectedForPanel: score.selectedForPanel ?? true,
      selectionNote: score.selectionNote,
      qualityFlags: [...(financial ? [] : ["FINANCIAL_RECORD_MISSING"]), ...(total ? [] : ["PDF_EVIDENCE_MISSING"]), ...score.qualityFlags],
      reportYearTextCheck: score.reportYearTextCheck ?? "source_year_column",
      codeSource: score.codeSource ?? "source_stock_code",
      sourceFile: score.sourceFile,
      sourceSheet: score.sourceSheet,
      sourceRow: score.sourceRow,
    },
    versions: { schema: "metric-contract-v2", data: version, feature: "eaa-company-scores-v1", model: "EAA-ESI", score: "eaa-panel-v1", threshold: "review-threshold-v1" },
    computedAt: score.ingestedAt,
  } satisfies CompanyYearRecord;
}

function scoreCompanyRecords(snapshot: ReturnType<typeof netdiskSnapshot>, scopedCompanyIds: string[] = [], scopedReportYear?: number, version = currentDataVersion(eaaDataVersion), evidenceSampleLimit = 12, evidenceSampleCompanyIds = scopedCompanyIds): CompanyYearRecord[] {
  const evidenceByKey = new Map(persistedEvidenceSummaries(scopedCompanyIds, scopedReportYear).map((item) => [`${item.companyId}:${item.reportYear}`, item]));
  const evidenceItemsByKey = new Map<string, EvidenceItem[]>();
  for (const [key, items] of persistedEvidenceSamplesByKey(evidenceSampleLimit, evidenceSampleCompanyIds, scopedReportYear).entries()) evidenceItemsByKey.set(key, items);
  const annualFinancial = new Map(snapshot.financialRecords.filter((item) => item.fiscalPeriodEnd.endsWith("-12-31") && item.reportType === "A").map((item) => [`${item.companyId}:${item.reportYear}`, item]));
  const violationCounts = new Map<string, number>();
  snapshot.violationEvents.forEach((event) => event.violationYears.forEach((year) => {
    const key = `${event.companyId}:${year}`;
    violationCounts.set(key, (violationCounts.get(key) ?? 0) + 1);
  }));
  const industryByKey = new Map((snapshot.companyIndustries ?? []).map((item) => [`${item.stockCode}:${item.reportYear}`, item.industryGroup || item.industryName]));
  const documentKeys = new Set((snapshot.pdfDocuments ?? []).flatMap((document) => document.stockCode && document.reportYear ? [`stock-${document.stockCode}:${document.reportYear}`] : []));
  const scoreYearsByCompany = new Map<string, number[]>();
  for (const score of snapshot.companyScores ?? []) {
    const years = scoreYearsByCompany.get(score.companyId) ?? [];
    years.push(score.reportYear);
    scoreYearsByCompany.set(score.companyId, years);
  }
  for (const failed of persistedFailedPdfIdentities()) {
    const reportYear = alignReportYearToScores(failed.reportYear, scoreYearsByCompany.get(failed.companyId) ?? []);
    if (reportYear) documentKeys.add(`${failed.companyId}:${reportYear}`);
  }
  const records = (snapshot.companyScores ?? []).map((score) => scoreCompanyRecord(
    score,
    annualFinancial.get(`${score.companyId}:${score.reportYear}`),
    evidenceByKey.get(`${score.companyId}:${score.reportYear}`),
    violationCounts.get(`${score.companyId}:${score.reportYear}`) ?? 0,
    industryByKey.get(`${score.stockCode}:${score.reportYear}`) ?? "未分类",
    evidenceItemsByKey.get(`${score.companyId}:${score.reportYear}`) ?? [],
    documentKeys.has(`${score.companyId}:${score.reportYear}`),
    version,
  )).sort((a, b) => b.reportYear - a.reportYear || a.stockCode.localeCompare(b.stockCode));
  return records;
}

function pdfEvidenceCompanyRecords(snapshot: ReturnType<typeof netdiskSnapshot>): CompanyYearRecord[] {
  const version = currentDataVersion(dataVersion);
  const evidenceByKey = new Map(persistedEvidenceSummaries().map((item) => [`${item.companyId}:${item.reportYear}`, item]));
  const evidenceItemsByKey = new Map<string, EvidenceItem[]>();
  for (const [key, items] of persistedEvidenceSamplesByKey().entries()) evidenceItemsByKey.set(key, items);
  const documentsByKey = new Map<string, ReturnType<typeof persistedPdfDocuments>>();
  for (const document of persistedPdfDocuments()) {
    const reportYear = resolvedDocumentYear(document);
    if (document.kind !== "esg_report" || !document.stockCode || !reportYear) continue;
    const key = `stock-${document.stockCode}:${reportYear}`;
    const group = documentsByKey.get(key) ?? [];
    group.push(document); documentsByKey.set(key, group);
  }
  const annualFinancial = new Map(snapshot.financialRecords.filter((item) => item.fiscalPeriodEnd.endsWith("-12-31") && item.reportType === "A").map((item) => [`${item.companyId}:${item.reportYear}`, item]));
  const violationCounts = new Map<string, number>();
  snapshot.violationEvents.forEach((event) => event.violationYears.forEach((year) => {
    const key = `${event.companyId}:${year}`; violationCounts.set(key, (violationCounts.get(key) ?? 0) + 1);
  }));

  return [...documentsByKey.entries()].map(([key, documents]) => {
    const latest = [...documents].sort((a, b) => b.ingestedAt.localeCompare(a.ingestedAt))[0];
    const companyId = `stock-${latest.stockCode}`;
    const reportYear = resolvedDocumentYear(latest)!;
    const evidence = evidenceByKey.get(key);
    const evidenceItems = evidenceItemsByKey.get(key) ?? [];
    const total = evidence?.total ?? 0;
    const implemented = evidence?.implemented ?? 0;
    const planning = evidence?.planning ?? 0;
    const indeterminate = evidence?.indeterminate ?? 0;
    const unverifiedPlanning = evidence?.unverifiedPlanning ?? 0;
    const verifiedPlanning = Math.max(0, planning - unverifiedPlanning);
    const eass = ratio(implemented + planningAlpha * planning, implemented + planning + indeterminate);
    const ir = ratio(indeterminate, implemented + planning + indeterminate);
    const upr = ratio(unverifiedPlanning, planning);
    const redFlags: CompanyYearRecord["riskClassification"]["redFlags"] = [];
    if (eass != null && eass <= 0.5) redFlags.push("LOW_EASS");
    if (ir != null && ir >= 0.33) redFlags.push("HIGH_IR");
    if (upr != null && upr >= 0.6) redFlags.push("HIGH_UPR");
    const financial = annualFinancial.get(key);
    const companyName = financial?.companyName ?? latest.companyName?.replace(/^\d{6}\s*/, "") ?? latest.stockCode!;
    const evidenceCoverage = total ? Math.round((1 - (evidence?.insufficient ?? 0) / total) * 100) : 0;
    const publishDate = latest.filename.match(/_(\d{4}-\d{2}-\d{2})_/)?.[1] ?? latest.ingestedAt.slice(0, 10);
    const sourceFile = documents.map((item) => item.filename).join("; ");
    const topics = deriveEsgTopics(evidenceItems);
    const topicAvailable = evidenceItems.length > 0;
    const metrics = [
      metric("EASS", "Environmental action substance", eass, eass == null ? null : 1 - eass, { numerator: implemented + planningAlpha * planning, denominator: implemented + planning + indeterminate, threshold: 0.5, evidenceIds: evidenceIdsForMetric("EASS", evidenceItems) }),
      metric("IR", "Indeterminate statement ratio", ir, ir, { numerator: indeterminate, denominator: implemented + planning + indeterminate, threshold: 0.33, evidenceIds: evidenceIdsForMetric("IR", evidenceItems) }),
      metric("UPR", "Unverified planning ratio", upr, upr, { numerator: unverifiedPlanning, denominator: planning, threshold: 0.6, evidenceIds: evidenceIdsForMetric("UPR", evidenceItems) }),
      metric("ESGSI", "Rhetoric-content gap", null, null, { unavailableReason: "Sentiment and substantive-information model outputs have not been connected." }),
      metric("EAA_ESI", "Environment-action-adjusted risk index", null, null, { unavailableReason: "E-AA requires a calculated ESGSI input and cohort normalization." }),
      metric("IMBALANCE", "ESG topic imbalance", topicAvailable ? topics.imbalanceScore : null, topicAvailable ? topics.imbalanceScore : null, {
        evidenceIds: evidenceIdsForMetric("IMBALANCE", evidenceItems),
        formulaVersion: "esg-topics-v1",
        normalizationVersion: topicAvailable ? "identity-v1" : "not_available",
        normalizationScope: topicAvailable ? "none" : "none",
        ...(topicAvailable ? {} : { unavailableReason: "No evidence text is available for E/S/G topic extraction." }),
      }),
    ];
    return {
      id: `${companyId}:${reportYear}`, reportId: latest.id, companyId, companyName, stockCode: latest.stockCode!, industry: "未分类", reportYear, publishDate,
      finalIndexRaw: null, finalIndex: null, riskBand: "unavailable" as const, evidenceCoverage,
      evidenceStatus: total === 0 || evidenceCoverage < 70 ? "insufficient" as const : "pending" as const,
      evidenceLinkageStatus: total > 0 ? (evidenceCoverage < 70 ? "low_coverage" as const : "linked" as const) : "parse_failed" as const,
      reviewStatus: "pending" as const, eventCount: violationCounts.get(key) ?? 0,
      textProcessing: { textLength: 0, totalWords: 0, sentenceCount: total, environmentalSentenceCount: total, tokenCount: deriveTokenCount(0, evidenceItems) },
      esgTopics: topics,
      environmentalActions: { totalStatements: implemented + planning + indeterminate, implemented, planning, indeterminate, planningAlpha },
      planningVerification: { totalPlanning: planning, verifiedPlanning, unverifiedPlanning, requiredAttributes: ["deadline", "quantified_target", "implementation_path", "responsible_entity"], ruleVersion: "planning-verification-v1" },
      scoreInputs: { sentiment: { rawValue: null, normalizedValue: null, normalizationVersion: "not_available", normalizationScope: "none" }, sustainability: { rawValue: null, normalizedValue: null, normalizationVersion: "not_available", normalizationScope: "none" } },
      scoringParameters: parameters, metrics,
      indexBreakdown: { baseEsgsiNormalized: null, actionPenalty: { inputValue: eass == null ? null : 1 - eass, weight: parameters.lambdaAction, contribution: eass == null ? null : parameters.lambdaAction * (1 - eass) }, indeterminatePenalty: { inputValue: ir, weight: parameters.lambdaIndeterminate, contribution: ir == null ? null : parameters.lambdaIndeterminate * ir }, planningPenalty: { inputValue: upr, weight: parameters.lambdaPlanning, contribution: upr == null ? null : parameters.lambdaPlanning * upr }, evidenceAdjustment: { inputValue: evidenceCoverage / 100, weight: evidenceAdjustmentWeight, contribution: evidenceAdjustmentWeight * Math.max(0, evidenceCoverageBaseline - evidenceCoverage / 100) }, finalRaw: null, finalNormalized: null, normalizationVersion: "not_available", normalizationScope: "none" },
      riskClassification: { baseRisk: "unavailable", redFlags, redFlagCount: redFlags.length, assignedBand: "unavailable", classificationVersion: "live-signal-v1", reason: "EASS, IR and UPR are live review signals; final risk remains unavailable until ESGSI is connected." },
      panelMetadata: { sampleGroup: sampleGroup(total), includeNGe10: total >= 10, includeNGe20: total >= 20, analysisScope: "read-only Baidu Netdisk PDF evidence", lowSentenceCountFlag: total < 10, recommendedUse: "Review signal only", yearsAvailable: 1, firstYear: reportYear, lastYear: reportYear, duplicateCount: documents.length, selectedForPanel: total >= 10, qualityFlags: [...(financial ? [] : ["FINANCIAL_RECORD_MISSING"]), ...(total ? [] : ["PDF_EVIDENCE_MISSING"]), "ESGSI_MODEL_NOT_CONNECTED"], reportYearTextCheck: "derived_from_document_metadata", codeSource: "pdf_filename", sourceFile, sourceSheet: "PDF", sourceRow: 1 },
      versions: { schema: "metric-contract-v2", data: version, feature: "pdf-evidence-v1", model: "not_connected", score: "partial-live-v1", threshold: "review-threshold-v1" },
      computedAt: latest.ingestedAt,
    } satisfies CompanyYearRecord;
  }).sort((a, b) => b.reportYear - a.reportYear || a.stockCode.localeCompare(b.stockCode));
}

const recordsCache = globalThis as typeof globalThis & {
  __greenlensLiveRecords?: { revision: string; records: CompanyYearRecord[] };
  __greenlensDataRevision?: { expiresAt: number; value: string };
};

export function liveDataRevision(): string {
  const cached = recordsCache.__greenlensDataRevision;
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = runtimeDataRevision();
  recordsCache.__greenlensDataRevision = { expiresAt: Date.now() + 2_000, value };
  return value;
}

export function liveCompanyRecords(): CompanyYearRecord[] {
  const revision = liveDataRevision();
  const cached = recordsCache.__greenlensLiveRecords;
  if (cached?.revision === revision) return cached.records;
  const snapshot = netdiskSnapshot();
  const records = snapshot.companyScores?.length ? scoreCompanyRecords(snapshot) : pdfEvidenceCompanyRecords(snapshot);
  recordsCache.__greenlensLiveRecords = { revision, records };
  return records;
}

export function liveHistories(records = liveCompanyRecords()): CompanyMetricHistoryPoint[] {
  const version = currentDataVersion(dataVersion);
  return records.map((record) => ({ companyId: record.companyId, reportYear: record.reportYear, finalIndexRaw: record.finalIndexRaw, finalIndex: record.finalIndex, riskBand: record.riskBand, metrics: Object.fromEntries(record.metrics.map((item) => [item.code, { rawValue: item.rawValue, normalizedValue: item.normalizedValue, riskValue: item.riskValue, calculationStatus: item.calculationStatus }])), dataVersion: version }));
}

function projectedScoreHistoryRecords(rows: DashboardScoreHistoryRow[], version: string): CompanyMetricHistoryPoint[] {
  const value = (rawValue: number | null, normalizedValue: number | null, riskValue: number | null) => ({
    rawValue, normalizedValue, riskValue,
    calculationStatus: normalizedValue == null ? "unavailable" as const : "calculated" as const,
  });
  return rows.map((row) => ({
    companyId: row.companyId, reportYear: row.reportYear, finalIndexRaw: row.eaaEsiRaw, finalIndex: row.eaaEsiNorm,
    riskBand: riskBandFromLabel(row.riskLevel),
    metrics: {
      EASS: value(row.eass, row.eass, row.eass == null ? null : 1 - row.eass),
      IR: value(row.ir, row.ir, row.ir), UPR: value(row.upr, row.upr, row.upr),
      ESGSI: value(row.esgsiRaw, row.esgsiNorm, row.esgsiNorm), EAA_ESI: value(row.eaaEsiRaw, row.eaaEsiNorm, row.eaaEsiNorm),
    },
    dataVersion: version,
  }));
}

function projectedScoreQualityRecords(rows: DashboardScoreHistoryRow[]): PanelYearSummary[] {
  const years = new Map<number, DashboardScoreHistoryRow[]>();
  for (const row of rows) years.set(row.reportYear, [...(years.get(row.reportYear) ?? []), row]);
  return [...years.entries()].map(([year, items]) => ({
    year, sourceFile: "Baidu Netdisk company score panel",
    sourceRows: items.reduce((sum, item) => sum + item.environmentalSentenceCount, 0), uniqueCompanyYears: items.length,
    duplicateGroups: items.filter((item) => item.duplicateCount > 1).length,
    extraDuplicateRows: items.reduce((sum, item) => sum + Math.max(0, item.duplicateCount - 1), 0),
    selectedNLt10: items.filter((item) => item.sampleGroup === "low_n_lt_10").length,
    selectedN10To19: items.filter((item) => item.sampleGroup === "robustness_n_10_19").length,
    selectedNGe20: items.filter((item) => item.sampleGroup === "main_n_ge_20").length,
    titleTargetYearNotFound: 0, qualityFlaggedRows: items.filter((item) => item.qualityFlagCount > 1).length, codeRecoveredFromCompany: 0,
  })).sort((a, b) => a.year - b.year);
}

export function liveQuality(records = liveCompanyRecords()): PanelYearSummary[] {
  const years = new Map<number, CompanyYearRecord[]>();
  records.forEach((record) => {
    const annual = years.get(record.reportYear) ?? [];
    annual.push(record);
    years.set(record.reportYear, annual);
  });
  return [...years.entries()].map(([year, items]) => ({ year, sourceFile: "Baidu Netdisk PDF queue", sourceRows: items.reduce((sum, item) => sum + item.textProcessing.environmentalSentenceCount, 0), uniqueCompanyYears: items.length, duplicateGroups: items.filter((item) => item.panelMetadata.duplicateCount > 1).length, extraDuplicateRows: items.reduce((sum, item) => sum + Math.max(0, item.panelMetadata.duplicateCount - 1), 0), selectedNLt10: items.filter((item) => item.panelMetadata.sampleGroup === "low_n_lt_10").length, selectedN10To19: items.filter((item) => item.panelMetadata.sampleGroup === "robustness_n_10_19").length, selectedNGe20: items.filter((item) => item.panelMetadata.sampleGroup === "main_n_ge_20").length, titleTargetYearNotFound: 0, qualityFlaggedRows: items.filter((item) => item.panelMetadata.qualityFlags.length > 1).length, codeRecoveredFromCompany: 0 })).sort((a, b) => a.year - b.year);
}

const dashboardCache = globalThis as typeof globalThis & {
  __greenlensDashboardCache?: Map<string, { revision: string; expiresAt: number; value: DashboardCommandCenterData }>;
};
const dashboardCacheTtlMs = 5 * 60_000;
const dashboardCacheMaxEntries = 24;

export function liveDashboard(query: CompanyYearQuery = {}, options: { light?: boolean } = {}): DashboardCommandCenterData {
  const profile = (stage: string) => {
    const memory = process.memoryUsage();
    if (process.env.GREENLENS_PROFILE_DASHBOARD !== "1") return;
    console.log(JSON.stringify({ event: "dashboard-profile", stage, heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024), rssMb: Math.round(memory.rss / 1024 / 1024) }));
  };
  profile("start");
  const revision = liveDataRevision();
  profile("revision");
  const cache = dashboardCache.__greenlensDashboardCache ??= new Map();
  const cacheKey = JSON.stringify({
    format: "dashboard-summary-v1",
    year: query.year ?? null,
    industry: query.industry ?? null,
    riskBand: query.riskBand ?? null,
    sampleGroup: query.sampleGroup ?? null,
    light: options.light === true,
  });
  const cached = cache.get(cacheKey);
  if (cached?.revision === revision && cached.expiresAt > Date.now()) return cached.value;
  if (options.light === true) {
    const persisted = readDashboardPersistentCache<DashboardCommandCenterData>(cacheKey, revision);
    if (persisted) {
      cache.set(cacheKey, { revision, expiresAt: Date.now() + dashboardCacheTtlMs, value: persisted });
      return persisted;
    }
  }
  const snapshot = loadDashboardSqliteSnapshot(query);
  profile("snapshot");
  const scores = snapshot.companyScores as unknown as CompanyScoreRecord[];
  const historyRows = loadDashboardScoreHistoryRows(snapshot.selectedCompanyIds, snapshot.resolvedYear);
  const currentSnapshot = { ...snapshot, companyScores: scores.filter((score) => score.reportYear === snapshot.resolvedYear) };
  const evidenceSampleCompanyIds = options.light
    ? sampledDashboardCompanyIds(currentSnapshot.companyScores)
    : snapshot.selectedCompanyIds;
  const records = currentSnapshot.companyScores.length
    ? scoreCompanyRecords(currentSnapshot as unknown as ReturnType<typeof netdiskSnapshot>, snapshot.selectedCompanyIds, snapshot.resolvedYear, `${eaaDataVersion}:${revision}`, options.light ? 3 : 12, evidenceSampleCompanyIds)
    : [];
  profile("records");
  const resolvedQuery = { ...query, year: snapshot.resolvedYear };
  const histories = projectedScoreHistoryRecords(historyRows, `${dataVersion}:${revision}`);
  const quality = projectedScoreQualityRecords(historyRows);
  const dashboard = buildDashboardCommandCenter(records, histories, quality, resolvedQuery, {
    ...options,
    gsiRecords: listGsiScoreRecords(snapshot.selectedCompanyIds, snapshot.resolvedYear),
  });
  profile("dashboard");
  releaseSqliteMemory();
  profile("sqlite-shrink");
  cache.delete(cacheKey);
  cache.set(cacheKey, { revision, expiresAt: Date.now() + dashboardCacheTtlMs, value: dashboard });
  if (options.light === true) writeDashboardPersistentCache(cacheKey, revision, dashboard);
  while (cache.size > dashboardCacheMaxEntries) cache.delete(cache.keys().next().value!);
  return dashboard;
}

function sampledDashboardCompanyIds(scores: CompanyScoreRecord[]): string[] {
  const selected: string[] = [];
  const selectedIds = new Set<string>();
  for (const band of ["high", "medium", "low", "unavailable"] as RiskBand[]) {
    let bandCount = 0;
    for (const score of scores) {
      if (riskBandFromLabel(score.riskLevel) !== band || selectedIds.has(score.companyId)) continue;
      selected.push(score.companyId);
      selectedIds.add(score.companyId);
      bandCount += 1;
      if (selected.length >= lightNodeMaxTotal || bandCount >= lightNodeLimitPerBand) break;
    }
    if (selected.length >= lightNodeMaxTotal) break;
  }
  return selected;
}

export function filterLiveCompanies(query: CompanyYearQuery = {}) {
  const records = liveCompanyRecords();
  const availableYears = [...new Set(records.map((record) => record.reportYear))];
  const year = query.year != null && availableYears.includes(query.year) ? query.year : availableYears.length ? Math.max(...availableYears) : new Date().getFullYear();
  return records.filter((record) => record.reportYear === year
    && (!query.industry || query.industry === "全部行业" || record.industry === query.industry)
    && (!query.riskBand || record.riskBand === query.riskBand)
    && (!query.sampleGroup || record.panelMetadata.sampleGroup === query.sampleGroup));
}

export function liveEvidence(companyId: string, reportYear?: number): EvidenceItem[] { return persistedEvidenceItems(companyId, reportYear); }
export function liveEnvironmentalAspects(companyId: string, reportYear: number): EnvironmentalAspectScore[] { return persistedEnvironmentalAspects(companyId, reportYear); }
export function liveGsiScore(companyId: string, reportYear: number) {
  return listGsiScoreRecords([companyId], reportYear).find((item) => item.companyId === companyId && item.reportYear === reportYear) ?? null;
}
