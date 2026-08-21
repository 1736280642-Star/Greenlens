import type { CompanyMetricHistoryPoint, CompanyYearRecord, DashboardCommandCenterData, DashboardRiskNode, GsiScoreRecord, MetricCode, PanelYearSummary, RedFlagCode, RiskBand } from "@/types";
import { getMetric } from "@/types";
import type { CompanyYearQuery } from "@/repositories/analysis-repository";

const redFlagCodes: RedFlagCode[] = ["HIGH_ESGSI", "LOW_EASS", "HIGH_IR", "HIGH_UPR"];
const industryMetricCodes: Array<"ESGSI" | "EASS" | "IR" | "UPR" | "EAA_ESI"> = ["ESGSI", "EASS", "IR", "UPR", "EAA_ESI"];

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function quantile(values: number[], q: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return round(sorted[base + 1] === undefined ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]));
}

function median(values: Array<number | null | undefined>) {
  return quantile(values.filter((value): value is number => value != null), .5);
}

function mean(values: Array<number | null | undefined>) {
  const available = values.filter((value): value is number => value != null);
  return available.length ? round(available.reduce((sum, value) => sum + value, 0) / available.length) : null;
}

function rate(total: number, matches: number) {
  return total ? round(matches / total) : null;
}

function historyMetric(point: CompanyMetricHistoryPoint, code: MetricCode, field: "normalizedValue" | "riskValue" = "normalizedValue") {
  return point.metrics[code]?.[field] ?? null;
}

export const lightNodeLimitPerBand = 15;
export const lightNodeMaxTotal = 60;

function sampleRiskNodes(nodes: DashboardRiskNode[]): DashboardRiskNode[] {
  const order = new Map(nodes.map((node, index) => [node, index]));
  const picked: DashboardRiskNode[] = [];
  for (const band of ["high", "medium", "low", "unavailable"] as RiskBand[]) {
    const bandNodes = nodes.filter((node) => node.riskBand === band).slice(0, lightNodeLimitPerBand);
    for (const node of bandNodes) {
      if (picked.length < lightNodeMaxTotal) picked.push(node);
    }
  }
  return picked
    .slice(0, lightNodeMaxTotal)
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .map((node) => ({ ...node, history: undefined }));
}

export function buildDashboardCommandCenter(
  companyRecords: CompanyYearRecord[],
  historyRecords: CompanyMetricHistoryPoint[],
  qualityRecords: PanelYearSummary[],
  query: CompanyYearQuery = {},
  options: { light?: boolean; gsiRecords?: GsiScoreRecord[] } = {},
): DashboardCommandCenterData {
  const reportYear = query.year ?? Math.max(...companyRecords.map((company) => company.reportYear), 2025);
  const availableReportYears = [...new Set([
    ...companyRecords.map((company) => company.reportYear),
    ...historyRecords.map((point) => point.reportYear),
  ])].filter((year) => year >= 2016).sort((a, b) => b - a);
  const companies = companyRecords.filter((company) =>
    company.reportYear === reportYear
    && (!query.industry || query.industry === "全部行业" || company.industry === query.industry)
    && (!query.riskBand || company.riskBand === query.riskBand)
    && (!query.sampleGroup || company.panelMetadata.sampleGroup === query.sampleGroup),
  );
  const companyIds = new Set(companies.map((company) => company.companyId));
  const gsiRecords = options.gsiRecords ?? [];
  const gsiByCompanyYear = new Map(gsiRecords.map((record) => [`${record.companyId}:${record.reportYear}`, record]));
  const currentGsiRecords = companies.flatMap((company) => {
    const record = gsiByCompanyYear.get(`${company.companyId}:${company.reportYear}`);
    return record ? [record] : [];
  });
  const cohortGsiHistory = gsiRecords.filter((record) => companyIds.has(record.companyId) && record.reportYear <= reportYear);
  const histories = historyRecords.filter((point) => companyIds.has(point.companyId) && point.reportYear <= reportYear);
  const years = [...new Set(histories.map((point) => point.reportYear))].sort((a, b) => a - b);
  const historiesByCompany = new Map<string, CompanyMetricHistoryPoint[]>();
  const historiesByYear = new Map<number, CompanyMetricHistoryPoint[]>();
  for (const point of histories) {
    const current = historiesByCompany.get(point.companyId) ?? [];
    current.push(point);
    historiesByCompany.set(point.companyId, current);
    const annual = historiesByYear.get(point.reportYear) ?? [];
    annual.push(point);
    historiesByYear.set(point.reportYear, annual);
  }
  for (const points of historiesByCompany.values()) points.sort((a, b) => a.reportYear - b.reportYear);

  const triadDefinitions = [
    {
      code: "RHETORIC_CONTENT" as const,
      label: "修辞—内容差异",
      description: "积极语气与实质环境内容的差距",
      currentValue: (company: CompanyYearRecord) => getMetric(company, "ESGSI")?.normalizedValue ?? null,
      currentRisk: (company: CompanyYearRecord) => getMetric(company, "ESGSI")?.riskValue ?? null,
      historyValue: (point: CompanyMetricHistoryPoint) => historyMetric(point, "ESGSI"),
    },
    {
      code: "ACTION_SUBSTANCE" as const,
      label: "行动实质",
      description: "环境披露获得已实施行动支撑的程度",
      currentValue: (company: CompanyYearRecord) => getMetric(company, "EASS")?.normalizedValue ?? null,
      currentRisk: (company: CompanyYearRecord) => getMetric(company, "EASS")?.riskValue ?? null,
      historyValue: (point: CompanyMetricHistoryPoint) => historyMetric(point, "EASS"),
    },
    {
      code: "AMBIGUITY_VERIFICATION" as const,
      label: "模糊与未验证",
      description: "模糊声明与缺少验证要素的计划",
      currentValue: (company: CompanyYearRecord) => {
        const ir = getMetric(company, "IR")?.normalizedValue;
        const upr = getMetric(company, "UPR")?.normalizedValue;
        return ir == null || upr == null ? null : round((ir + upr) / 2);
      },
      currentRisk: (company: CompanyYearRecord) => {
        const ir = getMetric(company, "IR")?.riskValue;
        const upr = getMetric(company, "UPR")?.riskValue;
        return ir == null || upr == null ? null : round((ir + upr) / 2);
      },
      historyValue: (point: CompanyMetricHistoryPoint) => {
        const ir = historyMetric(point, "IR");
        const upr = historyMetric(point, "UPR");
        return ir == null || upr == null ? null : round((ir + upr) / 2);
      },
    },
  ];

  const metricTriad = triadDefinitions.map((definition) => {
    const values = companies.map(definition.currentValue).filter((value): value is number => value != null);
    const risks = companies.map(definition.currentRisk).filter((value): value is number => value != null);
    return {
      code: definition.code,
      label: definition.label,
      description: definition.description,
      medianValue: quantile(values, .5),
      attentionRate: rate(risks.length, risks.filter((value) => value >= .5).length),
      sampleCount: values.length,
      q1: quantile(values, .25),
      q3: quantile(values, .75),
      history: years.map((year) => ({
        year,
        value: median((historiesByYear.get(year) ?? []).map(definition.historyValue)),
      })),
    };
  });

  const riskNodes = companies.map((company) => {
    const companyHistory = historiesByCompany.get(company.companyId) ?? [];
    const latestThree = companyHistory.filter((point) => point.reportYear >= reportYear - 2).slice(-3);
    const persistentHighRiskYears = latestThree.filter((point) => point.riskBand === "high").length;
    const gsi = gsiByCompanyYear.get(`${company.companyId}:${company.reportYear}`);
    return {
      companyId: company.companyId,
      companyName: company.companyName,
      stockCode: company.stockCode,
      industry: company.industry,
      reportYear: company.reportYear,
      eass: getMetric(company, "EASS")?.normalizedValue ?? null,
      finalIndex: company.finalIndex,
      riskBand: company.riskBand,
      environmentalSentenceCount: company.textProcessing.environmentalSentenceCount,
      evidenceCoverage: company.evidenceCoverage,
      redFlags: company.riskClassification.redFlags,
      metricRiskValues: {
        ESGSI: getMetric(company, "ESGSI")?.riskValue ?? null,
        EASS: getMetric(company, "EASS")?.riskValue ?? null,
        IR: getMetric(company, "IR")?.riskValue ?? null,
        UPR: getMetric(company, "UPR")?.riskValue ?? null,
        EAA_ESI: company.finalIndex,
      },
      gsi: gsi ? {
        gsiFinal: gsi.gsiFinal,
        gwScore: gsi.gwScore,
        coveragePenalty: gsi.coveragePenalty,
        imbalance: gsi.imbalance,
        eFocus: gsi.eFocus,
        sFocus: gsi.sFocus,
        gFocus: gsi.gFocus,
        duplicateCount: gsi.duplicateCount,
        qualityFlags: gsi.qualityFlags,
      } : null,
      persistentHighRiskYears,
      indexBreakdown: company.indexBreakdown,
      history: latestThree.map((point) => ({ year: point.reportYear, finalIndex: point.finalIndex, riskBand: point.riskBand })),
    };
  });

  const allPersistentRisks = riskNodes
    .filter((node) => node.persistentHighRiskYears >= Math.min(3, node.history.length) && node.history.length > 0)
    .map((node) => {
      const company = companies.find((item) => item.companyId === node.companyId)!;
      return { ...node, evidenceStatus: company.evidenceStatus, reviewStatus: company.reviewStatus };
    })
    .sort((a, b) => b.persistentHighRiskYears - a.persistentHighRiskYears || (b.finalIndex ?? -1) - (a.finalIndex ?? -1) || b.redFlags.length - a.redFlags.length);
  const persistentRisks = allPersistentRisks.slice(0, 8);

  const annualTrend = years.map((year) => {
    const points = historiesByYear.get(year) ?? [];
    const finalValues = points.map((point) => point.finalIndex).filter((value): value is number => value != null);
    return {
      year,
      medianFinalIndex: median(finalValues),
      meanFinalIndex: mean(finalValues),
      q1FinalIndex: quantile(finalValues, .25),
      q3FinalIndex: quantile(finalValues, .75),
      highRiskRate: rate(points.length, points.filter((point) => point.riskBand === "high").length),
      medianEass: median(points.map((point) => historyMetric(point, "EASS"))),
      sampleCount: points.length,
    };
  });

  const gsiMetricDefinitions = [
    { code: "GSI" as const, label: "GSI", description: "基于 ESG 报告词典覆盖、披露结构与漂绿语言形成的稳健性风险指数。", value: (record: GsiScoreRecord) => record.gsiFinal },
    { code: "COVERAGE_PENALTY" as const, label: "覆盖不足", description: "E/S/G 主题覆盖不足产生的模型惩罚，仅作为数据与披露完整性信号。", value: (record: GsiScoreRecord) => record.coveragePenalty },
    { code: "IMBALANCE" as const, label: "披露失衡", description: "E/S/G 三个维度关注度不均衡程度，用于解释 GSI 的结构性来源。", value: (record: GsiScoreRecord) => record.imbalance },
  ];
  const gsiYears = [...new Set(cohortGsiHistory.map((record) => record.reportYear))].sort((a, b) => a - b);
  const gsiMetrics = gsiMetricDefinitions.map((definition) => {
    const values = currentGsiRecords.map(definition.value);
    return {
      code: definition.code,
      label: definition.label,
      description: definition.description,
      medianValue: median(values),
      meanValue: mean(values),
      sampleCount: values.length,
      q1: quantile(values, .25),
      q3: quantile(values, .75),
      history: gsiYears.map((year) => {
        const annualValues = cohortGsiHistory.filter((record) => record.reportYear === year).map(definition.value);
        return {
          year,
          medianValue: median(annualValues),
          meanValue: mean(annualValues),
          q1: quantile(annualValues, .25),
          q3: quantile(annualValues, .75),
          sampleCount: annualValues.length,
        };
      }),
    };
  });

  const currentCompanyById = new Map(companies.map((company) => [company.companyId, company]));
  const historyTriggers = (point: CompanyMetricHistoryPoint, code: "ESGSI" | "EASS" | "IR" | "UPR") => {
    const value = historyMetric(point, code);
    if (value == null) return false;
    const threshold = getMetric(currentCompanyById.get(point.companyId)!, code)?.threshold ?? .5;
    return code === "EASS" ? value <= threshold : value >= threshold;
  };
  const redFlagTrend = years.map((year) => {
    const records = historiesByYear.get(year) ?? [];
    return {
      year,
      highEsgsiRate: rate(records.length, records.filter((record) => historyTriggers(record, "ESGSI")).length),
      lowEassRate: rate(records.length, records.filter((record) => historyTriggers(record, "EASS")).length),
      ambiguityVerificationRate: rate(records.length, records.filter((record) => historyTriggers(record, "IR") || historyTriggers(record, "UPR")).length),
      sampleCount: records.length,
    };
  });

  const industryRisk = [...new Set(companies.map((company) => company.industry))].sort().flatMap((industry) => {
    const group = companies.filter((company) => company.industry === industry);
    return industryMetricCodes.map((metricCode) => {
      const values = group.map((company) => metricCode === "EAA_ESI" ? company.finalIndex : getMetric(company, metricCode)?.riskValue)
        .filter((value): value is number => value != null);
      return {
        industry,
        metricCode,
        sampleCount: values.length,
        medianRiskValue: quantile(values, .5),
        q1: quantile(values, .25),
        q3: quantile(values, .75),
      };
    });
  });

  const currentQuality = qualityRecords.find((item) => item.year === reportYear);
  const qualityAlertCount = currentQuality
    ? currentQuality.duplicateGroups + currentQuality.titleTargetYearNotFound + currentQuality.qualityFlaggedRows + currentQuality.codeRecoveredFromCompany
    : 0;

  const medianBreakdown = {
    baseEsgsi: median(companies.map((company) => company.indexBreakdown.baseEsgsiNormalized)),
    actionPenalty: median(companies.map((company) => company.indexBreakdown.actionPenalty.contribution)),
    indeterminatePenalty: median(companies.map((company) => company.indexBreakdown.indeterminatePenalty.contribution)),
    planningPenalty: median(companies.map((company) => company.indexBreakdown.planningPenalty.contribution)),
    evidenceAdjustment: median(companies.map((company) => company.indexBreakdown.evidenceAdjustment.contribution)),
    final: median(companies.map((company) => company.finalIndex)),
  };
  const evidenceLinkageStatus = (company: CompanyYearRecord) => company.evidenceLinkageStatus
    ?? (company.evidenceCoverage <= 0 ? "unlinked" : company.evidenceCoverage < 70 ? "low_coverage" : "linked");
  const unlinkedEvidenceCount = companies.filter((company) => evidenceLinkageStatus(company) === "unlinked").length;
  const evidenceParseFailedCount = companies.filter((company) => evidenceLinkageStatus(company) === "parse_failed").length;
  const lowEvidenceCoverageCount = companies.filter((company) => evidenceLinkageStatus(company) === "low_coverage").length;
  const sampledRiskNodes = options.light === true ? sampleRiskNodes(riskNodes) : riskNodes;

  return {
    scope: {
      reportYear,
      availableReportYears: availableReportYears.length ? availableReportYears : [reportYear],
      industry: query.industry && query.industry !== "全部行业" ? query.industry : undefined,
      sampleGroup: query.sampleGroup,
      dataVersion: companies[0]?.versions.data ?? "SYN-2026.08",
      computedAt: companies.map((company) => company.computedAt).sort().at(-1) ?? "2026-07-29T11:00:00+08:00",
    },
    kpis: {
      sampleCount: companies.length,
      highRiskCount: companies.filter((company) => company.riskBand === "high").length,
      persistentHighRiskCount: allPersistentRisks.length,
      medianFinalIndex: median(companies.map((company) => company.finalIndex)),
      insufficientEvidenceCount: companies.filter((company) => company.evidenceStatus === "insufficient" || company.evidenceCoverage < 70).length,
      unlinkedEvidenceCount,
      evidenceParseFailedCount,
      lowEvidenceCoverageCount,
      qualityAlertCount,
    },
    metricTriad,
    gsiRobustness: {
      available: currentGsiRecords.length > 0,
      matchedCompanyCount: currentGsiRecords.length,
      duplicateGroupCount: currentGsiRecords.filter((record) => record.duplicateCount > 1).length,
      dataVersion: currentGsiRecords[0]?.dataVersion ?? null,
      metrics: gsiMetrics,
    },
    redFlagTrend,
    riskNodes: sampledRiskNodes,
    persistentRisks,
    annualTrend,
    industryRisk,
    redFlagDistribution: redFlagCodes.map((code) => ({ code, count: companies.filter((company) => company.riskClassification.redFlags.includes(code)).length })),
    quality: qualityRecords.filter((item) => item.year <= reportYear).sort((a, b) => a.year - b.year),
    medianBreakdown,
  };
}
