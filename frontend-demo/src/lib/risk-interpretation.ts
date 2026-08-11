import type {
  AnalysisMetric,
  CompanyMetricHistoryPoint,
  CompanyYearRecord,
  EvidenceItem,
  MetricCode,
  RiskInterpretation,
  RiskInterpretationCitation,
  RiskInterpretationFocus,
} from "@/types";

interface BuildRiskInterpretationInput {
  company: CompanyYearRecord;
  cohort: CompanyYearRecord[];
  evidence: EvidenceItem[];
  history: CompanyMetricHistoryPoint[];
  focus?: RiskInterpretationFocus;
}

const metricExplanations: Record<MetricCode, (metric: AnalysisMetric) => string> = {
  EASS: (metric) => `环境行动实质性风险方向值为 ${percent(metric.riskValue)}。该值越高，表示计划或模糊表述相对已实施行动更突出。`,
  IR: (metric) => `模糊环境声明风险方向值为 ${percent(metric.riskValue)}。重点检查缺少范围、口径或量化边界的表述。`,
  UPR: (metric) => `未验证规划风险方向值为 ${percent(metric.riskValue)}。重点检查目标是否包含基准年、阶段目标、KPI 与实施路径。`,
  ESGSI: (metric) => `修辞与实质信息差异风险方向值为 ${percent(metric.riskValue)}。该项用于识别积极表达与可核验信息之间的距离。`,
  EAA_ESGSI: (metric) => `最终调整指数为 ${percent(metric.normalizedValue)}，由基础 ESGSI、行动实质性、模糊声明和未验证规划共同形成。`,
  IMBALANCE: (metric) => `ESG 关注结构失衡值为 ${percent(metric.normalizedValue)}，需要结合行业披露语境解释。`,
};

const metricNames: Record<MetricCode, string> = {
  EASS: "行动实质性",
  IR: "模糊声明",
  UPR: "未验证规划",
  ESGSI: "修辞—内容差异",
  EAA_ESGSI: "综合调整风险",
  IMBALANCE: "ESG 关注失衡",
};

export function buildRiskInterpretation({ company, cohort, evidence, history, focus = "overview" }: BuildRiskInterpretationInput): RiskInterpretation {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const eligibleMetrics = company.metrics
    .filter((metric) => metric.code !== "EAA_ESGSI")
    .sort((a, b) => (b.riskValue ?? -1) - (a.riskValue ?? -1));
  const drivers = eligibleMetrics.slice(0, 4).map((metric) => {
    const citationIds = metric.evidenceIds.filter((id) => evidenceById.has(id)).map(citationId);
    return {
      metricCode: metric.code,
      label: metricNames[metric.code],
      riskValue: metric.riskValue,
      threshold: metric.threshold,
      contribution: metric.contribution,
      status: metric.riskValue == null ? "unavailable" as const : metric.riskValue >= (metric.threshold ?? 0.65) ? "attention" as const : "watch" as const,
      explanation: metricExplanations[metric.code](metric),
      citationIds,
    };
  });

  const citedEvidenceIds = new Set(drivers.flatMap((driver) => driver.citationIds.map((id) => id.replace(/^citation-/, ""))));
  const externalItems = evidence.filter((item) => item.type === "external");
  const citationItems = [
    ...evidence.filter((item) => citedEvidenceIds.has(item.id)),
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

  return {
    id: `${company.id}:interpretation:${company.versions.score}`,
    companyId: company.companyId,
    companyName: company.companyName,
    reportYear: company.reportYear,
    generatedAt: company.computedAt,
    focus,
    headline,
    summary,
    riskBand: company.riskBand,
    finalIndex: company.finalIndex,
    evidenceCoverage: company.evidenceCoverage,
    drivers,
    citations,
    evidenceGaps,
    uncertainty,
    history: historyComparison,
    industry,
    recommendedActions: buildActions(drivers, evidenceGaps, industry.available, historyComparison.available),
    versions: {
      data: company.versions.data,
      model: company.versions.model,
      score: company.versions.score,
      threshold: company.versions.threshold,
    },
  };
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
