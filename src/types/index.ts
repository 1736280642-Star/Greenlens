export type RiskBand = "high" | "medium" | "low" | "unavailable";
export type ReviewStatus = "pending" | "partial" | "reviewed" | "disputed";
export type EvidenceStatus = "verified" | "pending" | "insufficient" | "disputed";
export type CalculationStatus = "calculated" | "mock" | "unavailable";
export type MetricCode = "EASS" | "IR" | "UPR" | "ESGSI" | "EAA_ESI" | "IMBALANCE";
export type RiskDirection = "higher_is_risk" | "lower_is_risk" | "contextual";
export type EnvironmentalActionClass = "implemented" | "planning" | "indeterminate";
export type EnvironmentalAspectCategory =
  | "emissions_climate"
  | "energy_resources"
  | "waste_circularity"
  | "pollution_control"
  | "biodiversity_ecology";
export type NormalizationScope = "none" | "year" | "industry_year" | "global" | "synthetic_demo";
export type SampleGroup = "main_n_ge_20" | "robustness_n_10_19" | "low_n_lt_10";
export type BaseRisk = "relatively_high" | "relatively_medium" | "relatively_low" | "unavailable";
export type RedFlagCode = "HIGH_ESGSI" | "LOW_EASS" | "HIGH_IR" | "HIGH_UPR";

export interface AnalysisMetric {
  code: MetricCode;
  label: string;
  /** Formula output before normalization. ESGSI may be negative and EAA-ESI may exceed 1. */
  rawValue: number | null;
  /** Comparable value after the declared normalization rule. */
  normalizedValue: number | null;
  /** Direction-aligned value used by risk-oriented charts. */
  riskValue: number | null;
  numerator?: number;
  denominator?: number;
  weight?: number;
  contribution?: number;
  threshold?: number;
  riskDirection: RiskDirection;
  formulaVersion: string;
  normalizationVersion: string;
  normalizationScope: NormalizationScope;
  calculationStatus: CalculationStatus;
  unavailableReason?: string;
  evidenceIds: string[];
}

export interface TextProcessingMetrics {
  textLength: number;
  totalWords: number;
  sentenceCount: number;
  environmentalSentenceCount: number;
  tokenCount: number;
}

export interface EsgTopicMetrics {
  eCount: number;
  sCount: number;
  gCount: number;
  eFocus: number;
  sFocus: number;
  gFocus: number;
  imbalanceScore: number;
}

export interface EnvironmentalActionSummary {
  totalStatements: number;
  implemented: number;
  planning: number;
  indeterminate: number;
  planningAlpha: number;
}

export interface PlanningVerificationSummary {
  totalPlanning: number;
  verifiedPlanning: number;
  unverifiedPlanning: number;
  requiredAttributes: Array<"deadline" | "quantified_target" | "implementation_path" | "responsible_entity">;
  ruleVersion: string;
}

export interface EnvironmentalAspectScore {
  id: string;
  documentId?: string;
  companyId: string;
  reportYear: number;
  aspectText: string;
  category: EnvironmentalAspectCategory;
  frequency: number;
  salience: number;
  implemented: number;
  planning: number;
  indeterminate: number;
  planningAlpha: number;
  actionScore: number | null;
  evidenceIds: string[];
  calculationStatus: CalculationStatus;
  formulaVersion: string;
  extractorVersion?: string;
}

export interface ScoreInputValue {
  rawValue: number | null;
  normalizedValue: number | null;
  normalizationVersion: string;
  normalizationScope: NormalizationScope;
}

export interface ScoreInputs {
  sentiment: ScoreInputValue;
  sustainability: ScoreInputValue;
}

export interface ScoringParameters {
  planningAlpha: number;
  lambdaAction: number;
  lambdaIndeterminate: number;
  lambdaPlanning: number;
  parameterVersion: string;
}

export interface PenaltyTerm {
  inputValue: number | null;
  weight: number;
  contribution: number | null;
}

export interface IndexBreakdown {
  baseEsgsiNormalized: number | null;
  actionPenalty: PenaltyTerm;
  indeterminatePenalty: PenaltyTerm;
  planningPenalty: PenaltyTerm;
  /** Evidence-coverage based positive adjustment (waterfall "+Evidence Adjustment" step). */
  evidenceAdjustment: PenaltyTerm;
  finalRaw: number | null;
  finalNormalized: number | null;
  normalizationVersion: string;
  normalizationScope: NormalizationScope;
}

export interface RiskClassification {
  baseRisk: BaseRisk;
  redFlags: RedFlagCode[];
  redFlagCount: number;
  assignedBand: RiskBand;
  classificationVersion: string;
  reason: string;
}

export interface PanelMetadata {
  sampleGroup: SampleGroup;
  includeNGe10: boolean;
  includeNGe20: boolean;
  analysisScope: string;
  lowSentenceCountFlag: boolean;
  recommendedUse: string;
  yearsAvailable: number;
  firstYear: number;
  lastYear: number;
  duplicateCount: number;
  selectedForPanel: boolean;
  selectionNote?: string;
  qualityFlags: string[];
  reportYearTextCheck: string;
  codeSource: string;
  sourceFile: string;
  sourceSheet: string;
  sourceRow: number;
}

export interface PanelYearSummary {
  year: number;
  sourceFile: string;
  sourceRows: number;
  uniqueCompanyYears: number;
  duplicateGroups: number;
  extraDuplicateRows: number;
  selectedNLt10: number;
  selectedN10To19: number;
  selectedNGe20: number;
  titleTargetYearNotFound: number;
  qualityFlaggedRows: number;
  codeRecoveredFromCompany: number;
}

export interface EvidenceItem {
  id: string;
  documentId?: string;
  companyId: string;
  stockCode?: string;
  reportYear: number;
  type: "claim" | "action" | "metric" | "verification" | "external";
  actionClass?: EnvironmentalActionClass;
  metricCode?: MetricCode;
  aspectId?: string;
  title: string;
  excerpt: string;
  page?: number;
  textHash?: string;
  environmentalCategory?: EnvironmentalAspectCategory;
  extractorVersion?: string;
  eventDate?: string;
  sourceLabel: string;
  sourceUrl?: string;
  status: EvidenceStatus;
}

/** Read-only PDF page reference produced from the server-side document store. */
export interface EvidencePageReference {
  evidenceId: string;
  companyId: string;
  reportYear: number;
  documentId: string;
  sourceLabel: string;
  page: number;
  pageCount: number;
  text: string;
}

export interface CompanyYearRecord {
  id: string;
  reportId: string;
  companyId: string;
  companyName: string;
  stockCode: string;
  industry: string;
  reportYear: number;
  publishDate: string;
  finalIndexRaw: number | null;
  finalIndex: number | null;
  riskBand: RiskBand;
  evidenceCoverage: number;
  evidenceStatus: EvidenceStatus;
  evidenceLinkageStatus?: "linked" | "unlinked" | "parse_failed" | "low_coverage";
  reviewStatus: ReviewStatus;
  eventCount: number;
  textProcessing: TextProcessingMetrics;
  esgTopics: EsgTopicMetrics;
  environmentalActions: EnvironmentalActionSummary;
  planningVerification: PlanningVerificationSummary;
  scoreInputs: ScoreInputs;
  scoringParameters: ScoringParameters;
  metrics: AnalysisMetric[];
  indexBreakdown: IndexBreakdown;
  riskClassification: RiskClassification;
  panelMetadata: PanelMetadata;
  versions: {
    schema: string;
    data: string;
    feature: string;
    model: string;
    score: string;
    threshold: string;
  };
  computedAt: string;
}

export interface MetricHistoryValue {
  rawValue: number | null;
  normalizedValue: number | null;
  riskValue: number | null;
  calculationStatus: CalculationStatus;
}

export interface CompanyMetricHistoryPoint {
  companyId: string;
  reportYear: number;
  finalIndexRaw: number | null;
  finalIndex: number | null;
  riskBand: RiskBand;
  metrics: Partial<Record<MetricCode, MetricHistoryValue>>;
  dataVersion: string;
}

export type RiskInterpretationFocus = "overview" | "drivers" | "evidence" | "history" | "industry";
export type RiskInterpretationStatementKind = "fact" | "inference" | "unknown";

export interface RiskInterpretationCitation {
  id: string;
  evidenceId: string;
  kind: RiskInterpretationStatementKind;
  label: string;
  excerpt: string;
  sourceLabel: string;
  page?: number;
  eventDate?: string;
}

export type RiskInterpretationEvidenceRelationKind = "supporting" | "counter" | "context";
export type RiskInterpretationEvidenceStrength = "strong" | "moderate" | "weak";

export interface RiskInterpretationEvidenceRelation {
  citationId: string;
  relation: RiskInterpretationEvidenceRelationKind;
  strength: RiskInterpretationEvidenceStrength;
  relevance: string;
}

export interface RiskInterpretationMetricComponent {
  label: string;
  value: number | null;
  unit: "count" | "ratio";
}

export interface RiskInterpretationMetricCalculation {
  rawValue: number | null;
  normalizedValue: number | null;
  riskValue: number | null;
  numerator?: number;
  denominator?: number;
  formulaVersion: string;
  normalizationVersion: string;
  components: RiskInterpretationMetricComponent[];
}

export interface RiskInterpretationDriver {
  metricCode: MetricCode;
  label: string;
  riskValue: number | null;
  threshold?: number;
  contribution?: number;
  status: "attention" | "watch" | "unavailable";
  explanation: string;
  finding: string;
  whyItMatters: string;
  evidenceAssessment: string;
  evidenceGap: string;
  nextAction: string;
  citationIds: string[];
  supportingCitationIds: string[];
  counterCitationIds: string[];
  evidenceRelations: RiskInterpretationEvidenceRelation[];
  calculation: RiskInterpretationMetricCalculation;
}

export interface RiskInterpretationComparison {
  available: boolean;
  text: string;
  sampleSize?: number;
  comparisonYear?: number;
  currentValue?: number;
  referenceValue?: number;
  delta?: number;
}

export interface RiskInterpretation {
  id: string;
  companyId: string;
  companyName: string;
  reportYear: number;
  generatedAt: string;
  focus: RiskInterpretationFocus;
  headline: string;
  summary: string;
  researchBrief: {
    finding: string;
    evidenceAssessment: string;
    modelAgreement: string;
    priorityAction: string;
  };
  riskBand: RiskBand;
  finalIndex: number | null;
  evidenceCoverage: number;
  robustness: {
    coverage: "three_views" | "two_views" | "primary_only";
    gsi: {
      gsiFinal: number;
      gwScore: number;
      coveragePenalty: number;
      imbalance: number;
      eFocus: number;
      sFocus: number;
      gFocus: number;
      modelVersion: string;
      dataVersion: string;
      qualityFlags: string[];
    } | null;
    redFlags: {
      triggered: RedFlagCode[];
      count: number;
      classificationVersion: string;
      reason: string;
    };
  };
  drivers: RiskInterpretationDriver[];
  citations: RiskInterpretationCitation[];
  evidenceGaps: string[];
  uncertainty: {
    level: "low" | "medium" | "high" | "unavailable";
    reasons: string[];
  };
  history: RiskInterpretationComparison;
  industry: RiskInterpretationComparison;
  recommendedActions: string[];
  versions: {
    data: string;
    model: string;
    score: string;
    threshold: string;
  };
}

export interface FinancialYearRecord {
  id: string;
  companyId: string;
  stockCode: string;
  companyName: string;
  fiscalPeriodEnd: string;
  reportYear: number;
  reportType: string;
  sourceType: string;
  assetLiabilityRatio: number | null;
  roaA: number | null;
  totalAssets: number | null;
  currency: string;
  sourceFields: {
    assetLiabilityRatio: "F011201A";
    roaA: "F050201B";
    totalAssets: "A001000000";
  };
  qualityFlags: string[];
}

export interface CompanyScoreRecord {
  id: string;
  companyId: string;
  stockCode: string;
  companyName: string;
  reportYear: number;
  sourceLabel: string;
  sourceFile: string;
  sourceSheet: string;
  sourceRow: number;
  analysisScope: string;
  sampleGroup: SampleGroup;
  includeNGe10: boolean;
  includeNGe20: boolean;
  textLength: number;
  nAllSentences: number;
  nEnvironmentalSentences: number;
  EASS: number | null;
  IR: number | null;
  UPR: number | null;
  sentimentRaw: number | null;
  sentimentNorm: number | null;
  sustainabilityRaw: number | null;
  sustainabilityNorm: number | null;
  esgsiRaw: number | null;
  esgsiNorm: number | null;
  eaaEsiRaw: number | null;
  eaaEsiNorm: number | null;
  baseRisk: string;
  flagHighEsgsi: boolean;
  flagLowEass: boolean;
  flagHighIr: boolean;
  flagHighUpr: boolean;
  redFlags: number;
  riskLevel: string;
  lowSentenceCountFlag: boolean;
  recommendedUse: string;
  yearsAvailable?: number;
  firstYear?: number;
  lastYear?: number;
  duplicateCount: number;
  selectedForPanel?: boolean;
  selectionNote?: string;
  qualityFlags: string[];
  reportYearTextCheck?: string;
  codeSource?: string;
  ingestedAt: string;
}

export interface CompanyIndustryRecord {
  id: string;
  companyId: string;
  stockCode: string;
  reportYear: number;
  industryCode: string;
  industryName: string;
  industryGroup: string;
  source: string;
  qualityFlag: "exact" | "backfilled" | "unclassified";
}

export interface EsgRatingRecord {
  id: string;
  companyId: string;
  vendor: string;
  stockCode: string;
  companyName: string;
  reportYear: number;
  rating: string;
  score: number | null;
  eScore: number | null;
  sScore: number | null;
  gScore: number | null;
  scoreScale: string;
  sourceFile: string;
  ingestedAt: string;
}

export interface ViolationEvent {
  id: string;
  companyId: string;
  stockCode: string;
  companyName: string;
  violationYears: number[];
  announcementDate: string;
  occurrenceDate?: string;
  violationTypes: string[];
  title?: string;
  reason?: string;
  behavior: string;
  action: string;
  authority?: string;
  totalPenalty: number | null;
  companyPenalty: number | null;
  relation?: string;
  subjectName?: string;
  sourceLabel: string;
  sourceUrl?: string;
  reviewStatus: EvidenceStatus;
  qualityFlags: string[];
}

export interface ReviewRecord {
  id: string;
  targetId: string;
  companyId: string;
  targetType: "evidence" | "event" | "entity_match" | "risk_label" | "action_classification" | "metric" | "interpretation";
  originalDecision: string;
  humanDecision?: "confirm" | "reject" | "partial" | "insufficient";
  reasonCode?: string;
  note?: string;
  reviewedAt?: string;
}

export interface ReviewQueueAction {
  id: string;
  taskId: string;
  companyId: string;
  action: "skip";
  reason?: string;
  actedAt: string;
}

export interface DashboardReviewTask {
  id: string;
  companyId: string;
  reviewType: "action_classification" | "EASS" | "IR" | "UPR" | "risk_band";
  metricCode: MetricCode;
  reason: string;
  impact: number;
  ageHours: number;
  uncertainty: number;
  evidenceStatus: EvidenceStatus;
  metricValue: number;
  threshold: number;
  evidenceId: string;
}

export interface ReviewTrendPoint {
  date: string;
  created: number;
  completed: number;
  pending: number;
}

export interface ModelAgreementRecord {
  type: string;
  confirm: number;
  partial: number;
  reject: number;
  insufficient: number;
}

export interface SourceFreshnessRecord {
  source: string;
  coverage: number;
  daysOld: number;
  status: "fresh" | "watch" | "stale";
}

export interface EvidenceCoverageDimension {
  label: string;
  coverage: number;
}

export interface DashboardInsights {
  reviewTasks: DashboardReviewTask[];
  reviewTrend: ReviewTrendPoint[];
  modelAgreement: ModelAgreementRecord[];
  sourceFreshness: SourceFreshnessRecord[];
  evidenceCoverage: EvidenceCoverageDimension[];
}

export type DashboardTriadCode = "RHETORIC_CONTENT" | "ACTION_SUBSTANCE" | "AMBIGUITY_VERIFICATION";
export type DashboardResearchView = "primary" | "gsi" | "red_flags";
export type DashboardGsiMetricCode = "GSI" | "COVERAGE_PENALTY" | "IMBALANCE";

export interface GsiScoreRecord {
  id: string;
  companyId: string;
  stockCode: string;
  companyName: string;
  reportYear: number;
  totalWords: number;
  eCount: number;
  sCount: number;
  gCount: number;
  eFocus: number;
  sFocus: number;
  gFocus: number;
  imbalance: number;
  gwScore: number;
  coveragePenalty: number;
  gsiFinal: number;
  duplicateCount: number;
  qualityFlags: string[];
  calculationStatus: "calculated";
  modelVersion: string;
  dataVersion: string;
  sourceFile: string;
  sourceRow: number;
  importedAt: string;
}

export interface DashboardGsiNode {
  gsiFinal: number;
  gwScore: number;
  coveragePenalty: number;
  imbalance: number;
  eFocus: number;
  sFocus: number;
  gFocus: number;
  duplicateCount: number;
  qualityFlags: string[];
}

export interface DashboardGsiMetricSummary {
  code: DashboardGsiMetricCode;
  label: string;
  description: string;
  medianValue: number | null;
  meanValue: number | null;
  sampleCount: number;
  q1: number | null;
  q3: number | null;
  history: Array<{
    year: number;
    medianValue: number | null;
    meanValue: number | null;
    q1: number | null;
    q3: number | null;
    sampleCount: number;
  }>;
}

export interface DashboardRedFlagTrendPoint {
  year: number;
  highEsgsiRate: number | null;
  lowEassRate: number | null;
  ambiguityVerificationRate: number | null;
  sampleCount: number;
}

export interface DashboardMetricTriad {
  code: DashboardTriadCode;
  label: string;
  description: string;
  medianValue: number | null;
  attentionRate: number | null;
  sampleCount: number;
  q1: number | null;
  q3: number | null;
  history: Array<{ year: number; value: number | null }>;
}

export interface DashboardRiskHistoryPoint {
  year: number;
  finalIndex: number | null;
  riskBand: RiskBand;
}

export interface DashboardRiskNode {
  companyId: string;
  companyName: string;
  stockCode: string;
  industry: string;
  reportYear: number;
  eass: number | null;
  finalIndex: number | null;
  riskBand: RiskBand;
  environmentalSentenceCount: number;
  evidenceCoverage: number;
  redFlags: RedFlagCode[];
  metricRiskValues: Record<"ESGSI" | "EASS" | "IR" | "UPR" | "EAA_ESI", number | null>;
  gsi: DashboardGsiNode | null;
  persistentHighRiskYears: number;
  /** Per-company EAA-ESI waterfall breakdown; preserved in light responses. */
  indexBreakdown: IndexBreakdown;
  /** Absent in light dashboard responses; persistent risk uses persistentHighRiskYears. */
  history?: DashboardRiskHistoryPoint[];
}

/** Minimal SQLite projection used only to render the full risk constellation. */
export interface DashboardConstellationNode {
  companyId: string;
  companyName: string;
  stockCode: string;
  industry: string;
  reportYear: number;
  esgsi: number | null;
  eass: number | null;
  finalIndex: number | null;
  riskBand: RiskBand;
}

export interface DashboardWatchItem extends DashboardRiskNode {
  evidenceStatus: EvidenceStatus;
  reviewStatus: ReviewStatus;
}

export interface DashboardAnnualTrendPoint {
  year: number;
  medianFinalIndex: number | null;
  meanFinalIndex: number | null;
  q1FinalIndex: number | null;
  q3FinalIndex: number | null;
  highRiskRate: number | null;
  medianEass: number | null;
  sampleCount: number;
}

export interface DashboardIndustryRiskCell {
  industry: string;
  metricCode: "ESGSI" | "EASS" | "IR" | "UPR" | "EAA_ESI";
  sampleCount: number;
  medianRiskValue: number | null;
  q1: number | null;
  q3: number | null;
}

/** Cohort median EAA-ESI waterfall breakdown, used by the dashboard's
 * "全部样本中位数" waterfall mode. Every step is null when the cohort
 * has no usable ESGSI / penalty inputs. */
export interface DashboardCohortBreakdown {
  baseEsgsi: number | null;
  actionPenalty: number | null;
  indeterminatePenalty: number | null;
  planningPenalty: number | null;
  evidenceAdjustment: number | null;
  final: number | null;
}

export interface DashboardCommandCenterData {
  scope: {
    reportYear: number;
    availableReportYears: number[];
    industry?: string;
    sampleGroup?: SampleGroup;
    dataVersion: string;
    computedAt: string;
  };
  kpis: {
    sampleCount: number;
    highRiskCount: number;
    persistentHighRiskCount: number;
    medianFinalIndex: number | null;
    insufficientEvidenceCount: number;
    unlinkedEvidenceCount: number;
    evidenceParseFailedCount: number;
    lowEvidenceCoverageCount: number;
    qualityAlertCount: number;
  };
  metricTriad: DashboardMetricTriad[];
  gsiRobustness: {
    available: boolean;
    matchedCompanyCount: number;
    duplicateGroupCount: number;
    dataVersion: string | null;
    metrics: DashboardGsiMetricSummary[];
  };
  redFlagTrend: DashboardRedFlagTrendPoint[];
  riskNodes: DashboardRiskNode[];
  persistentRisks: DashboardWatchItem[];
  annualTrend: DashboardAnnualTrendPoint[];
  industryRisk: DashboardIndustryRiskCell[];
  redFlagDistribution: Array<{ code: RedFlagCode; count: number }>;
  quality: PanelYearSummary[];
  /** Cohort-median waterfall steps for "全部样本中位数" mode. */
  medianBreakdown: DashboardCohortBreakdown;
}

export interface AnalysisJob {
  jobId: string;
  reportId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  phase: "collect" | "preprocess" | "extract" | "classify" | "calculate" | "risk";
  stage?: "uploaded" | "validating" | "parsing" | "segmenting" | "extracting" | "classifying" | "calculating" | "linking" | "completed" | "failed" | "cancelled";
  progress: number;
  resultCompanyId?: string;
  document?: {
    documentId: string;
    fileName: string;
    fileSize: number;
    fileHash: string;
    pageCount?: number;
    textPageCount?: number;
    textCoverage?: number;
    deduplicated?: boolean;
  };
  result?: {
    eass: number | null;
    ir: number | null;
    upr: number | null;
    evidenceCount: number;
    environmentalAspectCount: number;
    calculationStatus: "calculated" | "unavailable";
    unavailableReason?: string;
    parserVersion: string;
    extractorVersion: string;
    formulaVersion: string;
    calculatedAt: string;
  };
  attempts?: number;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  error?: { cause: string; impact: string; nextAction: string };
}

export type SourceFileKind = "esg_report" | "financial_workbook" | "violation_workbook" | "company_score_workbook" | "company_industry_workbook" | "esg_rating_workbook" | "negative_news" | "archive" | "unknown";
export type SourceFileParseStatus = "discovered" | "schema_pending" | "ready" | "unsupported" | "failed";

/** Server-side file metadata only. Raw netdisk content must not be returned to the browser. */
export interface SourceFileRecord {
  id: string;
  provider: "baidu_netdisk";
  path: string;
  filename: string;
  fsid: string;
  md5?: string;
  size: number;
  kind: SourceFileKind;
  parseStatus: SourceFileParseStatus;
  discoveredAt: string;
  modifiedAt?: string;
  detectedFields: string[];
  qualityFlags: string[];
}

export type PdfDocumentKind = "esg_report" | "negative_news";
export type PdfTextMode = "text" | "mixed" | "ocr_required";

export interface PdfPageBlock {
  page: number;
  text: string;
  textHash: string;
}

/** Server-side document payload produced from a read-only Netdisk byte stream. */
export interface NetdiskPdfDocumentInput {
  documentId?: string;
  fsid: string;
  filename: string;
  size: number;
  md5?: string;
  stockCode?: string;
  companyName?: string;
  reportYear?: number;
  kind: PdfDocumentKind;
  pageCount: number;
  textPageCount: number;
  textCoverage: number;
  textMode: PdfTextMode;
  pages: PdfPageBlock[];
}

/** Operational metadata only. Page text remains in the server-side runtime snapshot. */
export interface PdfDocumentRecord {
  id: string;
  provider: "baidu_netdisk";
  fsid: string;
  filename: string;
  size: number;
  md5?: string;
  kind: PdfDocumentKind;
  pageCount: number;
  textPageCount: number;
  textCoverage: number;
  textMode: PdfTextMode;
  stockCode?: string;
  companyName?: string;
  reportYear?: number;
  publicationDate?: string;
  parseStatus: "ready" | "schema_pending" | "failed";
  qualityFlags: string[];
  ingestedAt: string;
}

export type EvidenceReindexScope = "missing_only" | "failed_only" | "version_outdated";
export type PdfEvidenceJobStatus =
  | "queued"
  | "resolving_identity"
  | "extracting"
  | "aggregating"
  | "linking"
  | "completed"
  | "identity_unresolved"
  | "text_unavailable"
  | "extraction_failed"
  | "score_unmatched";

export interface EvidenceIdentityResolution {
  resolvedCompanyId: string | null;
  resolvedStockCode: string | null;
  reportYear: number | null;
  publicationDate: string | null;
  identityConfidence: number;
  yearConfidence: number;
  identitySources: string[];
  yearSource: string | null;
  alternativeCandidates: Array<{ companyId: string; stockCode: string; companyName: string }>;
  status: "resolved" | "unresolved" | "ambiguous";
}

export interface EvidenceRebuildDocument {
  documentId: string;
  fsid: string;
  filename: string;
  kind: PdfDocumentKind;
  textMode: PdfTextMode;
  metadata: PdfDocumentRecord;
  pages: PdfPageBlock[];
}

export interface EvidenceReindexFunnel {
  completedDocuments: number;
  documentsWithTextPages: number;
  identityResolvedDocuments: number;
  evidenceExtractedDocuments: number;
  linkedCompanyYearDocuments: number;
  identityUnresolvedDocuments: number;
  extractionFailedDocuments: number;
  scoreUnmatchedDocuments: number;
}

export interface EvidenceReindexPreview extends EvidenceReindexFunnel {
  scope: EvidenceReindexScope;
  kind: PdfDocumentKind;
  extractorVersion: string;
  candidateDocuments: number;
  sampledDocuments: number;
  sampledWithText: number;
  sampledCompanyResolved: number;
  sampledYearResolved: number;
  sampledEvidenceExtractable: number;
  estimatedAutoLinked: number;
  estimatedManualReview: number;
  sampleCandidates: Array<{
    documentId: string;
    companyId?: string;
    reportYear?: number;
    identityStatus: EvidenceIdentityResolution["status"];
    scoreMatched: boolean;
    evidenceCount: number;
  }>;
}

export interface EvidenceReindexRun {
  jobId: string;
  status: "queued" | "running" | "completed" | "completed_with_warnings" | "failed";
  scope: EvidenceReindexScope;
  kind: PdfDocumentKind;
  extractorVersion: string;
  totalCandidates: number;
  processed: number;
  succeeded: number;
  failed: number;
  cursor?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  error?: { cause: string; impact: string; nextAction: string };
}

export interface SourceFieldCatalog {
  sourceFileId: string;
  sheetName?: string;
  fields: Array<{
    sourceField: string;
    targetField?: string;
    dataType: "string" | "number" | "date" | "boolean" | "unknown";
    required: boolean;
    status: "mapped" | "unmapped" | "invalid";
  }>;
}

export interface DataSourceStatus {
  provider: "baidu_netdisk";
  rootPath: string;
  connectionStatus: "connected" | "degraded" | "unavailable";
  lastSyncedAt?: string;
  fileCount: number;
  readyFileCount: number;
  schemaPendingFileCount: number;
  message?: string;
}

export interface DataSourceSyncJob {
  jobId: string;
  provider: "baidu_netdisk";
  status: "queued" | "running" | "completed" | "failed";
  phase: "discover" | "inspect_schema" | "extract" | "normalize" | "index";
  progress: number;
  discoveredFileCount: number;
  readyFileCount: number;
  error?: { cause: string; impact: string; nextAction: string };
}

export const metricCodes: MetricCode[] = ["EASS", "IR", "UPR", "ESGSI", "EAA_ESI", "IMBALANCE"];

export function getMetric(record: CompanyYearRecord, code: MetricCode) {
  return record.metrics.find((metric) => metric.code === code);
}

export function metricPercent(
  record: CompanyYearRecord,
  code: MetricCode,
  field: "rawValue" | "normalizedValue" | "riskValue" = "normalizedValue",
) {
  const value = getMetric(record, code)?.[field];
  return value == null ? null : Math.round(value * 100);
}

export function formatPercent(value: number | null | undefined) {
  return value == null ? "--" : `${Math.round(value * 100)}%`;
}

export function formatMetricPercent(
  record: CompanyYearRecord,
  code: MetricCode,
  field: "normalizedValue" | "riskValue" = "normalizedValue",
) {
  const value = getMetric(record, code)?.[field];
  return formatPercent(value);
}

export function formatDecimal(value: number | null | undefined) {
  return value == null ? "--" : value.toFixed(2);
}
