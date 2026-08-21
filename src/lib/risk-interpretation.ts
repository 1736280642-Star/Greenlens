import type {
  AnalysisMetric,
  CompanyMetricHistoryPoint,
  CompanyYearRecord,
  EvidenceItem,
  GsiScoreRecord,
  MetricCode,
  RiskInterpretation,
  RiskInterpretationCitation,
  RiskInterpretationFocus,
} from "@/types";
import { evidenceMatchesForMetric, type MetricEvidenceMatch } from "@/lib/evidence-linking";

export interface BuildRiskInterpretationInput {
  company: CompanyYearRecord;
  cohort: CompanyYearRecord[];
  evidence: EvidenceItem[];
  history: CompanyMetricHistoryPoint[];
  gsi?: GsiScoreRecord | null;
  focus?: RiskInterpretationFocus;
}

const metricExplanations: Record<MetricCode, (metric: AnalysisMetric) => string> = {
  EASS: (metric) => `环境行动实质性风险方向值为 ${percent(metric.riskValue)}。该值越高，表示计划或模糊表述相对已实施行动更突出。`,
  IR: (metric) => `模糊环境声明风险方向值为 ${percent(metric.riskValue)}。重点检查缺少范围、口径或量化边界的表述。`,
  UPR: (metric) => `未验证规划风险方向值为 ${percent(metric.riskValue)}。重点检查目标是否包含基准年、阶段目标、KPI 与实施路径。`,
  ESGSI: (metric) => `修辞与实质信息差异风险方向值为 ${percent(metric.riskValue)}。该项用于识别积极表达与可核验信息之间的距离。`,
  EAA_ESI: (metric) => `最终调整指数为 ${percent(metric.normalizedValue)}，由基础 ESI、行动实质性、模糊声明和未验证规划共同形成。`,
  IMBALANCE: (metric) => `ESG 关注结构失衡值为 ${percent(metric.normalizedValue)}，需要结合行业披露语境解释。`,
};

const metricNames: Record<MetricCode, string> = {
  EASS: "行动实质性",
  IR: "模糊声明",
  UPR: "未验证规划",
  ESGSI: "修辞—内容差异",
  EAA_ESI: "综合调整风险",
  IMBALANCE: "ESG 关注失衡",
};

export function buildRiskInterpretation({ company, cohort, evidence, history, gsi = null, focus = "overview" }: BuildRiskInterpretationInput): RiskInterpretation {
  const scopedEvidence = evidence.filter((item) => item.companyId === company.companyId && item.reportYear === company.reportYear);
  const eligibleMetrics = company.metrics
    .filter((metric) => metric.code !== "EAA_ESI")
    .sort((a, b) => (b.riskValue ?? -1) - (a.riskValue ?? -1));
  const reservedSpecificEvidenceIds = new Set([
    ...evidenceMatchesForMetric("UPR", scopedEvidence, metricByCode(company, "UPR")?.evidenceIds).map((item) => item.evidenceId),
    ...evidenceMatchesForMetric("IR", scopedEvidence, metricByCode(company, "IR")?.evidenceIds).map((item) => item.evidenceId),
  ]);
  const drivers = eligibleMetrics.slice(0, 4).map((metric) => {
    const matches = evidenceMatchesForMetric(metric.code, scopedEvidence, metric.evidenceIds,
      metric.code === "EASS" ? { excludeInferredIds: reservedSpecificEvidenceIds } : undefined);
    const evidenceRelations = matches.map((match) => ({ ...match, citationId: citationId(match.evidenceId) }));
    const citationIds = evidenceRelations.map((item) => item.citationId);
    const supportingCitationIds = evidenceRelations.filter((item) => item.relation === "supporting").map((item) => item.citationId);
    const counterCitationIds = evidenceRelations.filter((item) => item.relation === "counter").map((item) => item.citationId);
    const evidenceAssessment = buildDriverEvidenceAssessment(matches);
    const evidenceGap = buildDriverEvidenceGap(metric.code, matches);
    const finding = metricExplanations[metric.code](metric);
    return {
      metricCode: metric.code,
      label: metricNames[metric.code],
      riskValue: metric.riskValue,
      threshold: metric.threshold,
      contribution: metric.contribution,
      status: metric.riskValue == null ? "unavailable" as const : metric.riskValue >= (metric.threshold ?? 0.65) ? "attention" as const : "watch" as const,
      explanation: finding,
      finding,
      whyItMatters: metricWhyItMatters[metric.code],
      evidenceAssessment,
      evidenceGap,
      nextAction: metricNextAction[metric.code],
      citationIds,
      supportingCitationIds,
      counterCitationIds,
      evidenceRelations,
      calculation: buildMetricCalculation(company, metric),
    };
  });

  const citedEvidenceIds = new Set(drivers.flatMap((driver) => driver.citationIds.map((id) => id.replace(/^citation-/, ""))));
  const externalItems = scopedEvidence.filter((item) => item.type === "external");
  const citationItems = [
    ...scopedEvidence.filter((item) => citedEvidenceIds.has(item.id)),
    ...externalItems.filter((item) => !citedEvidenceIds.has(item.id)).slice(0, 2),
  ];
  const citations: RiskInterpretationCitation[] = citationItems.map((item) => ({
    id: citationId(item.id),
    evidenceId: item.id,
    kind: item.status === "verified" ? "fact" : item.status === "insufficient" ? "unknown" : "inference",
    label: item.type === "external" ? "外部事实" : item.page ? `报告第 ${item.page} 页` : "报告证据",
    excerpt: item.excerpt,
    sourceLabel: item.sourceLabel,
    page: item.page,
    eventDate: item.eventDate,
  }));

  const evidenceGaps = buildEvidenceGaps(company, citations);
  const uncertainty = buildUncertainty(company, drivers, citations, evidenceGaps);
  const industry = buildIndustryComparison(company, cohort);
  const historyComparison = buildHistoryComparison(company, history);
  const leading = drivers.filter((driver) => driver.status === "attention").slice(0, 2);
  const headline = buildHeadline(company, leading.map((driver) => driver.label));
  const summary = buildSummary(company, leading, evidenceGaps, uncertainty.level);
  const recommendedActions = buildActions(drivers, evidenceGaps, industry.available, historyComparison.available);
  const robustness = buildRobustness(company, gsi);

  return {
    id: `${company.id}:interpretation:${company.versions.score}`,
    companyId: company.companyId,
    companyName: company.companyName,
    reportYear: company.reportYear,
    generatedAt: company.computedAt,
    focus,
    headline,
    summary,
    researchBrief: {
      finding: headline,
      evidenceAssessment: buildOverallEvidenceAssessment(drivers, evidenceGaps),
      modelAgreement: buildModelAgreementText(company.finalIndex, robustness),
      priorityAction: recommendedActions[0] ?? "先补齐关键输入，再形成扩大化判断",
    },
    riskBand: company.riskBand,
    finalIndex: company.finalIndex,
    evidenceCoverage: company.evidenceCoverage,
    robustness,
    drivers,
    citations,
    evidenceGaps,
    uncertainty,
    history: historyComparison,
    industry,
    recommendedActions,
    versions: {
      data: company.versions.data,
      model: company.versions.model,
      score: company.versions.score,
      threshold: company.versions.threshold,
    },
  };
}

const metricWhyItMatters: Record<MetricCode, string> = {
  EASS: "计划和模糊行动占比偏高时，披露内容可能尚未转化为可核验的执行结果。",
  IR: "缺少范围、口径或量化边界会提高研究人员验证声明真实性的成本。",
  UPR: "没有基准年、阶段目标、KPI 或实施路径的计划，难以持续追踪兑现程度。",
  ESGSI: "积极修辞与实质信息之间的距离较大时，需要进一步检查披露是否有行动和数据支撑。",
  EAA_ESI: "综合调整风险用于排序研究优先级，不应脱离分项指标和证据独立解释。",
  IMBALANCE: "ESG 议题分布明显失衡可能反映披露侧重点，需要结合行业特征判断。",
};

const metricNextAction: Record<MetricCode, string> = {
  EASS: "优先核对计划类陈述是否已转化为有日期、责任主体和结果数据的实施行动。",
  IR: "回到原文确认声明的适用范围、计算口径、时间边界和量化依据。",
  UPR: "核验目标是否同时具备基准年、阶段目标、量化 KPI 和明确实施路径。",
  ESGSI: "抽查高强度积极表述，确认其附近是否存在行动、绩效数据和第三方验证。",
  EAA_ESI: "逐项复核基础指标及其权重贡献，避免只依据综合分数形成判断。",
  IMBALANCE: "与同业披露结构比较，并确认低关注议题是否属于重大议题缺失。",
};

function buildDriverEvidenceAssessment(matches: MetricEvidenceMatch[]) {
  if (!matches.length) return "当前没有可定位到该指标的直接证据，指标判断尚不能完成原文核验。";
  const supporting = matches.filter((item) => item.relation === "supporting").length;
  const counter = matches.filter((item) => item.relation === "counter").length;
  if (supporting && counter) return `已找到 ${supporting} 条支持证据和 ${counter} 条反向证据，当前信号存在可核验的正反两面。`;
  if (supporting) return `已找到 ${supporting} 条直接支持证据；尚未关联到能削弱该风险判断的反向证据。`;
  if (counter) return `已找到 ${counter} 条反向证据，当前风险信号需要结合已实施行动重新权衡。`;
  return `已关联 ${matches.length} 条背景证据，但其对风险方向的支持力度仍需人工判断。`;
}

function buildDriverEvidenceGap(metricCode: MetricCode, matches: MetricEvidenceMatch[]) {
  if (!matches.length) return `缺少可直接解释 ${metricNames[metricCode]} 指标的页码级原文。`;
  if (!matches.some((item) => item.relation === "counter")) return "尚未发现可用于反证或削弱当前风险信号的材料。";
  return "现有证据包含正反信息，但仍需核验其时间、范围和量化口径是否一致。";
}

function buildMetricCalculation(company: CompanyYearRecord, metric: AnalysisMetric): RiskInterpretation["drivers"][number]["calculation"] {
  const components = metric.code === "EASS" ? [
    { label: "已实施行动", value: company.environmentalActions.implemented, unit: "count" as const },
    { label: "计划行动", value: company.environmentalActions.planning, unit: "count" as const },
    { label: "状态不明确", value: company.environmentalActions.indeterminate, unit: "count" as const },
    { label: "计划折算系数", value: company.environmentalActions.planningAlpha, unit: "ratio" as const },
  ] : metric.code === "IR" ? [
    { label: "状态不明确陈述", value: company.environmentalActions.indeterminate, unit: "count" as const },
    { label: "环境行动陈述总数", value: company.environmentalActions.totalStatements, unit: "count" as const },
  ] : metric.code === "UPR" ? [
    { label: "未验证计划", value: company.planningVerification.unverifiedPlanning, unit: "count" as const },
    { label: "已验证计划", value: company.planningVerification.verifiedPlanning, unit: "count" as const },
    { label: "计划总数", value: company.planningVerification.totalPlanning, unit: "count" as const },
  ] : metric.code === "ESGSI" ? [
    { label: "情绪得分（标准化）", value: company.scoreInputs.sentiment.normalizedValue, unit: "ratio" as const },
    { label: "可持续信息得分（标准化）", value: company.scoreInputs.sustainability.normalizedValue, unit: "ratio" as const },
  ] : metric.code === "IMBALANCE" ? [
    { label: "环境议题关注", value: company.esgTopics.eFocus, unit: "ratio" as const },
    { label: "社会议题关注", value: company.esgTopics.sFocus, unit: "ratio" as const },
    { label: "治理议题关注", value: company.esgTopics.gFocus, unit: "ratio" as const },
  ] : [];
  return {
    rawValue: metric.rawValue,
    normalizedValue: metric.normalizedValue,
    riskValue: metric.riskValue,
    ...(metric.numerator == null ? {} : { numerator: metric.numerator }),
    ...(metric.denominator == null ? {} : { denominator: metric.denominator }),
    formulaVersion: metric.formulaVersion,
    normalizationVersion: metric.normalizationVersion,
    components,
  };
}

function buildRobustness(company: CompanyYearRecord, gsi: GsiScoreRecord | null): RiskInterpretation["robustness"] {
  const redFlags = company.riskClassification;
  return {
    coverage: gsi ? "three_views" : "two_views",
    gsi: gsi ? {
      gsiFinal: gsi.gsiFinal,
      gwScore: gsi.gwScore,
      coveragePenalty: gsi.coveragePenalty,
      imbalance: gsi.imbalance,
      eFocus: gsi.eFocus,
      sFocus: gsi.sFocus,
      gFocus: gsi.gFocus,
      modelVersion: gsi.modelVersion,
      dataVersion: gsi.dataVersion,
      qualityFlags: gsi.qualityFlags,
    } : null,
    redFlags: {
      triggered: redFlags.redFlags,
      count: redFlags.redFlagCount,
      classificationVersion: redFlags.classificationVersion,
      reason: redFlags.reason,
    },
  };
}

function buildOverallEvidenceAssessment(drivers: RiskInterpretation["drivers"], gaps: string[]) {
  const supporting = drivers.reduce((sum, driver) => sum + driver.supportingCitationIds.length, 0);
  const counter = drivers.reduce((sum, driver) => sum + driver.counterCitationIds.length, 0);
  return `关键指标共形成 ${supporting} 个支持关系和 ${counter} 个反向关系${gaps.length ? `，仍有 ${gaps.length} 项证据或数据缺口` : "，当前未发现阻断性缺口"}。`;
}

function buildModelAgreementText(finalIndex: number | null, robustness: RiskInterpretation["robustness"]) {
  const primary = `EAA-ESI ${percent(finalIndex)}`;
  const flags = robustness.redFlags.triggered.map(redFlagLabel).join("、") || "未触发 Red Flag";
  if (robustness.coverage === "three_views" && robustness.gsi) return `${primary}、GSI ${percent(robustness.gsi.gsiFinal)}；Red Flag：${flags}。三个视角并列提供，不预设结论一致。`;
  if (robustness.coverage === "two_views") return `${primary}；Red Flag：${flags}；当前缺少 GSI 结果。`;
  return "当前仅 EAA-ESI 主模型具备可用输入，GSI 与 Red Flag 未形成额外稳健性支持。";
}

function redFlagLabel(code: CompanyYearRecord["riskClassification"]["redFlags"][number]) {
  return ({ HIGH_ESGSI: "ESI 较高", LOW_EASS: "行动实质偏低", HIGH_IR: "模糊声明较高", HIGH_UPR: "未验证计划较高" } as const)[code];
}

function metricByCode(company: CompanyYearRecord, metricCode: MetricCode) {
  return company.metrics.find((metric) => metric.code === metricCode);
}

function buildHeadline(company: CompanyYearRecord, leading: string[]) {
  if (company.finalIndex == null || company.riskBand === "unavailable") return "当前输入不足，暂不能形成完整风险解读";
  const prefix = company.riskBand === "high" ? "高风险研究信号" : company.riskBand === "medium" ? "中等风险研究信号" : "低风险研究信号";
  return leading.length ? `${prefix}，主要来自${leading.join("与")}` : `${prefix}，尚无单一指标明显越过关注阈值`;
}

function buildSummary(company: CompanyYearRecord, leading: RiskInterpretation["drivers"], gaps: string[], uncertainty: RiskInterpretation["uncertainty"]["level"]) {
  if (company.finalIndex == null) return `当前公司年度缺少形成综合指数所需的输入。系统仅展示已取得的证据与质量缺口，不补造风险结论。`;
  const driverText = leading.length ? `主要关注项为${leading.map((item) => item.label).join("、")}` : "未发现明显越过关注阈值的单项指标";
  const gapText = gaps.length ? `；仍有 ${gaps.length} 项证据或数据缺口` : "；当前关联证据可用于追溯";
  return `${company.companyName} ${company.reportYear} 年综合风险指数为 ${percent(company.finalIndex)}，${driverText}${gapText}。不确定性为${uncertaintyLabel(uncertainty)}，该结果用于研究筛查，不构成漂绿认定。`;
}

function buildEvidenceGaps(company: CompanyYearRecord, citations: RiskInterpretationCitation[]) {
  const gaps: string[] = [];
  if (company.evidenceLinkageStatus === "parse_failed") gaps.push("报告文本解析失败，无法核验对应原文");
  if (company.evidenceLinkageStatus === "unlinked") gaps.push("结构化指标尚未关联到公司年度证据");
  if (company.evidenceLinkageStatus === "low_coverage" || company.evidenceCoverage < 70) gaps.push(`证据覆盖率仅为 ${company.evidenceCoverage}%`);
  if (!citations.some((item) => item.page)) gaps.push("缺少可定位到 PDF 页码的报告原文");
  if (!citations.some((item) => item.label === "外部事实")) gaps.push("当前没有可用于交叉核验的外部环境事实");
  if (company.metrics.some((metric) => metric.calculationStatus === "unavailable")) gaps.push("部分指标输入不完整，相关数值不可用");
  return [...new Set(gaps)];
}

function buildUncertainty(company: CompanyYearRecord, drivers: RiskInterpretation["drivers"], citations: RiskInterpretationCitation[], gaps: string[]): RiskInterpretation["uncertainty"] {
  const reasons: string[] = [];
  if (company.evidenceLinkageStatus === "parse_failed") reasons.push("PDF 文本解析失败");
  if (company.evidenceLinkageStatus === "unlinked") reasons.push("证据尚未关联到公司年度");
  if (company.evidenceCoverage < 70) reasons.push(`证据覆盖率低于 70%（当前 ${company.evidenceCoverage}%）`);
  if (!citations.length) reasons.push("没有可引用的原文或外部事实");
  if (drivers.some((driver) => driver.status === "unavailable")) reasons.push("至少一项核心指标不可计算");
  if (!reasons.length && gaps.length) reasons.push(...gaps.slice(0, 2));
  const unavailable = company.finalIndex == null || company.evidenceLinkageStatus === "parse_failed" || company.evidenceLinkageStatus === "unlinked";
  const level = unavailable ? "unavailable" : reasons.length >= 2 ? "high" : reasons.length === 1 ? "medium" : "low";
  return { level, reasons: reasons.length ? reasons : ["关键指标、报告证据与版本信息均已取得"] };
}

function buildIndustryComparison(company: CompanyYearRecord, cohort: CompanyYearRecord[]): RiskInterpretation["industry"] {
  const peers = cohort.filter((item) => item.reportYear === company.reportYear && item.industry === company.industry && item.finalIndex != null);
  if (company.finalIndex == null || peers.length < 3) return { available: false, sampleSize: peers.length, text: `同一行业年度仅有 ${peers.length} 个可比样本，少于 3 个，不生成行业高低判断。` };
  const values = peers.map((item) => item.finalIndex!).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  const delta = company.finalIndex - median;
  return {
    available: true, sampleSize: peers.length, currentValue: company.finalIndex, referenceValue: median, delta,
    text: `在 ${company.reportYear} 年 ${company.industry} 的 ${peers.length} 个可比样本中，公司风险指数${delta >= 0 ? "高于" : "低于"}行业中位数 ${Math.abs(delta * 100).toFixed(1)} 个百分点。`,
  };
}

function buildHistoryComparison(company: CompanyYearRecord, history: CompanyMetricHistoryPoint[]): RiskInterpretation["history"] {
  const previous = history.filter((item) => item.companyId === company.companyId && item.reportYear < company.reportYear && item.finalIndex != null).sort((a, b) => b.reportYear - a.reportYear)[0];
  if (company.finalIndex == null || previous?.finalIndex == null) return { available: false, text: "没有同口径的上一可用年度记录，不生成同比变化。" };
  const delta = company.finalIndex - previous.finalIndex;
  return {
    available: true, comparisonYear: previous.reportYear, currentValue: company.finalIndex, referenceValue: previous.finalIndex, delta,
    text: `与 ${previous.reportYear} 年相比，综合风险指数${delta >= 0 ? "上升" : "下降"} ${Math.abs(delta * 100).toFixed(1)} 个百分点。该变化只表示同口径指标变化。`,
  };
}

function buildActions(drivers: RiskInterpretation["drivers"], gaps: string[], industryAvailable: boolean, historyAvailable: boolean) {
  const actions: string[] = [];
  if (drivers.some((item) => item.metricCode === "UPR" && item.status === "attention")) actions.push("核验环境目标的基准年、阶段目标、KPI 和实施路径");
  if (drivers.some((item) => item.metricCode === "IR" && item.status === "attention")) actions.push("定位模糊声明并检查量化口径与披露边界");
  if (gaps.length) actions.push("先补齐证据缺口，再扩大结论适用范围");
  if (industryAvailable) actions.push("结合行业中位数识别异常披露结构");
  if (historyAvailable) actions.push("查看跨年证据，区分短期波动与持续性风险");
  return [...new Set(actions)].slice(0, 4);
}

function citationId(evidenceId: string) { return `citation-${evidenceId}`; }
function percent(value: number | null | undefined) { return value == null ? "不可用" : `${Math.round(value * 100)}%`; }
function uncertaintyLabel(level: RiskInterpretation["uncertainty"]["level"]) { return ({ low: "较低", medium: "中等", high: "较高", unavailable: "不可判定" } as const)[level]; }
