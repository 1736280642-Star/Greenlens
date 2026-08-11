import type {
  AnalysisJob,
  DataSourceStatus,
  DataSourceSyncJob,
  CompanyMetricHistoryPoint,
  CompanyYearRecord,
  DashboardCommandCenterData,
  DashboardInsights,
  EsgRatingRecord,
  EnvironmentalAspectScore,
  EvidenceItem,
  EvidencePageReference,
  FinancialYearRecord,
  MetricCode,
  PanelYearSummary,
  ReviewRecord,
  ReviewQueueAction,
  RiskInterpretation,
  RiskInterpretationFocus,
  SourceFieldCatalog,
  SourceFileRecord,
  SampleGroup,
  ViolationEvent,
} from "@/types";

export type DemoScenario = "success" | "empty" | "error" | "slow";

export interface CompanyYearQuery {
  year?: number;
  industry?: string;
  riskBand?: string;
  sampleGroup?: SampleGroup;
  light?: boolean;
  page?: number;
  pageSize?: number;
}

export interface AnalysisRepository {
  listCompanies(scenario?: DemoScenario, query?: CompanyYearQuery): Promise<CompanyYearRecord[]>;
  getCompany(id: string, scenario?: DemoScenario, reportYear?: number): Promise<CompanyYearRecord | null>;
  listEvidence(companyId: string, scenario?: DemoScenario, reportYear?: number): Promise<EvidenceItem[]>;
  getEvidencePageText(companyId: string, evidenceId: string, page?: number): Promise<EvidencePageReference | null>;
  listEnvironmentalAspects(companyId: string, reportYear: number): Promise<EnvironmentalAspectScore[]>;
  getCompanyHistory(companyId: string, options?: { fromYear?: number; toYear?: number; metrics?: MetricCode[] }): Promise<CompanyMetricHistoryPoint[]>;
  getFinancialYear(companyId: string, reportYear: number): Promise<FinancialYearRecord | null>;
  listViolationEvents(companyId: string, options?: { reportYear?: number; fromYear?: number; toYear?: number }): Promise<ViolationEvent[]>;
  listEsgRatings(companyId: string, options?: { fromYear?: number; toYear?: number; vendor?: string }): Promise<EsgRatingRecord[]>;
  listPanelYearSummaries(options?: { fromYear?: number; toYear?: number }): Promise<PanelYearSummary[]>;
  getDashboardCommandCenter(scenario?: DemoScenario, query?: CompanyYearQuery): Promise<DashboardCommandCenterData>;
  getDashboardInsights(scenario?: DemoScenario): Promise<DashboardInsights>;
  getRiskInterpretation(companyId: string, reportYear: number, focus?: RiskInterpretationFocus): Promise<RiskInterpretation>;
  createAnalysisJob(input: { companyId: string; reportYear: number; fileName: string; fileSize: number }): Promise<AnalysisJob>;
  getAnalysisJob(jobId: string): Promise<AnalysisJob>;
  saveReview(review: ReviewRecord): Promise<ReviewRecord>;
  listReviewQueueActions(): Promise<ReviewQueueAction[]>;
  saveReviewQueueAction(action: ReviewQueueAction): Promise<ReviewQueueAction>;
  getBaiduNetdiskStatus(): Promise<DataSourceStatus>;
  listBaiduNetdiskFiles(options?: { path?: string; kind?: SourceFileRecord["kind"]; parseStatus?: SourceFileRecord["parseStatus"] }): Promise<SourceFileRecord[]>;
  getBaiduNetdiskFieldCatalog(sourceFileId: string): Promise<SourceFieldCatalog>;
  createBaiduNetdiskSync(input?: { path?: string; inspectSchemas?: boolean }): Promise<DataSourceSyncJob>;
  getBaiduNetdiskSyncJob(jobId: string): Promise<DataSourceSyncJob>;
}
