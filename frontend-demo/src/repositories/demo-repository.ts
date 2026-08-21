import { companies, companyHistory, environmentalAspects, esgRatings, evidence, financialRecords, gsiScoreRecords, panelYearSummaries, violationEvents } from "@/mocks/fixtures/companies";
import { dashboardInsights } from "@/mocks/fixtures/dashboard";
import {
  analysisJobSchema,
  companyMetricHistoryPointSchema,
  companyYearListSchema,
  dashboardCommandCenterSchema,
  dashboardConstellationNodeSchema,
  dashboardInsightsSchema,
  dataSourceStatusSchema,
  dataSourceSyncJobSchema,
  esgRatingRecordSchema,
  environmentalAspectScoreSchema,
  evidenceItemSchema,
  financialYearRecordSchema,
  gsiScoreRecordSchema,
  panelYearSummarySchema,
  reviewRecordSchema,
  reviewQueueActionSchema,
  riskInterpretationSchema,
  sourceFieldCatalogSchema,
  sourceFileRecordSchema,
  violationEventSchema,
} from "@/contracts/analysis";
import { buildDashboardCommandCenter } from "@/repositories/dashboard-command-center";
import { buildRiskInterpretation } from "@/lib/risk-interpretation";
import type { AnalysisRepository, CompanyYearQuery, DemoScenario } from "@/repositories/analysis-repository";
import type { AnalysisJob, DataSourceSyncJob, MetricCode, ReviewQueueAction, ReviewRecord, SourceFileRecord } from "@/types";

export type { DemoScenario } from "@/repositories/analysis-repository";

async function wait(scenario: DemoScenario) {
  if (process.env.NODE_ENV !== "test") {
    await new Promise((resolve) => setTimeout(resolve, scenario === "slow" ? 900 : 180));
  }
  if (scenario === "error") throw new Error("演示数据载入失败");
}

interface StoredAnalysisJob {
  job: AnalysisJob;
  createdAt: number;
  fileName: string;
}

const jobs = new Map<string, StoredAnalysisJob>();
const reviewQueueActions = new Map<string, ReviewQueueAction>();
const reviewQueueActionStorageKey = "greenlens-demo-review-queue-actions";
const sourceSyncJobs = new Map<string, DataSourceSyncJob>();
const syntheticSourceFiles: SourceFileRecord[] = [
  {
    id: "source-finance-workbook", provider: "baidu_netdisk", path: "/greenwashing/financial", filename: "financial-indicators.xlsx",
    fsid: "synthetic-fsid-finance", size: 1_024, kind: "financial_workbook", parseStatus: "ready",
    discoveredAt: "2026-08-03T00:00:00.000Z", detectedFields: ["Stkcd", "ShortName", "Accper", "F011201A", "F050201B", "A001000000"], qualityFlags: [],
  },
  {
    id: "source-violation-workbook", provider: "baidu_netdisk", path: "/greenwashing/violations", filename: "violation-events.xlsx",
    fsid: "synthetic-fsid-violation", size: 2_048, kind: "violation_workbook", parseStatus: "schema_pending",
    discoveredAt: "2026-08-03T00:00:00.000Z", detectedFields: [], qualityFlags: ["SCHEMA_INSPECTION_REQUIRED"],
  },
];
const syntheticSourceFieldCatalogs = new Map([
  ["source-finance-workbook", {
    sourceFileId: "source-finance-workbook", sheetName: "Sheet1", fields: [
      { sourceField: "Stkcd", targetField: "stockCode", dataType: "string", required: true, status: "mapped" },
      { sourceField: "ShortName", targetField: "companyName", dataType: "string", required: true, status: "mapped" },
      { sourceField: "Accper", targetField: "fiscalPeriodEnd", dataType: "date", required: true, status: "mapped" },
      { sourceField: "F011201A", targetField: "assetLiabilityRatio", dataType: "number", required: false, status: "mapped" },
      { sourceField: "F050201B", targetField: "roaA", dataType: "number", required: false, status: "mapped" },
      { sourceField: "A001000000", targetField: "totalAssets", dataType: "number", required: false, status: "mapped" },
    ],
  }],
]);
const validatedCompanies = companyYearListSchema.parse(companies);
const validatedEvidence = evidenceItemSchema.array().parse(evidence);
const validatedAspects = environmentalAspectScoreSchema.array().parse(environmentalAspects);
const validatedHistory = companyMetricHistoryPointSchema.array().parse(companyHistory);
const validatedFinancials = financialYearRecordSchema.array().parse(financialRecords);
const validatedPanelYearSummaries = panelYearSummarySchema.array().parse(panelYearSummaries);
const validatedViolationEvents = violationEventSchema.array().parse(violationEvents);
const validatedEsgRatings = esgRatingRecordSchema.array().parse(esgRatings);
const validatedGsiScoreRecords = gsiScoreRecordSchema.array().parse(gsiScoreRecords);
const validatedDashboardInsights = dashboardInsightsSchema.parse(dashboardInsights);
const validatedSourceFiles = sourceFileRecordSchema.array().parse(syntheticSourceFiles);

function advanceJob(stored: StoredAnalysisJob): AnalysisJob {
  const elapsed = Date.now() - stored.createdAt;
  const lowerName = stored.fileName.toLowerCase();

  if (elapsed >= 1_400 && (lowerName.includes("broken") || lowerName.includes("scan"))) {
    return {
      ...stored.job,
      status: "failed",
      phase: "extract",
      progress: 42,
      error: lowerName.includes("scan")
        ? { cause: "报告没有可解析文本层，可能是扫描件。", impact: "声明与行动证据尚未抽取，不能计算风险指标。", nextAction: "启用 OCR 后重新提交任务。" }
        : { cause: "报告文本层损坏或编码不可解析。", impact: "声明与行动证据尚未抽取，不能计算风险指标。", nextAction: "更换文本版 PDF，或启用 OCR 后重新提交任务。" },
    };
  }

  if (elapsed < 500) return { ...stored.job, status: "queued", phase: "collect", progress: 4 };
  if (elapsed < 1_000) return { ...stored.job, status: "running", phase: "collect", progress: 12 };
  if (elapsed < 1_500) return { ...stored.job, status: "running", phase: "preprocess", progress: 28 };
  if (elapsed < 2_000) return { ...stored.job, status: "running", phase: "extract", progress: 45 };
  if (elapsed < 2_500) return { ...stored.job, status: "running", phase: "classify", progress: 63 };
  if (elapsed < 3_000) return { ...stored.job, status: "running", phase: "calculate", progress: 81 };
  if (elapsed < 3_500) return { ...stored.job, status: "running", phase: "risk", progress: 94 };
  return { ...stored.job, status: "completed", phase: "risk", progress: 100 };
}

export const demoRepository: AnalysisRepository = {
  async listCompanies(scenario: DemoScenario = "success", query: CompanyYearQuery = {}) {
    await wait(scenario);
    if (scenario === "empty") return [];
    return structuredClone(validatedCompanies.filter((company) =>
      (!query.year || company.reportYear === query.year)
      && (!query.industry || query.industry === "全部行业" || company.industry === query.industry)
      && (!query.riskBand || company.riskBand === query.riskBand)
      && (!query.sampleGroup || company.panelMetadata.sampleGroup === query.sampleGroup),
    ));
  },
  async getCompany(id: string, scenario: DemoScenario = "success", reportYear?: number) {
    await wait(scenario);
    return structuredClone(validatedCompanies.find((company) => company.companyId === id && (!reportYear || company.reportYear === reportYear)) ?? null);
  },
  async listEvidence(companyId: string, scenario: DemoScenario = "success", reportYear?: number) {
    await wait(scenario);
    return scenario === "empty" ? [] : structuredClone(validatedEvidence.filter((item) => item.companyId === companyId && (!reportYear || item.reportYear === reportYear)));
  },
  async getEvidencePageText(companyId: string, evidenceId: string, page?: number) {
    const item = validatedEvidence.find((entry) => entry.companyId === companyId && entry.id === evidenceId);
    if (!item) return null;
    return {
      evidenceId: item.id,
      companyId,
      reportYear: item.reportYear,
      documentId: `demo-document-${item.sourceLabel}`,
      sourceLabel: item.sourceLabel,
      page: page ?? item.page ?? 1,
      pageCount: 86,
      text: item.excerpt,
    };
  },
  async listEnvironmentalAspects(companyId: string, reportYear: number) {
    return structuredClone(validatedAspects.filter((item) => item.companyId === companyId && item.reportYear === reportYear));
  },
  async getCompanyHistory(companyId: string, options: { fromYear?: number; toYear?: number; metrics?: MetricCode[] } = {}) {
    return structuredClone(validatedHistory
      .filter((item) => item.companyId === companyId && (!options.fromYear || item.reportYear >= options.fromYear) && (!options.toYear || item.reportYear <= options.toYear))
      .map((item) => options.metrics?.length
        ? { ...item, metrics: Object.fromEntries(Object.entries(item.metrics).filter(([code]) => options.metrics!.includes(code as MetricCode))) }
        : item));
  },
  async getFinancialYear(companyId: string, reportYear: number) {
    return structuredClone(validatedFinancials.find((item) => item.companyId === companyId && item.reportYear === reportYear) ?? null);
  },
  async listViolationEvents(companyId: string, options: { reportYear?: number; fromYear?: number; toYear?: number } = {}) {
    return structuredClone(validatedViolationEvents.filter((item) => {
      if (item.companyId !== companyId) return false;
      if (options.reportYear != null && !item.violationYears.includes(options.reportYear)) return false;
      if (options.fromYear != null && item.violationYears.every((year) => year < options.fromYear!)) return false;
      if (options.toYear != null && item.violationYears.every((year) => year > options.toYear!)) return false;
      return true;
    }));
  },
  async listEsgRatings(companyId: string, options: { fromYear?: number; toYear?: number; vendor?: string } = {}) {
    return structuredClone(validatedEsgRatings.filter((item) => item.companyId === companyId
      && (!options.fromYear || item.reportYear >= options.fromYear)
      && (!options.toYear || item.reportYear <= options.toYear)
      && (!options.vendor || item.vendor === options.vendor)));
  },
  async listPanelYearSummaries(options: { fromYear?: number; toYear?: number } = {}) {
    return structuredClone(validatedPanelYearSummaries.filter((item) =>
      (!options.fromYear || item.year >= options.fromYear) && (!options.toYear || item.year <= options.toYear),
    ));
  },
  async getDashboardCommandCenter(scenario: DemoScenario = "success", query: CompanyYearQuery = {}) {
    await wait(scenario);
    const payload = buildDashboardCommandCenter(
      scenario === "empty" ? [] : validatedCompanies,
      scenario === "empty" ? [] : validatedHistory,
      scenario === "empty" ? [] : validatedPanelYearSummaries,
      query,
      { light: query.light === true, gsiRecords: scenario === "empty" ? [] : validatedGsiScoreRecords },
    );
    return structuredClone(dashboardCommandCenterSchema.parse(payload));
  },
  async getDashboardConstellation(scenario: DemoScenario = "success", query: CompanyYearQuery = {}) {
    const dashboard = await this.getDashboardCommandCenter(scenario, { ...query, light: false });
    return dashboardConstellationNodeSchema.array().parse(dashboard.riskNodes.map((node) => ({
      companyId: node.companyId, companyName: node.companyName, stockCode: node.stockCode, industry: node.industry,
      reportYear: node.reportYear, esgsi: node.metricRiskValues.ESGSI, eass: node.eass, finalIndex: node.finalIndex, riskBand: node.riskBand,
    })));
  },
  async getDashboardInsights(scenario: DemoScenario = "success") {
    await wait(scenario);
    return structuredClone(scenario === "empty" ? { reviewTasks: [], reviewTrend: [], modelAgreement: [], sourceFreshness: [], evidenceCoverage: [] } : validatedDashboardInsights);
  },
  async getRiskInterpretation(companyId, reportYear, focus = "overview") {
    const company = validatedCompanies.find((item) => item.companyId === companyId && item.reportYear === reportYear);
    if (!company) throw new Error(`未找到 ${companyId} 的 ${reportYear} 年公司记录。`);
    const result = buildRiskInterpretation({
      company,
      cohort: validatedCompanies.filter((item) => item.reportYear === reportYear),
      evidence: validatedEvidence.filter((item) => item.companyId === companyId && item.reportYear === reportYear),
      history: validatedHistory.filter((item) => item.companyId === companyId),
      gsi: validatedGsiScoreRecords.find((item) => item.companyId === companyId && item.reportYear === reportYear) ?? null,
      focus,
    });
    return structuredClone(riskInterpretationSchema.parse(result));
  },
  async createAnalysisJob(input) {
    const job: AnalysisJob = { jobId: crypto.randomUUID(), reportId: `report-${Date.now()}`, status: "queued", phase: "collect", progress: 0, resultCompanyId: input.companyId };
    jobs.set(job.jobId, { job, createdAt: Date.now(), fileName: input.fileName });
    return structuredClone(analysisJobSchema.parse(job));
  },
  async getAnalysisJob(jobId) {
    const stored = jobs.get(jobId);
    if (!stored) throw new Error("未找到检测任务。请重新提交报告。");
    const job = advanceJob(stored);
    stored.job = job;
    return structuredClone(analysisJobSchema.parse(job));
  },
  async cancelAnalysisJob(jobId) {
    const stored = jobs.get(jobId);
    if (!stored) throw new Error("未找到检测任务。请重新提交报告。");
    stored.job = { ...stored.job, status: "cancelled", stage: "cancelled", error: undefined };
    return structuredClone(analysisJobSchema.parse(stored.job));
  },
  async retryAnalysisJob(jobId) {
    const stored = jobs.get(jobId);
    if (!stored) throw new Error("未找到检测任务。请重新提交报告。");
    stored.createdAt = Date.now();
    stored.job = { ...stored.job, status: "queued", phase: "collect", stage: "uploaded", progress: 0, error: undefined };
    return structuredClone(analysisJobSchema.parse(stored.job));
  },
  async saveReview(review: ReviewRecord) { return structuredClone(reviewRecordSchema.parse(review)); },
  async listReviewQueueActions() {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(reviewQueueActionStorageKey);
      if (stored) {
        for (const action of reviewQueueActionSchema.array().parse(JSON.parse(stored))) reviewQueueActions.set(action.taskId, action);
      }
    }
    return structuredClone([...reviewQueueActions.values()]);
  },
  async saveReviewQueueAction(action: ReviewQueueAction) {
    const parsed = reviewQueueActionSchema.parse(action);
    reviewQueueActions.set(parsed.taskId, parsed);
    if (typeof window !== "undefined") window.localStorage.setItem(reviewQueueActionStorageKey, JSON.stringify([...reviewQueueActions.values()]));
    return structuredClone(parsed);
  },
  async getBaiduNetdiskStatus() {
    return structuredClone(dataSourceStatusSchema.parse({
      provider: "baidu_netdisk", rootPath: "/greenwashing", connectionStatus: "connected", lastSyncedAt: "2026-08-03T00:00:00.000Z",
      fileCount: validatedSourceFiles.length, readyFileCount: 1, schemaPendingFileCount: 1,
    }));
  },
  async listBaiduNetdiskFiles(options = {}) {
    return structuredClone(validatedSourceFiles.filter((file) =>
      (!options.path || file.path.startsWith(options.path))
      && (!options.kind || file.kind === options.kind)
      && (!options.parseStatus || file.parseStatus === options.parseStatus),
    ));
  },
  async getBaiduNetdiskFieldCatalog(sourceFileId: string) {
    const catalog = syntheticSourceFieldCatalogs.get(sourceFileId);
    if (!catalog) throw new Error("Source file schema is not available. Run schema inspection first.");
    return structuredClone(sourceFieldCatalogSchema.parse(catalog));
  },
  async createBaiduNetdiskSync() {
    const job: DataSourceSyncJob = {
      jobId: crypto.randomUUID(), provider: "baidu_netdisk", status: "queued", phase: "discover", progress: 0,
      discoveredFileCount: 0, readyFileCount: 0,
    };
    sourceSyncJobs.set(job.jobId, job);
    return structuredClone(dataSourceSyncJobSchema.parse(job));
  },
  async getBaiduNetdiskSyncJob(jobId: string) {
    const job = sourceSyncJobs.get(jobId);
    if (!job) throw new Error("Data-source sync job was not found.");
    return structuredClone(dataSourceSyncJobSchema.parse(job));
  },
};
