import {
  companies,
  companyHistory,
  environmentalAspects,
  esgRatings,
  evidence,
  financialRecords,
  gsiScoreRecords,
  panelYearSummaries,
  violationEvents,
} from "@/mocks/fixtures/companies";
import { dashboardInsights } from "@/mocks/fixtures/dashboard";
import { buildDashboardCommandCenter } from "@/repositories/dashboard-command-center";
import type { CompanyYearQuery } from "@/repositories/analysis-repository";
import { getMetric } from "@/types";
import type {
  CompanyIndustryRecord,
  CompanyMetricHistoryPoint,
  CompanyYearRecord,
  DashboardConstellationNode,
  DataSourceStatus,
  DashboardCommandCenterData,
  DashboardInsights,
  EnvironmentalAspectScore,
  EsgRatingRecord,
  EvidenceItem,
  EvidencePageReference,
  FinancialYearRecord,
  GsiScoreRecord,
  PanelYearSummary,
  PdfDocumentRecord,
  SourceFileRecord,
  ViolationEvent,
} from "@/types";

/** Mock-data mode is enabled explicitly so the read-only API can be deployed
 *  without the SQLite ingestion boundary (e.g. a Vercel demo). */
export function isMockDataMode(): boolean {
  return process.env.GREENLENS_MOCK_DATA === "true";
}

export function mockCompanyRecords(): CompanyYearRecord[] {
  return companies;
}

export function mockHistories(): CompanyMetricHistoryPoint[] {
  return companyHistory;
}

export function mockQuality(): PanelYearSummary[] {
  return panelYearSummaries;
}

export function mockEvidence(companyId: string, reportYear?: number): EvidenceItem[] {
  return evidence.filter((item) => item.companyId === companyId && (!reportYear || item.reportYear === reportYear));
}

export function mockEnvironmentalAspects(companyId: string, reportYear: number): EnvironmentalAspectScore[] {
  return environmentalAspects.filter((item) => item.companyId === companyId && item.reportYear === reportYear);
}

export function mockGsiScore(companyId: string, reportYear: number): GsiScoreRecord | null {
  return gsiScoreRecords.find((item) => item.companyId === companyId && item.reportYear === reportYear) ?? null;
}

export function mockDashboard(query: CompanyYearQuery = {}, options: { light?: boolean } = {}): DashboardCommandCenterData {
  return buildDashboardCommandCenter(companies, companyHistory, panelYearSummaries, query, {
    ...options,
    gsiRecords: gsiScoreRecords,
  });
}

export function mockDashboardInsights(): DashboardInsights {
  return dashboardInsights;
}

export function mockFinancialRecord(companyId: string, reportYear: number): FinancialYearRecord | null {
  return financialRecords.find((item) => item.companyId === companyId && item.reportYear === reportYear && item.fiscalPeriodEnd.endsWith("-12-31")) ?? null;
}

export function mockViolationEvents(companyId: string, options: { reportYear?: number; fromYear?: number; toYear?: number } = {}): ViolationEvent[] {
  return violationEvents.filter((item) => item.companyId === companyId && item.violationYears.some((year) =>
    (options.reportYear == null || year === options.reportYear)
    && (options.fromYear == null || year >= options.fromYear)
    && (options.toYear == null || year <= options.toYear)));
}

export function mockEsgRatings(): EsgRatingRecord[] {
  return esgRatings;
}

export function mockIndustries(): CompanyIndustryRecord[] {
  return companies.map((company) => ({
    id: `industry-${company.companyId}-${company.reportYear}`,
    companyId: company.companyId,
    stockCode: company.stockCode,
    reportYear: company.reportYear,
    industryCode: company.industry,
    industryName: company.industry,
    industryGroup: company.industry,
    source: "synthetic-industry-map.csv",
    qualityFlag: "exact",
  }));
}

export function mockEvidencePageText(companyId: string, evidenceId: string, page?: number): EvidencePageReference | null {
  const item = evidence.find((entry) => entry.companyId === companyId && entry.id === evidenceId);
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
}

const mockSourceFileList: SourceFileRecord[] = [
  { id: "mock-finance", provider: "baidu_netdisk", path: "/greenwashing/financial", filename: "financial-indicators.xlsx", fsid: "mock-fsid-finance", size: 1_024, kind: "financial_workbook", parseStatus: "ready", discoveredAt: "2026-08-12T08:00:00.000Z", detectedFields: ["Stkcd", "ShortName", "Accper", "F011201A", "F050201B", "A001000000"], qualityFlags: [] },
  { id: "mock-violation", provider: "baidu_netdisk", path: "/greenwashing/violations", filename: "violation-events.xlsx", fsid: "mock-fsid-violation", size: 2_048, kind: "violation_workbook", parseStatus: "ready", discoveredAt: "2026-08-12T08:00:00.000Z", detectedFields: ["证券代码", "公告日期", "违规类型", "违规行为"], qualityFlags: [] },
  { id: "mock-score", provider: "baidu_netdisk", path: "/greenwashing/scores", filename: "company-level-scoring.xlsx", fsid: "mock-fsid-score", size: 3_072, kind: "company_score_workbook", parseStatus: "ready", discoveredAt: "2026-08-12T08:00:00.000Z", detectedFields: ["stock_code", "year", "EASS", "IR", "UPR", "EAA_ESI_raw", "EAA_ESI_norm"], qualityFlags: [] },
  { id: "mock-industry", provider: "baidu_netdisk", path: "/greenwashing/industry", filename: "company-industry.xlsx", fsid: "mock-fsid-industry", size: 1_536, kind: "company_industry_workbook", parseStatus: "ready", discoveredAt: "2026-08-12T08:00:00.000Z", detectedFields: ["stock_code", "report_year", "industry_name"], qualityFlags: [] },
  { id: "mock-rating", provider: "baidu_netdisk", path: "/greenwashing/ratings", filename: "esg-ratings.xlsx", fsid: "mock-fsid-rating", size: 4_096, kind: "esg_rating_workbook", parseStatus: "ready", discoveredAt: "2026-08-12T08:00:00.000Z", detectedFields: ["vendor", "stock_code", "report_year", "rating", "score"], qualityFlags: [] },
];

export function mockSourceFiles(): SourceFileRecord[] {
  return mockSourceFileList;
}

export function mockDataSourceStatus(): DataSourceStatus {
  return {
    provider: "baidu_netdisk",
    rootPath: "/greenwashing",
    connectionStatus: "connected",
    lastSyncedAt: "2026-08-12T08:00:00.000Z",
    fileCount: mockSourceFileList.length,
    readyFileCount: mockSourceFileList.length,
    schemaPendingFileCount: 0,
  };
}

export function mockRecordSummary() {
  return {
    financialRecordCount: financialRecords.length,
    companyScoreRecordCount: companies.length,
    companyScoreSourceFileCount: 1,
    companyIndustryRecordCount: companies.length,
    companyIndustrySourceFileCount: 1,
    esgRatingRecordCount: esgRatings.length,
    esgRatingVendorCount: new Set(esgRatings.map((item) => item.vendor)).size,
    esgRatingSourceFileCount: new Set(esgRatings.map((item) => item.sourceFile)).size,
    violationEventCount: violationEvents.length,
    pdfDocumentCount: companies.length,
    esgDocumentCount: companies.length,
    negativeNewsDocumentCount: 0,
    documentEvidenceCount: evidence.length,
    environmentalAspectCount: environmentalAspects.length,
    ocrRequiredDocumentCount: 0,
    companyCount: companies.length,
    yearFrom: 2016,
    yearTo: 2025,
  };
}

export function mockPdfQueueSummary() {
  return {
    total: companies.length,
    counts: { queued: 0, running: 0, completed: companies.length, failed: 0 },
    failureCategories: {},
    deferred: 0,
    current: null,
  };
}

export function mockEvidenceFunnel() {
  return {
    completedDocuments: companies.length,
    documentsWithTextPages: companies.length,
    identityResolvedDocuments: companies.length,
    evidenceExtractedDocuments: companies.length,
    linkedCompanyYearDocuments: companies.length,
    identityUnresolvedDocuments: 0,
    extractionFailedDocuments: 0,
    scoreUnmatchedDocuments: 0,
  };
}

export function mockConstellationNodes(query: CompanyYearQuery = {}): DashboardConstellationNode[] {
  const year = query.year ?? 2025;
  return companies
    .filter((company) => company.reportYear === year
      && (!query.industry || query.industry === "全部行业" || company.industry === query.industry)
      && (!query.riskBand || company.riskBand === query.riskBand)
      && (!query.sampleGroup || company.panelMetadata.sampleGroup === query.sampleGroup))
    .map((company) => ({
      companyId: company.companyId,
      companyName: company.companyName,
      stockCode: company.stockCode,
      industry: company.industry,
      reportYear: company.reportYear,
      esgsi: getMetric(company, "ESGSI")?.riskValue ?? null,
      eass: getMetric(company, "EASS")?.normalizedValue ?? null,
      finalIndex: company.finalIndex,
      riskBand: company.riskBand,
    }));
}

export function mockPdfDocuments(): PdfDocumentRecord[] {
  return companies.map((company) => ({
    id: `mock-pdf-${company.companyId}`,
    provider: "baidu_netdisk",
    fsid: `mock-fsid-pdf-${company.companyId}`,
    filename: `${company.stockCode}_${company.reportYear}可持续发展报告.pdf`,
    size: 2_400_000,
    kind: "esg_report",
    pageCount: 86,
    textPageCount: 86,
    textCoverage: 0.97,
    textMode: "text",
    stockCode: company.stockCode,
    companyName: company.companyName,
    reportYear: company.reportYear,
    parseStatus: "ready",
    qualityFlags: [],
    ingestedAt: "2026-08-12T08:00:00.000Z",
  }));
}
