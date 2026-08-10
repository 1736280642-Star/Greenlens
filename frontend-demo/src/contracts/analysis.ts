import { z } from "zod";

const metricCodeSchema = z.enum(["EASS", "IR", "UPR", "ESGSI", "EAA_ESGSI", "IMBALANCE"]);
const riskBandSchema = z.enum(["high", "medium", "low", "unavailable"]);
const evidenceStatusSchema = z.enum(["verified", "pending", "insufficient", "disputed"]);
const reviewStatusSchema = z.enum(["pending", "partial", "reviewed", "disputed"]);
const calculationStatusSchema = z.enum(["calculated", "mock", "unavailable"]);
const normalizationScopeSchema = z.enum(["none", "year", "industry_year", "global", "synthetic_demo"]);

export const analysisMetricSchema = z.object({
  code: metricCodeSchema,
  label: z.string(),
  rawValue: z.number().nullable(),
  normalizedValue: z.number().min(0).max(1).nullable(),
  riskValue: z.number().min(0).max(1).nullable(),
  numerator: z.number().nonnegative().optional(),
  denominator: z.number().nonnegative().optional(),
  weight: z.number().nonnegative().optional(),
  contribution: z.number().nonnegative().optional(),
  threshold: z.number().min(0).max(1).optional(),
  riskDirection: z.enum(["higher_is_risk", "lower_is_risk", "contextual"]),
  formulaVersion: z.string().min(1),
  normalizationVersion: z.string().min(1),
  normalizationScope: normalizationScopeSchema,
  calculationStatus: calculationStatusSchema,
  unavailableReason: z.string().optional(),
  evidenceIds: z.array(z.string()),
}).superRefine((metric, context) => {
  const values = [metric.rawValue, metric.normalizedValue, metric.riskValue];
  if (metric.denominator === 0 && (values.some((value) => value !== null) || !metric.unavailableReason)) {
    context.addIssue({ code: "custom", message: "零分母指标必须返回 null 值和 unavailableReason" });
  }
  if (metric.calculationStatus === "unavailable" && (values.some((value) => value !== null) || !metric.unavailableReason)) {
    context.addIssue({ code: "custom", message: "不可计算指标必须返回 null 值和 unavailableReason" });
  }
  if (metric.calculationStatus !== "unavailable" && values.some((value) => value === null)) {
    context.addIssue({ code: "custom", message: "已计算指标必须同时返回 rawValue、normalizedValue 和 riskValue" });
  }
});

const scoreInputSchema = z.object({
  rawValue: z.number().nullable(),
  normalizedValue: z.number().min(0).max(1).nullable(),
  normalizationVersion: z.string().min(1),
  normalizationScope: normalizationScopeSchema,
});

const penaltyTermSchema = z.object({
  inputValue: z.number().min(0).max(1).nullable(),
  weight: z.number().nonnegative(),
  /** Risk contribution. Penalties are non-negative; positive adjustments (e.g. evidence) are negative. */
  contribution: z.number().nullable(),
});

const panelMetadataSchema = z.object({
  sampleGroup: z.enum(["main_n_ge_20", "robustness_n_10_19", "low_n_lt_10"]),
  includeNGe10: z.boolean(),
  includeNGe20: z.boolean(),
  analysisScope: z.string().min(1),
  lowSentenceCountFlag: z.boolean(),
  recommendedUse: z.string(),
  yearsAvailable: z.number().int().nonnegative(),
  firstYear: z.number().int(),
  lastYear: z.number().int(),
  duplicateCount: z.number().int().positive(),
  selectedForPanel: z.boolean(),
  selectionNote: z.string().optional(),
  qualityFlags: z.array(z.string()),
  reportYearTextCheck: z.string(),
  codeSource: z.string(),
  sourceFile: z.string(),
  sourceSheet: z.string(),
  sourceRow: z.number().int().positive(),
});

export const panelYearSummarySchema = z.object({
  year: z.number().int(),
  sourceFile: z.string().min(1),
  sourceRows: z.number().int().nonnegative(),
  uniqueCompanyYears: z.number().int().nonnegative(),
  duplicateGroups: z.number().int().nonnegative(),
  extraDuplicateRows: z.number().int().nonnegative(),
  selectedNLt10: z.number().int().nonnegative(),
  selectedN10To19: z.number().int().nonnegative(),
  selectedNGe20: z.number().int().nonnegative(),
  titleTargetYearNotFound: z.number().int().nonnegative(),
  qualityFlaggedRows: z.number().int().nonnegative(),
  codeRecoveredFromCompany: z.number().int().nonnegative(),
});

export const companyYearRecordSchema = z.object({
  id: z.string(),
  reportId: z.string(),
  companyId: z.string(),
  companyName: z.string(),
  stockCode: z.string(),
  industry: z.string(),
  reportYear: z.number().int(),
  publishDate: z.string(),
  finalIndexRaw: z.number().nullable(),
  finalIndex: z.number().min(0).max(1).nullable(),
  riskBand: riskBandSchema,
  evidenceCoverage: z.number().min(0).max(100),
  evidenceStatus: evidenceStatusSchema,
  evidenceLinkageStatus: z.enum(["linked", "unlinked", "parse_failed", "low_coverage"]).optional(),
  reviewStatus: reviewStatusSchema,
  eventCount: z.number().int().nonnegative(),
  textProcessing: z.object({
    textLength: z.number().int().nonnegative(),
    totalWords: z.number().int().nonnegative(),
    sentenceCount: z.number().int().nonnegative(),
    environmentalSentenceCount: z.number().int().nonnegative(),
    tokenCount: z.number().int().nonnegative(),
  }),
  esgTopics: z.object({
    eCount: z.number().int().nonnegative(),
    sCount: z.number().int().nonnegative(),
    gCount: z.number().int().nonnegative(),
    eFocus: z.number().min(0).max(1),
    sFocus: z.number().min(0).max(1),
    gFocus: z.number().min(0).max(1),
    imbalanceScore: z.number().min(0).max(1),
  }),
  environmentalActions: z.object({
    totalStatements: z.number().int().nonnegative(),
    implemented: z.number().int().nonnegative(),
    planning: z.number().int().nonnegative(),
    indeterminate: z.number().int().nonnegative(),
    planningAlpha: z.number().min(0).max(1),
  }),
  planningVerification: z.object({
    totalPlanning: z.number().int().nonnegative(),
    verifiedPlanning: z.number().int().nonnegative(),
    unverifiedPlanning: z.number().int().nonnegative(),
    requiredAttributes: z.array(z.enum(["deadline", "quantified_target", "implementation_path", "responsible_entity"])),
    ruleVersion: z.string().min(1),
  }),
  scoreInputs: z.object({ sentiment: scoreInputSchema, sustainability: scoreInputSchema }),
  scoringParameters: z.object({
    planningAlpha: z.number().min(0).max(1),
    lambdaAction: z.number().nonnegative(),
    lambdaIndeterminate: z.number().nonnegative(),
    lambdaPlanning: z.number().nonnegative(),
    parameterVersion: z.string().min(1),
  }),
  metrics: z.array(analysisMetricSchema),
  indexBreakdown: z.object({
    baseEsgsiNormalized: z.number().min(0).max(1).nullable(),
    actionPenalty: penaltyTermSchema,
    indeterminatePenalty: penaltyTermSchema,
    planningPenalty: penaltyTermSchema,
    evidenceAdjustment: penaltyTermSchema,
    finalRaw: z.number().nullable(),
    finalNormalized: z.number().min(0).max(1).nullable(),
    normalizationVersion: z.string().min(1),
    normalizationScope: normalizationScopeSchema,
  }),
  riskClassification: z.object({
    baseRisk: z.enum(["relatively_high", "relatively_medium", "relatively_low", "unavailable"]),
    redFlags: z.array(z.enum(["HIGH_ESGSI", "LOW_EASS", "HIGH_IR", "HIGH_UPR"])),
    redFlagCount: z.number().int().min(0).max(4),
    assignedBand: riskBandSchema,
    classificationVersion: z.string().min(1),
    reason: z.string().min(1),
  }),
  panelMetadata: panelMetadataSchema,
  versions: z.object({
    schema: z.string().min(1), data: z.string().min(1), feature: z.string().min(1),
    model: z.string().min(1), score: z.string().min(1), threshold: z.string().min(1),
  }),
  computedAt: z.string().datetime({ offset: true }),
}).superRefine((record, context) => {
  const actions = record.environmentalActions;
  if (actions.implemented + actions.planning + actions.indeterminate !== actions.totalStatements) {
    context.addIssue({ code: "custom", path: ["environmentalActions", "totalStatements"], message: "行动分类数量必须与总声明数一致" });
  }
  const planning = record.planningVerification;
  if (planning.totalPlanning !== actions.planning || planning.verifiedPlanning + planning.unverifiedPlanning !== planning.totalPlanning) {
    context.addIssue({ code: "custom", path: ["planningVerification"], message: "计划验证数量必须与 Planning 行动数量一致" });
  }
  const metricCodes = new Set(record.metrics.map((metric) => metric.code));
  if (record.metrics.length !== 6 || metricCodes.size !== 6 || !metricCodeSchema.options.every((code) => metricCodes.has(code))) {
    context.addIssue({ code: "custom", path: ["metrics"], message: "公司年度记录必须包含且仅包含六项核心指标" });
  }
  if (record.riskClassification.redFlagCount !== record.riskClassification.redFlags.length) {
    context.addIssue({ code: "custom", path: ["riskClassification", "redFlagCount"], message: "红旗数量必须与红旗列表一致" });
  }
  if (record.riskClassification.assignedBand !== record.riskBand) {
    context.addIssue({ code: "custom", path: ["riskBand"], message: "风险等级必须与已版本化的分类结果一致" });
  }
  const finalMetric = record.metrics.find((metric) => metric.code === "EAA_ESGSI");
  if (record.finalIndex != null) {
    const rawValues = [record.finalIndexRaw, finalMetric?.rawValue, record.indexBreakdown.finalRaw];
    const normalizedValues = [finalMetric?.normalizedValue, record.indexBreakdown.finalNormalized];
    if (rawValues.some((value) => value == null) || normalizedValues.some((value) => value == null)
      || Math.abs(finalMetric!.rawValue! - record.finalIndexRaw!) > 0.0001
      || Math.abs(record.indexBreakdown.finalRaw! - record.finalIndexRaw!) > 0.0001
      || Math.abs(finalMetric!.normalizedValue! - record.finalIndex) > 0.0001
      || Math.abs(record.indexBreakdown.finalNormalized! - record.finalIndex) > 0.0001) {
      context.addIssue({ code: "custom", path: ["finalIndex"], message: "最终原始值、归一化值、指标与公式拆解必须一致" });
    }
  } else if (record.finalIndexRaw !== null || finalMetric?.rawValue !== null || finalMetric?.normalizedValue !== null || record.indexBreakdown.finalRaw !== null || record.indexBreakdown.finalNormalized !== null) {
    context.addIssue({ code: "custom", path: ["finalIndex"], message: "暂不可评分时最终指标和公式拆解必须为 null" });
  }
});

export const companyYearListSchema = z.array(companyYearRecordSchema);

export const environmentalAspectScoreSchema = z.object({
  id: z.string(), companyId: z.string(), reportYear: z.number().int(), aspectText: z.string(),
  category: z.enum(["emissions_climate", "energy_resources", "waste_circularity", "pollution_control", "biodiversity_ecology"]),
  frequency: z.number().int().nonnegative(), salience: z.number().min(0).max(1),
  implemented: z.number().int().nonnegative(), planning: z.number().int().nonnegative(), indeterminate: z.number().int().nonnegative(),
  planningAlpha: z.number().min(0).max(1), actionScore: z.number().min(0).max(1).nullable(), evidenceIds: z.array(z.string()),
  calculationStatus: calculationStatusSchema, formulaVersion: z.string().min(1),
});

const metricHistoryValueSchema = z.object({
  rawValue: z.number().nullable(), normalizedValue: z.number().min(0).max(1).nullable(),
  riskValue: z.number().min(0).max(1).nullable(), calculationStatus: calculationStatusSchema,
});

export const companyMetricHistoryPointSchema = z.object({
  companyId: z.string(), reportYear: z.number().int(), finalIndexRaw: z.number().nullable(),
  finalIndex: z.number().min(0).max(1).nullable(), riskBand: riskBandSchema,
  metrics: z.partialRecord(metricCodeSchema, metricHistoryValueSchema), dataVersion: z.string().min(1),
});

export const financialYearRecordSchema = z.object({
  id: z.string(), companyId: z.string(), stockCode: z.string(), companyName: z.string(), fiscalPeriodEnd: z.string(),
  reportYear: z.number().int(), reportType: z.string(), sourceType: z.string(),
  assetLiabilityRatio: z.number().min(0).max(1).nullable(), roaA: z.number().nullable(), totalAssets: z.number().nonnegative().nullable(),
  currency: z.string(),
  sourceFields: z.object({ assetLiabilityRatio: z.literal("F011201A"), roaA: z.literal("F050201B"), totalAssets: z.literal("A001000000") }),
  qualityFlags: z.array(z.string()),
});

export const violationEventSchema = z.object({
  id: z.string(), companyId: z.string(), stockCode: z.string(), companyName: z.string(),
  violationYears: z.array(z.number().int()).min(1), announcementDate: z.string(), occurrenceDate: z.string().optional(),
  violationTypes: z.array(z.string()).min(1), title: z.string().optional(), reason: z.string().optional(), behavior: z.string(), action: z.string(),
  authority: z.string().optional(), totalPenalty: z.number().nonnegative().nullable(), companyPenalty: z.number().nonnegative().nullable(),
  relation: z.string().optional(), subjectName: z.string().optional(), sourceLabel: z.string(), sourceUrl: z.string().optional(),
  reviewStatus: evidenceStatusSchema, qualityFlags: z.array(z.string()),
});

export const evidenceItemSchema = z.object({
  id: z.string(), companyId: z.string(), reportYear: z.number().int(),
  type: z.enum(["claim", "action", "metric", "verification", "external"]),
  actionClass: z.enum(["implemented", "planning", "indeterminate"]).optional(), metricCode: metricCodeSchema.optional(),
  aspectId: z.string().optional(), title: z.string(), excerpt: z.string(), page: z.number().int().positive().optional(), eventDate: z.string().optional(),
  sourceLabel: z.string(), sourceUrl: z.string().optional(), status: evidenceStatusSchema,
});

export const esgRatingRecordSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  vendor: z.string(),
  stockCode: z.string(),
  companyName: z.string(),
  reportYear: z.number().int(),
  rating: z.string(),
  score: z.number().nullable(),
  eScore: z.number().nullable(),
  sScore: z.number().nullable(),
  gScore: z.number().nullable(),
  scoreScale: z.string(),
  sourceFile: z.string(),
  ingestedAt: z.string().datetime({ offset: true }),
});

const dashboardRiskHistoryPointSchema = z.object({
  year: z.number().int(), finalIndex: z.number().min(0).max(1).nullable(), riskBand: riskBandSchema,
});

const indexBreakdownSchema = z.object({
  baseEsgsiNormalized: z.number().min(0).max(1).nullable(),
  actionPenalty: penaltyTermSchema,
  indeterminatePenalty: penaltyTermSchema,
  planningPenalty: penaltyTermSchema,
  evidenceAdjustment: penaltyTermSchema,
  finalRaw: z.number().nullable(),
  finalNormalized: z.number().min(0).max(1).nullable(),
  normalizationVersion: z.string().min(1),
  normalizationScope: normalizationScopeSchema,
});

const dashboardCohortBreakdownSchema = z.object({
  baseEsgsi: z.number().min(0).max(1).nullable(),
  actionPenalty: z.number().nullable(),
  indeterminatePenalty: z.number().nullable(),
  planningPenalty: z.number().nullable(),
  evidenceAdjustment: z.number().nullable(),
  final: z.number().min(0).max(1).nullable(),
});

const dashboardRiskNodeSchema = z.object({
  companyId: z.string(), companyName: z.string(), stockCode: z.string(), industry: z.string(), reportYear: z.number().int(),
  eass: z.number().min(0).max(1).nullable(), finalIndex: z.number().min(0).max(1).nullable(), riskBand: riskBandSchema,
  environmentalSentenceCount: z.number().int().nonnegative(), evidenceCoverage: z.number().min(0).max(100),
  redFlags: z.array(z.enum(["HIGH_ESGSI", "LOW_EASS", "HIGH_IR", "HIGH_UPR"])),
  metricRiskValues: z.object({
    ESGSI: z.number().min(0).max(1).nullable(), EASS: z.number().min(0).max(1).nullable(),
    IR: z.number().min(0).max(1).nullable(), UPR: z.number().min(0).max(1).nullable(),
    EAA_ESGSI: z.number().min(0).max(1).nullable(),
  }),
  persistentHighRiskYears: z.number().int().nonnegative(),
  indexBreakdown: indexBreakdownSchema,
  history: z.array(dashboardRiskHistoryPointSchema).optional(),
});

export const dashboardCommandCenterSchema = z.object({
  scope: z.object({
    reportYear: z.number().int(), availableReportYears: z.array(z.number().int()), industry: z.string().optional(),
    sampleGroup: z.enum(["main_n_ge_20", "robustness_n_10_19", "low_n_lt_10"]).optional(),
    dataVersion: z.string().min(1), computedAt: z.string().datetime({ offset: true }),
  }),
  kpis: z.object({
    sampleCount: z.number().int().nonnegative(), highRiskCount: z.number().int().nonnegative(),
    persistentHighRiskCount: z.number().int().nonnegative(), medianFinalIndex: z.number().min(0).max(1).nullable(),
    insufficientEvidenceCount: z.number().int().nonnegative(),
    unlinkedEvidenceCount: z.number().int().nonnegative(), evidenceParseFailedCount: z.number().int().nonnegative(),
    lowEvidenceCoverageCount: z.number().int().nonnegative(), qualityAlertCount: z.number().int().nonnegative(),
  }),
  metricTriad: z.array(z.object({
    code: z.enum(["RHETORIC_CONTENT", "ACTION_SUBSTANCE", "AMBIGUITY_VERIFICATION"]),
    label: z.string(), description: z.string(), medianValue: z.number().min(0).max(1).nullable(),
    attentionRate: z.number().min(0).max(1).nullable(),
    sampleCount: z.number().int().nonnegative(), q1: z.number().min(0).max(1).nullable(),
    q3: z.number().min(0).max(1).nullable(),
    history: z.array(z.object({ year: z.number().int(), value: z.number().min(0).max(1).nullable() })),
  })),
  riskNodes: z.array(dashboardRiskNodeSchema),
  persistentRisks: z.array(dashboardRiskNodeSchema.extend({ evidenceStatus: evidenceStatusSchema, reviewStatus: reviewStatusSchema })),
  annualTrend: z.array(z.object({
    year: z.number().int(), medianFinalIndex: z.number().min(0).max(1).nullable(),
    highRiskRate: z.number().min(0).max(1).nullable(), medianEass: z.number().min(0).max(1).nullable(),
  })),
  industryRisk: z.array(z.object({
    industry: z.string(), metricCode: z.enum(["ESGSI", "EASS", "IR", "UPR", "EAA_ESGSI"]),
    sampleCount: z.number().int().nonnegative(), medianRiskValue: z.number().min(0).max(1).nullable(),
    q1: z.number().min(0).max(1).nullable(), q3: z.number().min(0).max(1).nullable(),
  })),
  redFlagDistribution: z.array(z.object({
    code: z.enum(["HIGH_ESGSI", "LOW_EASS", "HIGH_IR", "HIGH_UPR"]), count: z.number().int().nonnegative(),
  })),
  quality: z.array(panelYearSummarySchema),
  medianBreakdown: dashboardCohortBreakdownSchema,
});

export const dashboardInsightsSchema = z.object({
  reviewTasks: z.array(z.object({
    id: z.string(), companyId: z.string(), reviewType: z.enum(["action_classification", "EASS", "IR", "UPR", "risk_band"]),
    metricCode: metricCodeSchema, reason: z.string(), impact: z.number(), ageHours: z.number().nonnegative(), uncertainty: z.number(),
    evidenceStatus: evidenceStatusSchema, metricValue: z.number().min(0).max(1), threshold: z.number().min(0).max(1), evidenceId: z.string(),
  })),
  reviewTrend: z.array(z.object({ date: z.string(), created: z.number(), completed: z.number(), pending: z.number() })),
  modelAgreement: z.array(z.object({ type: z.string(), confirm: z.number(), partial: z.number(), reject: z.number(), insufficient: z.number() })),
  sourceFreshness: z.array(z.object({ source: z.string(), coverage: z.number(), daysOld: z.number(), status: z.enum(["fresh", "watch", "stale"]) })),
  evidenceCoverage: z.array(z.object({ label: z.string(), coverage: z.number() })),
});

export const reviewRecordSchema = z.object({
  id: z.string(), targetId: z.string(), companyId: z.string(),
  targetType: z.enum(["evidence", "event", "entity_match", "risk_label", "action_classification", "metric"]),
  originalDecision: z.string(), humanDecision: z.enum(["confirm", "reject", "partial", "insufficient"]).optional(),
  reasonCode: z.string().optional(), note: z.string().optional(), reviewedAt: z.string().datetime({ offset: true }).optional(),
});

export const evidencePageReferenceSchema = z.object({
  evidenceId: z.string(),
  companyId: z.string(),
  reportYear: z.number().int(),
  documentId: z.string(),
  sourceLabel: z.string(),
  page: z.number().int().positive(),
  pageCount: z.number().int().positive(),
  text: z.string(),
});

export const analysisJobSchema = z.object({
  jobId: z.string(), reportId: z.string(), status: z.enum(["queued", "running", "completed", "failed"]),
  phase: z.enum(["collect", "preprocess", "extract", "classify", "calculate", "risk"]), progress: z.number().min(0).max(100),
  resultCompanyId: z.string().optional(), error: z.object({ cause: z.string(), impact: z.string(), nextAction: z.string() }).optional(),
});

const sourceFileKindSchema = z.enum(["esg_report", "financial_workbook", "violation_workbook", "company_score_workbook", "company_industry_workbook", "esg_rating_workbook", "negative_news", "archive", "unknown"]);
const sourceFileParseStatusSchema = z.enum(["discovered", "schema_pending", "ready", "unsupported", "failed"]);

export const sourceFileRecordSchema = z.object({
  id: z.string(), provider: z.literal("baidu_netdisk"), path: z.string().min(1), filename: z.string().min(1),
  fsid: z.string().min(1), md5: z.string().optional(), size: z.number().int().nonnegative(), kind: sourceFileKindSchema,
  parseStatus: sourceFileParseStatusSchema, discoveredAt: z.string().datetime({ offset: true }), modifiedAt: z.string().datetime({ offset: true }).optional(),
  detectedFields: z.array(z.string()), qualityFlags: z.array(z.string()),
});

export const sourceFieldCatalogSchema = z.object({
  sourceFileId: z.string(), sheetName: z.string().optional(),
  fields: z.array(z.object({
    sourceField: z.string().min(1), targetField: z.string().optional(),
    dataType: z.enum(["string", "number", "date", "boolean", "unknown"]), required: z.boolean(),
    status: z.enum(["mapped", "unmapped", "invalid"]),
  })),
});

export const dataSourceStatusSchema = z.object({
  provider: z.literal("baidu_netdisk"), rootPath: z.string().min(1),
  connectionStatus: z.enum(["connected", "degraded", "unavailable"]), lastSyncedAt: z.string().datetime({ offset: true }).optional(),
  fileCount: z.number().int().nonnegative(), readyFileCount: z.number().int().nonnegative(), schemaPendingFileCount: z.number().int().nonnegative(),
  message: z.string().optional(),
});

export const dataSourceSyncJobSchema = z.object({
  jobId: z.string(), provider: z.literal("baidu_netdisk"), status: z.enum(["queued", "running", "completed", "failed"]),
  phase: z.enum(["discover", "inspect_schema", "extract", "normalize", "index"]), progress: z.number().min(0).max(100),
  discoveredFileCount: z.number().int().nonnegative(), readyFileCount: z.number().int().nonnegative(),
  error: z.object({ cause: z.string(), impact: z.string(), nextAction: z.string() }).optional(),
});
