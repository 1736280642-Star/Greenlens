import type {
  AnalysisMetric,
  CompanyMetricHistoryPoint,
  CompanyYearRecord,
  EnvironmentalAspectCategory,
  EnvironmentalAspectScore,
  EvidenceItem,
  FinancialYearRecord,
  MetricCode,
  PanelYearSummary,
  RedFlagCode,
  RiskBand,
  ViolationEvent,
} from "@/types";

const versions = {
  schema: "metric-contract-v2",
  data: "SYN-2026.08",
  feature: "ESG-TEXT-2.0",
  model: "EAA-ESGSI-DEMO-2.0",
  score: "eaa-esgsi-v2",
  threshold: "risk-quantile-redflag-v1",
};

const scoringParameters = {
  planningAlpha: 0.5,
  lambdaAction: 0.3,
  lambdaIndeterminate: 0.2,
  lambdaPlanning: 0.1,
  parameterVersion: "eaa-parameters-v1",
};

export function evidenceIdsFor(companyId: string): Record<MetricCode, string[]> {
  const ids = companyId === "cy-materials"
    ? { action: "ev-action-1", ir: "ev-ir-1", upr: "ev-2", metric: "ev-3", index: "ev-index-1" }
    : { action: `${companyId}-action`, ir: `${companyId}-ir`, upr: `${companyId}-upr`, metric: `${companyId}-metric`, index: `${companyId}-index` };
  return {
    EASS: [ids.action], IR: [ids.ir], UPR: [ids.upr], ESGSI: [ids.metric], EAA_ESGSI: [ids.index], IMBALANCE: [ids.metric],
  };
}

interface CompanySeed {
  id: string;
  name: string;
  code: string;
  industry: string;
  esgsiNormalized: number;
  uprTarget: number;
  imbalance: number;
  coverage: number;
  evidenceStatus: CompanyYearRecord["evidenceStatus"];
  reviewStatus: CompanyYearRecord["reviewStatus"];
  events: number;
  actions: [number, number, number];
  topicCounts: [number, number, number];
}

interface PreparedCompany {
  seed: CompanySeed;
  index: number;
  eass: number;
  ir: number;
  upr: number;
  verifiedPlanning: number;
  unverifiedPlanning: number;
  esgsiRaw: number;
  finalRaw: number;
  actionPenalty: number;
  indeterminatePenalty: number;
  planningPenalty: number;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function prepareCompany(seed: CompanySeed, index: number): PreparedCompany {
  const [implemented, planning, indeterminate] = seed.actions;
  const totalStatements = implemented + planning + indeterminate;
  const unverifiedPlanning = Math.min(planning, Math.round(planning * seed.uprTarget));
  const verifiedPlanning = planning - unverifiedPlanning;
  const upr = planning ? unverifiedPlanning / planning : 0;
  const eass = totalStatements ? (implemented + planning * scoringParameters.planningAlpha) / totalStatements : 0;
  const ir = totalStatements ? indeterminate / totalStatements : 0;
  const esgsiRaw = seed.esgsiNormalized - 0.5;
  const actionPenalty = scoringParameters.lambdaAction * (1 - eass);
  const indeterminatePenalty = scoringParameters.lambdaIndeterminate * ir;
  const planningPenalty = scoringParameters.lambdaPlanning * upr;
  const finalRaw = seed.esgsiNormalized + actionPenalty + indeterminatePenalty + planningPenalty;
  return { seed, index, eass, ir, upr, verifiedPlanning, unverifiedPlanning, esgsiRaw, finalRaw, actionPenalty, indeterminatePenalty, planningPenalty };
}

function quantile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] === undefined ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function metric(
  code: MetricCode,
  label: string,
  rawValue: number,
  normalizedValue: number,
  riskValue: number,
  evidenceIds: string[],
  options: Partial<AnalysisMetric> = {},
): AnalysisMetric {
  return {
    code,
    label,
    rawValue: round(rawValue),
    normalizedValue: round(normalizedValue),
    riskValue: round(riskValue),
    riskDirection: code === "EASS" ? "lower_is_risk" : code === "IMBALANCE" ? "contextual" : "higher_is_risk",
    formulaVersion: `${code.toLowerCase()}-v2`,
    normalizationVersion: code === "EAA_ESGSI" ? "eaa-demo-cohort-minmax-v1" : code === "ESGSI" ? "esgsi-demo-v1" : "identity-v1",
    normalizationScope: code === "EAA_ESGSI" ? "synthetic_demo" : "none",
    calculationStatus: "mock",
    evidenceIds,
    ...options,
  };
}

const baseSeeds: CompanySeed[] = [
  { id: "cy-materials", name: "澄岳新材", code: "688217", industry: "新材料", esgsiNormalized: .55, uprTarget: .72, imbalance: .48, coverage: 64, evidenceStatus: "insufficient", reviewStatus: "partial", events: 5, actions: [12, 18, 20], topicCounts: [648, 221, 184] },
  { id: "linhai-energy", name: "林海能源", code: "600741", industry: "综合能源", esgsiNormalized: .51, uprTarget: .67, imbalance: .42, coverage: 71, evidenceStatus: "pending", reviewStatus: "pending", events: 6, actions: [14, 17, 16], topicCounts: [701, 198, 166] },
  { id: "qiming-mobility", name: "启明交通", code: "301482", industry: "交通设备", esgsiNormalized: .43, uprTarget: .54, imbalance: .34, coverage: 83, evidenceStatus: "verified", reviewStatus: "reviewed", events: 3, actions: [19, 15, 11], topicCounts: [574, 247, 213] },
  { id: "beichen-foods", name: "北辰食品", code: "002761", industry: "消费品", esgsiNormalized: .31, uprTarget: .48, imbalance: .29, coverage: 42, evidenceStatus: "insufficient", reviewStatus: "pending", events: 2, actions: [20, 12, 8], topicCounts: [402, 318, 236] },
  { id: "yuanfang-tech", name: "远方科技", code: "688903", industry: "电子制造", esgsiNormalized: .22, uprTarget: .27, imbalance: .19, coverage: 92, evidenceStatus: "verified", reviewStatus: "reviewed", events: 1, actions: [27, 9, 4], topicCounts: [455, 339, 302] },
  { id: "jiuhe-build", name: "九禾建设", code: "601593", industry: "建筑", esgsiNormalized: .38, uprTarget: .61, imbalance: .51, coverage: 58, evidenceStatus: "disputed", reviewStatus: "disputed", events: 4, actions: [16, 14, 15], topicCounts: [619, 171, 143] },
];

const syntheticNames = [
  "云岫复材", "星泓化工", "青岳装备", "沐川纺织", "禾望包装", "清原电气", "岚桥物流", "泽衍科技",
  "森岳建材", "澜序制造", "景辰玻璃", "汇青机械", "川河纸业", "启川电机", "新澜涂料", "岭南器材",
  "远泽包装", "松原设备", "潮汐材料", "衡川精工", "青砾科技", "云港运输", "明川制品", "清域工程",
];
const industries = ["新材料", "综合能源", "交通设备", "消费品", "电子制造", "建筑"];

const generatedSeeds: CompanySeed[] = syntheticNames.map((name, index) => ({
  id: `demo-company-${String(index + 1).padStart(2, "0")}`,
  name,
  code: `D${String(index + 101).padStart(5, "0")}`,
  industry: industries[index % industries.length],
  esgsiNormalized: round(.2 + ((index * 17) % 48) / 100, 2),
  uprTarget: round(.24 + ((index * 13) % 58) / 100, 2),
  imbalance: round(.17 + ((index * 7) % 43) / 100, 2),
  coverage: 48 + (index * 9) % 49,
  evidenceStatus: ["pending", "insufficient", "verified", "disputed"][index % 4] as CompanyYearRecord["evidenceStatus"],
  reviewStatus: ["pending", "pending", "reviewed", "disputed"][index % 4] as CompanyYearRecord["reviewStatus"],
  events: 1 + index % 7,
  actions: [12 + index % 17, 8 + (index * 3) % 15, 5 + (index * 5) % 14],
  topicCounts: [380 + (index * 31) % 360, 170 + (index * 17) % 240, 140 + (index * 13) % 210],
}));

const prepared = [...baseSeeds, ...generatedSeeds].map(prepareCompany);
const minFinalRaw = Math.min(...prepared.map((item) => item.finalRaw));
const maxFinalRaw = Math.max(...prepared.map((item) => item.finalRaw));
const normalizedFinals = prepared.map((item) => (item.finalRaw - minFinalRaw) / (maxFinalRaw - minFinalRaw));
const lowQuantile = quantile(normalizedFinals, 1 / 3);
const highQuantile = quantile(normalizedFinals, 2 / 3);

function createCompany(item: PreparedCompany): CompanyYearRecord {
  const { seed, index } = item;
  const [implemented, planning, indeterminate] = seed.actions;
  const totalStatements = implemented + planning + indeterminate;
  const totalWords = 28_400 + index * 713;
  const [eCount, sCount, gCount] = seed.topicCounts;
  const finalIndex = (item.finalRaw - minFinalRaw) / (maxFinalRaw - minFinalRaw);
  const baseRisk = finalIndex >= highQuantile ? "relatively_high" : finalIndex >= lowQuantile ? "relatively_medium" : "relatively_low";
  const redFlags: RedFlagCode[] = [];
  if (seed.esgsiNormalized >= .55) redFlags.push("HIGH_ESGSI");
  if (item.eass <= .5) redFlags.push("LOW_EASS");
  if (item.ir >= .33) redFlags.push("HIGH_IR");
  if (item.upr >= .6) redFlags.push("HIGH_UPR");
  const riskBand: RiskBand = baseRisk === "relatively_high" || redFlags.length >= 2 ? "high" : baseRisk === "relatively_medium" || redFlags.length >= 1 ? "medium" : "low";
  const evidenceIds = evidenceIdsFor(seed.id);
  const sentimentNormalized = clamp(.62 + item.esgsiRaw / 2);
  const sustainabilityNormalized = clamp(sentimentNormalized - item.esgsiRaw);
  const metrics: AnalysisMetric[] = [
    metric("EASS", "环境行动实质性", item.eass, item.eass, 1 - item.eass, evidenceIds.EASS, { numerator: implemented + planning * scoringParameters.planningAlpha, denominator: totalStatements, threshold: .5, weight: scoringParameters.lambdaAction, contribution: item.actionPenalty }),
    metric("IR", "模糊声明比例", item.ir, item.ir, item.ir, evidenceIds.IR, { numerator: indeterminate, denominator: totalStatements, threshold: .33, weight: scoringParameters.lambdaIndeterminate, contribution: item.indeterminatePenalty }),
    metric("UPR", "未验证计划比例", item.upr, item.upr, item.upr, evidenceIds.UPR, { numerator: item.unverifiedPlanning, denominator: planning, threshold: .6, weight: scoringParameters.lambdaPlanning, contribution: item.planningPenalty }),
    metric("ESGSI", "修辞—内容差异", item.esgsiRaw, seed.esgsiNormalized, seed.esgsiNormalized, evidenceIds.ESGSI, { threshold: .55, contribution: seed.esgsiNormalized }),
    metric("EAA_ESGSI", "环境行动调整型漂绿风险指数", item.finalRaw, finalIndex, finalIndex, evidenceIds.EAA_ESGSI, { threshold: highQuantile }),
    metric("IMBALANCE", "ESG 关注失衡", seed.imbalance, seed.imbalance, seed.imbalance, evidenceIds.IMBALANCE, { threshold: .45 }),
  ];
  const sampleGroup = totalStatements >= 20 ? "main_n_ge_20" : totalStatements >= 10 ? "robustness_n_10_19" : "low_n_lt_10";
  return {
    id: `${seed.id}-2025`,
    reportId: `report-${seed.id}-2025`,
    companyId: seed.id,
    companyName: seed.name,
    stockCode: seed.code,
    industry: seed.industry,
    reportYear: 2025,
    publishDate: `2026-0${(index % 3) + 2}-${String(8 + index % 20).padStart(2, "0")}`,
    finalIndexRaw: round(item.finalRaw),
    finalIndex: round(finalIndex),
    riskBand,
    evidenceCoverage: seed.coverage,
    evidenceStatus: seed.evidenceStatus,
    reviewStatus: seed.reviewStatus,
    eventCount: seed.events,
    textProcessing: {
      textLength: Math.round(totalWords * 1.42),
      totalWords,
      sentenceCount: 930 + index * 17,
      environmentalSentenceCount: totalStatements,
      tokenCount: Math.round(totalWords * 1.18),
    },
    esgTopics: { eCount, sCount, gCount, eFocus: eCount / totalWords, sFocus: sCount / totalWords, gFocus: gCount / totalWords, imbalanceScore: seed.imbalance },
    environmentalActions: { totalStatements, implemented, planning, indeterminate, planningAlpha: scoringParameters.planningAlpha },
    planningVerification: {
      totalPlanning: planning,
      verifiedPlanning: item.verifiedPlanning,
      unverifiedPlanning: item.unverifiedPlanning,
      requiredAttributes: ["deadline", "quantified_target", "implementation_path", "responsible_entity"],
      ruleVersion: "planning-verification-v1",
    },
    scoreInputs: {
      sentiment: { rawValue: round(sentimentNormalized), normalizedValue: round(sentimentNormalized), normalizationVersion: "sentiment-demo-v1", normalizationScope: "synthetic_demo" },
      sustainability: { rawValue: round(sustainabilityNormalized), normalizedValue: round(sustainabilityNormalized), normalizationVersion: "sustainability-demo-v1", normalizationScope: "synthetic_demo" },
    },
    scoringParameters,
    metrics,
    indexBreakdown: {
      baseEsgsiNormalized: seed.esgsiNormalized,
      actionPenalty: { inputValue: round(1 - item.eass), weight: scoringParameters.lambdaAction, contribution: round(item.actionPenalty) },
      indeterminatePenalty: { inputValue: round(item.ir), weight: scoringParameters.lambdaIndeterminate, contribution: round(item.indeterminatePenalty) },
      planningPenalty: { inputValue: round(item.upr), weight: scoringParameters.lambdaPlanning, contribution: round(item.planningPenalty) },
      evidenceAdjustment: { inputValue: round(seed.coverage / 100), weight: 0.06, contribution: round(0.06 * Math.max(0, 0.7 - seed.coverage / 100)) },
      finalRaw: round(item.finalRaw),
      finalNormalized: round(finalIndex),
      normalizationVersion: "eaa-demo-cohort-minmax-v1",
      normalizationScope: "synthetic_demo",
    },
    riskClassification: {
      baseRisk,
      redFlags,
      redFlagCount: redFlags.length,
      assignedBand: riskBand,
      classificationVersion: versions.threshold,
      reason: redFlags.length ? `基础风险为 ${baseRisk}，并触发 ${redFlags.length} 项红旗。` : `基础风险为 ${baseRisk}，未触发红旗升级。`,
    },
    panelMetadata: {
      sampleGroup,
      includeNGe10: totalStatements >= 10,
      includeNGe20: totalStatements >= 20,
      analysisScope: totalStatements >= 20 ? "Main analysis sample (n_environmental_sentences >= 20)" : "Robustness or completeness sample",
      lowSentenceCountFlag: totalStatements < 20,
      recommendedUse: totalStatements >= 20 ? "用于主分析、风险分类与案例筛选。" : "仅用于稳健性检查或完整性审计。",
      yearsAvailable: 10,
      firstYear: 2016,
      lastYear: 2025,
      duplicateCount: 1,
      selectedForPanel: true,
      selectionNote: "Synthetic canonical company-year record",
      qualityFlags: [],
      reportYearTextCheck: "target_year_found",
      codeSource: "synthetic",
      sourceFile: "synthetic-company-year-v2",
      sourceSheet: "Company_year_panel",
      sourceRow: index + 2,
    },
    versions,
    computedAt: "2026-07-29T11:00:00+08:00",
  };
}

export const companies: CompanyYearRecord[] = prepared.map(createCompany);

const sampleCounts = companies.reduce((counts, company) => {
  counts[company.panelMetadata.sampleGroup] += 1;
  return counts;
}, { main_n_ge_20: 0, robustness_n_10_19: 0, low_n_lt_10: 0 });

export const panelYearSummaries: PanelYearSummary[] = Array.from({ length: 10 }, (_, index) => {
  const year = 2016 + index;
  const duplicateGroups = index % 4 === 0 ? 1 : 0;
  return {
    year,
    sourceFile: `synthetic-company-level-scoring-${year}.xlsx`,
    sourceRows: companies.length + duplicateGroups,
    uniqueCompanyYears: companies.length,
    duplicateGroups,
    extraDuplicateRows: duplicateGroups,
    selectedNLt10: sampleCounts.low_n_lt_10,
    selectedN10To19: sampleCounts.robustness_n_10_19,
    selectedNGe20: sampleCounts.main_n_ge_20,
    titleTargetYearNotFound: index % 5 === 0 ? 1 : 0,
    qualityFlaggedRows: index % 3,
    codeRecoveredFromCompany: index % 6 === 0 ? 1 : 0,
  };
});

const aspectDefinitions: Array<{ text: string; category: EnvironmentalAspectCategory; share: number }> = [
  { text: "温室气体排放与气候目标", category: "emissions_climate", share: .32 },
  { text: "能源与资源利用", category: "energy_resources", share: .24 },
  { text: "废弃物与循环经济", category: "waste_circularity", share: .18 },
  { text: "污染控制", category: "pollution_control", share: .15 },
  { text: "生物多样性与生态保护", category: "biodiversity_ecology", share: .11 },
];

function splitCount(total: number) {
  const values = aspectDefinitions.map((aspect) => Math.floor(total * aspect.share));
  let remaining = total - values.reduce((sum, value) => sum + value, 0);
  for (let index = 0; remaining > 0; index = (index + 1) % values.length) {
    values[index] += 1;
    remaining -= 1;
  }
  return values;
}

export const environmentalAspects: EnvironmentalAspectScore[] = companies.flatMap((company) => {
  const implemented = splitCount(company.environmentalActions.implemented);
  const planning = splitCount(company.environmentalActions.planning);
  const indeterminate = splitCount(company.environmentalActions.indeterminate);
  return aspectDefinitions.map((definition, index) => {
    const frequency = implemented[index] + planning[index] + indeterminate[index];
    return {
      id: `${company.companyId}-aspect-${index + 1}`,
      companyId: company.companyId,
      reportYear: company.reportYear,
      aspectText: definition.text,
      category: definition.category,
      frequency,
      salience: round(frequency / company.environmentalActions.totalStatements),
      implemented: implemented[index],
      planning: planning[index],
      indeterminate: indeterminate[index],
      planningAlpha: company.environmentalActions.planningAlpha,
      actionScore: frequency ? round((implemented[index] + company.environmentalActions.planningAlpha * planning[index]) / frequency) : null,
      evidenceIds: evidenceIdsFor(company.companyId).EASS,
      calculationStatus: "mock",
      formulaVersion: "aspect-action-score-v1",
    };
  });
});

function riskBandFor(value: number): RiskBand {
  return value > .66 ? "high" : value > .33 ? "medium" : "low";
}

export const companyHistory: CompanyMetricHistoryPoint[] = companies.flatMap((company, companyIndex) => {
  return Array.from({ length: 10 }, (_, yearIndex) => {
    const reportYear = 2016 + yearIndex;
    const recency = yearIndex / 9;
    const offset = yearIndex === 9 ? 0 : ((companyIndex % 5) - 2) * .012 + (recency - 1) * .12 + Math.sin((companyIndex + 1) * (yearIndex + 2)) * .025;
    const finalIndex = clamp((company.finalIndex ?? .5) + offset);
    const metrics = Object.fromEntries(company.metrics.map((item) => {
      const normalizedValue = yearIndex === 9 ? item.normalizedValue : item.normalizedValue == null ? null : clamp(item.normalizedValue + offset * (item.code === "EASS" ? -.45 : .7));
      const riskValue = normalizedValue == null ? null : item.code === "EASS" ? 1 - normalizedValue : normalizedValue;
      const rawValue = yearIndex === 9 ? item.rawValue : item.rawValue == null ? null : item.rawValue + offset;
      return [item.code, { rawValue: rawValue == null ? null : round(rawValue), normalizedValue: normalizedValue == null ? null : round(normalizedValue), riskValue: riskValue == null ? null : round(riskValue), calculationStatus: "mock" }];
    })) as CompanyMetricHistoryPoint["metrics"];
    return {
      companyId: company.companyId,
      reportYear,
      finalIndexRaw: yearIndex === 9 ? company.finalIndexRaw : round((company.finalIndexRaw ?? .5) + offset),
      finalIndex: round(finalIndex),
      riskBand: riskBandFor(finalIndex),
      metrics,
      dataVersion: versions.data,
    };
  });
});

export const financialRecords: FinancialYearRecord[] = companies.flatMap((company, companyIndex) => (
  Array.from({ length: 5 }, (_, index) => {
    const reportYear = 2021 + index;
    const growth = 1 + index * .08;
    return {
      id: `${company.companyId}-financial-${reportYear}`,
      companyId: company.companyId,
      stockCode: company.stockCode,
      companyName: company.companyName,
      fiscalPeriodEnd: `${reportYear}-12-31`,
      reportYear,
      reportType: "A",
      sourceType: "synthetic_annual_report",
      assetLiabilityRatio: round(clamp(.34 + (companyIndex % 11) * .035 + index * .006, 0, .92)),
      roaA: round(.018 + (companyIndex % 9) * .006 - index * .0008),
      totalAssets: Math.round((42_000_000_000 + companyIndex * 6_300_000_000) * growth),
      currency: "CNY",
      sourceFields: { assetLiabilityRatio: "F011201A", roaA: "F050201B", totalAssets: "A001000000" },
      qualityFlags: [],
    };
  })
));

const violationTypes = ["信息披露违规", "环境数据口径不一致", "整改披露不充分", "监管要求落实不足"];

export const violationEvents: ViolationEvent[] = companies.flatMap((company, companyIndex) => (
  Array.from({ length: company.eventCount }, (_, eventIndex) => {
    const year = 2025 - (eventIndex % 4);
    const missingPenalty = eventIndex % 3 !== 0;
    return {
      id: `${company.companyId}-violation-${eventIndex + 1}`,
      companyId: company.companyId,
      stockCode: company.stockCode,
      companyName: company.companyName,
      violationYears: eventIndex === 1 ? [year - 1, year] : [year],
      announcementDate: `${year}-${String(3 + eventIndex).padStart(2, "0")}-${String(8 + companyIndex % 17).padStart(2, "0")}`,
      occurrenceDate: `${year}-${String(2 + eventIndex).padStart(2, "0")}-15`,
      violationTypes: [violationTypes[(companyIndex + eventIndex) % violationTypes.length]],
      title: `${company.companyName}监管处理记录（合成）`,
      reason: "披露信息的范围、时间或验证材料需要进一步核验。",
      behavior: "合成记录显示，相关环境或治理披露存在口径说明不充分的情况，尚不能据此形成确定性企业判断。",
      action: eventIndex % 2 === 0 ? "出具监管关注函" : "要求限期整改并补充披露",
      authority: "区域监管观察站（虚构）",
      totalPenalty: missingPenalty ? null : 300_000 + eventIndex * 80_000,
      companyPenalty: missingPenalty ? null : 200_000 + eventIndex * 50_000,
      relation: eventIndex % 2 === 0 ? "公司自身" : "控股子公司",
      subjectName: eventIndex % 2 === 0 ? company.companyName : `${company.companyName}环保运营子公司（合成）`,
      sourceLabel: "监管事件数据集（合成）",
      sourceUrl: `https://source.example.invalid/violation/${company.companyId}/${eventIndex + 1}`,
      reviewStatus: eventIndex === 0 ? company.evidenceStatus : "pending",
      qualityFlags: missingPenalty ? ["penalty_amount_missing"] : [],
    };
  })
));

function createEvidence(company: CompanyYearRecord): EvidenceItem[] {
  const ids = evidenceIdsFor(company.companyId);
  const [uprId] = ids.UPR;
  const [irId] = ids.IR;
  const [metricId] = ids.IMBALANCE;
  const [actionId] = ids.EASS;
  const [indexId] = ids.EAA_ESGSI;
  const externalEvent = violationEvents.find((event) => event.companyId === company.companyId);
  const externalId = company.companyId === "cy-materials" ? "ev-ext-1" : `${company.companyId}-external`;
  const sourceLabel = `${company.reportYear} 可持续发展报告（合成）`;
  return [
    { id: uprId, companyId: company.companyId, reportYear: company.reportYear, type: "claim", metricCode: "UPR", title: company.companyId === "cy-materials" ? "2030 年低碳材料目标缺少验证基础" : `${company.companyName}环境计划缺少验证要素`, excerpt: "报告提出环境改善计划，但当前段落未同时披露基准年、阶段目标、量化 KPI、实施方法和责任主体。", page: 42, sourceLabel, status: company.evidenceStatus },
    { id: irId, companyId: company.companyId, reportYear: company.reportYear, type: "claim", metricCode: "IR", title: "环境声明缺少可核验的量化边界", excerpt: "报告使用持续优化、稳步提升等方向性措辞，但没有提供对应的绝对量、同比口径或完成状态。", page: 45, sourceLabel, status: company.evidenceStatus },
    { id: metricId, companyId: company.companyId, reportYear: company.reportYear, type: "metric", metricCode: "ESGSI", title: "实质环境信息缺少跨年可比数据", excerpt: "报告列出环境改善方向，但没有同时提供核算边界、绝对量和与上一年度可比的量化结果。", page: 47, sourceLabel, status: company.evidenceStatus === "verified" ? "verified" : "pending" },
    { id: actionId, companyId: company.companyId, reportYear: company.reportYear, type: "action", actionClass: "planning", metricCode: "EASS", aspectId: `${company.companyId}-aspect-1`, title: "环境行动仍处于计划阶段", excerpt: "报告描述后续追踪机制，但未提供已经实施的项目结果、预算投入或可核验绩效。", page: 43, sourceLabel, status: company.evidenceStatus === "verified" ? "verified" : "pending" },
    { id: indexId, companyId: company.companyId, reportYear: company.reportYear, type: "verification", metricCode: "EAA_ESGSI", title: "最终指数由 ESGSI 与三项处罚构成", excerpt: "该证据用于回溯 ESGSI、行动不足、模糊声明与未验证计划对最终原始值和归一化结果的影响。", page: 49, sourceLabel, status: company.evidenceStatus },
    { id: externalId, companyId: company.companyId, reportYear: company.reportYear, type: "external", title: externalEvent?.title ?? "外部事件待接入", excerpt: externalEvent?.behavior ?? "当前没有可用的外部事件。", eventDate: externalEvent?.announcementDate, sourceLabel: externalEvent?.sourceLabel ?? "监管事件数据集（合成）", sourceUrl: externalEvent?.sourceUrl, status: externalEvent?.reviewStatus ?? "insufficient" },
  ];
}

export const evidence: EvidenceItem[] = companies.flatMap(createEvidence);
