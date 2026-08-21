import type {
  DashboardInsights,
  DashboardReviewTask,
  EvidenceItem,
  MetricCode,
  ReviewRecord,
  ReviewTrendPoint,
} from "@/types";
import { liveCompanyRecords, liveDataRevision } from "./live-analysis";
import { isMockDataMode, mockDashboardInsights } from "./mock-server-data";
import { netdiskSnapshot } from "@/server/netdisk/local-netdisk";
import {
  allPersistedEvidenceItems,
  aspectEvidenceCoverage,
  listReviewRecords,
  runtimeDataCounts,
} from "@/server/netdisk/sqlite-store";

const aspectLabels: Record<string, string> = {
  emissions_climate: "排放与气候",
  energy_resources: "能源与资源",
  waste_circularity: "废弃物与循环",
  pollution_control: "污染治理",
  biodiversity_ecology: "生物多样性与生态",
};

const taskReasonByFlag: Record<string, { reviewType: DashboardReviewTask["reviewType"]; metricCode: MetricCode; reason: string }> = {
  HIGH_UPR: { reviewType: "UPR", metricCode: "UPR", reason: "未验证计划比例超过关注阈值，计划缺少基准年、阶段目标或验证属性。" },
  HIGH_IR: { reviewType: "IR", metricCode: "IR", reason: "模糊环境声明比例超过关注阈值，缺少可核验的量化边界。" },
  LOW_EASS: { reviewType: "EASS", metricCode: "EASS", reason: "已实施行动占比较低，计划披露多于结果披露。" },
  HIGH_ESGSI: { reviewType: "risk_band", metricCode: "ESGSI", reason: "积极环境语言与实质信息之间差距偏高。" },
};

function pickEvidence(items: EvidenceItem[], predicate: (item: EvidenceItem) => boolean) {
  return items.find(predicate) ?? items[0];
}

function buildReviewTasks(): DashboardReviewTask[] {
  const records = liveCompanyRecords();
  const itemsByKey = new Map<string, EvidenceItem[]>();
  for (const item of allPersistedEvidenceItems()) {
    const key = `${item.companyId}:${item.reportYear}`;
    const group = itemsByKey.get(key) ?? [];
    group.push(item);
    itemsByKey.set(key, group);
  }
  const tasks: DashboardReviewTask[] = [];
  const now = Date.now();
  for (const record of records) {
    const items = itemsByKey.get(`${record.companyId}:${record.reportYear}`) ?? [];
    if (!items.length) continue;
    const uncertainty = Math.max(20, Math.min(95, 100 - record.evidenceCoverage));
    const ageHours = Math.max(0, Math.floor((now - Date.parse(record.computedAt)) / 3_600_000));
    const metricOf = (code: MetricCode) => record.metrics.find((metric) => metric.code === code);
    const flagTasks = record.riskClassification.redFlags.flatMap((flag) => {
      const seed = taskReasonByFlag[flag];
      if (!seed) return [];
      const metric = metricOf(seed.metricCode);
      const metricValue = metric?.riskValue ?? metric?.normalizedValue;
      if (metricValue == null) return [];
      const item = seed.metricCode === "UPR"
        ? pickEvidence(items, (entry) => entry.actionClass === "planning" && entry.status === "insufficient")
        : seed.metricCode === "IR"
          ? pickEvidence(items, (entry) => entry.actionClass === "indeterminate")
          : seed.metricCode === "EASS"
            ? pickEvidence(items, (entry) => entry.actionClass === "implemented")
            : pickEvidence(items, (entry) => entry.type === "claim");
      return [{
        id: `rt-${record.companyId}-${record.reportYear}-${seed.metricCode}`,
        companyId: record.companyId,
        reviewType: seed.reviewType,
        metricCode: seed.metricCode,
        reason: seed.reason,
        impact: Math.round(metricValue * 100),
        ageHours,
        uncertainty,
        evidenceStatus: item.status,
        metricValue,
        threshold: metric?.threshold ?? 0.5,
        evidenceId: item.id,
      } satisfies DashboardReviewTask];
    });
    tasks.push(...flagTasks);

    const classified = pickEvidence(items, (entry) => entry.actionClass != null);
    if (classified && flagTasks.length < 4) {
      const eass = metricOf("EASS");
      const metricValue = eass?.riskValue ?? eass?.normalizedValue ?? 0.5;
      tasks.push({
        id: `rt-${record.companyId}-${record.reportYear}-action-classification`,
        companyId: record.companyId,
        reviewType: "action_classification",
        metricCode: "EASS",
        reason: "行动三分类置信度偏低，需确认计划与已实施边界。",
        impact: Math.round(metricValue * 100),
        ageHours,
        uncertainty,
        evidenceStatus: classified.status,
        metricValue,
        threshold: eass?.threshold ?? 0.5,
        evidenceId: classified.id,
      });
    }

    if (record.riskBand === "high" && record.finalIndex != null) {
      const item = pickEvidence(items, (entry) => entry.type === "claim");
      tasks.push({
        id: `rt-${record.companyId}-${record.reportYear}-final-risk`,
        companyId: record.companyId,
        reviewType: "risk_band",
        metricCode: "EAA_ESI",
        reason: "行动和计划惩罚推高最终调整指数。",
        impact: Math.round(record.finalIndex * 100),
        ageHours,
        uncertainty,
        evidenceStatus: item.status,
        metricValue: record.finalIndex,
        threshold: 0.5,
        evidenceId: item.id,
      });
    }
  }
  return tasks
    .sort((a, b) => b.impact - a.impact || b.uncertainty - a.uncertainty)
    .slice(0, 200);
}

function localDateKey(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateKeyOf(iso?: string) {
  return iso ? localDateKey(new Date(iso)) : null;
}

function buildReviewTrend(reviews: ReviewRecord[], pendingCount: number): ReviewTrendPoint[] {
  const days = Array.from({ length: 10 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (9 - index));
    return date;
  });
  return days.map((date) => {
    const key = localDateKey(date);
    const created = reviews.filter((review) => dateKeyOf(review.reviewedAt) === key).length;
    const completed = reviews.filter((review) => review.humanDecision && dateKeyOf(review.reviewedAt) === key).length;
    const completedUpTo = reviews.filter((review) => {
      const reviewKey = dateKeyOf(review.reviewedAt);
      return reviewKey != null && reviewKey <= key && review.humanDecision;
    }).length;
    const pending = Math.max(0, pendingCount - completedUpTo);
    return { date: key, created, completed, pending };
  });
}

const agreementRows: Array<{ type: string; targetType: ReviewRecord["targetType"]; metric?: string }> = [
  { type: "行动分类", targetType: "action_classification" },
  { type: "EASS", targetType: "metric", metric: "eass" },
  { type: "IR", targetType: "metric", metric: "ir" },
  { type: "UPR", targetType: "metric", metric: "upr" },
  { type: "ESGSI", targetType: "metric", metric: "esgsi" },
  { type: "风险分级", targetType: "risk_label" },
];

function buildModelAgreement(reviews: ReviewRecord[]) {
  return agreementRows.map((row) => {
    const scoped = reviews.filter((review) => {
      if (review.targetType !== row.targetType) return false;
      if (!row.metric) return true;
      return review.reasonCode?.toLowerCase().includes(row.metric) ?? false;
    });
    const total = scoped.length;
    const count = (decision: ReviewRecord["humanDecision"]) => scoped.filter((review) => review.humanDecision === decision).length;
    if (!total) return { type: row.type, confirm: 0, partial: 0, reject: 0, insufficient: 0 };
    const round = (value: number) => Math.round((value / total) * 100);
    return {
      type: row.type,
      confirm: round(count("confirm")),
      partial: round(count("partial")),
      reject: round(count("reject")),
      insufficient: round(count("insufficient")),
    };
  });
}

function buildSourceFreshness() {
  const groups: Array<{ kind: string; label: string }> = [
    { kind: "esg_report", label: "企业报告" },
    { kind: "financial_workbook", label: "财务数据" },
    { kind: "violation_workbook", label: "违规事件" },
    { kind: "company_score_workbook", label: "EAA 评分" },
    { kind: "company_industry_workbook", label: "行业分类" },
    { kind: "esg_rating_workbook", label: "外部评级" },
  ];
  const files = netdiskSnapshot().files;
  const rows = groups.flatMap((group) => {
    const groupFiles = files.filter((file) => file.kind === group.kind);
    if (!groupFiles.length) return [];
    const ready = groupFiles.filter((file) => file.parseStatus === "ready").length;
    const coverage = Math.round((ready / groupFiles.length) * 100);
    const timestamps = groupFiles.map((file) => file.modifiedAt ?? file.discoveredAt).filter(Boolean).sort();
    const latest = timestamps.at(-1);
    const daysOld = latest ? Math.max(0, Math.floor((Date.now() - Date.parse(latest)) / 86_400_000)) : 0;
    return [{
      source: group.label,
      coverage,
      daysOld,
      status: daysOld <= 30 ? "fresh" as const : daysOld <= 60 ? "watch" as const : "stale" as const,
    }];
  });
  return rows.length ? rows : [{ source: "数据源未配置", coverage: 0, daysOld: 0, status: "stale" as const }];
}

function buildEvidenceCoverage() {
  const rows = aspectEvidenceCoverage();
  if (!rows.length) {
    return [{ label: "证据总体", coverage: 0 }];
  }
  return rows.map((row) => ({
    label: row.category === "overall" ? "证据总体" : aspectLabels[row.category] ?? row.category,
    coverage: row.total ? Math.round((row.covered / row.total) * 100) : 0,
  }));
}

const insightsCache = globalThis as typeof globalThis & { __greenlensDashboardInsights?: { revision: string; insights: DashboardInsights } };

export function liveDashboardInsights(): DashboardInsights {
  if (isMockDataMode()) return mockDashboardInsights();
  const revision = `${liveDataRevision()}:reviews:${runtimeDataCounts().reviews}`;
  const cached = insightsCache.__greenlensDashboardInsights;
  if (cached?.revision === revision) return cached.insights;
  const reviewTasks = buildReviewTasks();
  const reviews = listReviewRecords();
  const insights: DashboardInsights = {
    reviewTasks,
    reviewTrend: buildReviewTrend(reviews, reviewTasks.length),
    modelAgreement: buildModelAgreement(reviews),
    sourceFreshness: buildSourceFreshness(),
    evidenceCoverage: buildEvidenceCoverage(),
  };
  insightsCache.__greenlensDashboardInsights = { revision, insights };
  return insights;
}
