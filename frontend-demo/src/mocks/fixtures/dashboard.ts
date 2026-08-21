import type { DashboardInsights, DashboardReviewTask, MetricCode } from "@/types";
import { evidenceIdsFor } from "@/mocks/fixtures/companies";

const taskSeeds: Array<[string, string, DashboardReviewTask["reviewType"], MetricCode, string, number, number, number, DashboardReviewTask["evidenceStatus"], number, number]> = [
  ["rv-1048", "cy-materials", "UPR", "UPR", "计划中 72% 缺少基准年、阶段目标或鉴证边界", 94, 46, 88, "insufficient", .72, .60],
  ["rv-1042", "linhai-energy", "EASS", "EASS", "已实施行动占比较低，计划披露多于结果披露", 91, 71, 82, "pending", .42, .50],
  ["rv-1039", "jiuhe-build", "action_classification", "EASS", "行动三分类置信度偏低，需确认计划与已实施边界", 86, 118, 76, "disputed", .51, .50],
  ["rv-1035", "demo-company-08", "risk_band", "ESGSI", "积极环境语言与实质信息之间差距偏高", 83, 63, 81, "pending", .58, .50],
  ["rv-1028", "demo-company-13", "IR", "IR", "模糊环境声明比例超过关注阈值", 79, 92, 84, "insufficient", .46, .33],
  ["rv-1021", "demo-company-19", "risk_band", "EAA_ESI", "行动和计划惩罚推高最终调整指数", 72, 37, 74, "pending", .71, .66],
  ["rv-1016", "qiming-mobility", "UPR", "UPR", "阶段目标已披露，但验证属性仍不完整", 68, 29, 61, "verified", .54, .60],
  ["rv-1009", "beichen-foods", "IR", "IR", "包装减量表述缺少绝对量与同比口径", 64, 146, 91, "insufficient", .39, .33],
];

const reviewTasks: DashboardReviewTask[] = taskSeeds.map(([id, companyId, reviewType, metricCode, reason, impact, ageHours, uncertainty, evidenceStatus, metricValue, threshold]) => ({
  id, companyId, reviewType, metricCode, reason, impact, ageHours, uncertainty, evidenceStatus, metricValue, threshold, evidenceId: evidenceIdsFor(companyId)[metricCode][0],
}));

export const dashboardInsights: DashboardInsights = {
  reviewTasks,
  reviewTrend: [
    { date: "07-18", created: 14, completed: 11, pending: 24 }, { date: "07-19", created: 12, completed: 13, pending: 23 },
    { date: "07-20", created: 18, completed: 12, pending: 29 }, { date: "07-21", created: 15, completed: 17, pending: 27 },
    { date: "07-22", created: 17, completed: 14, pending: 30 }, { date: "07-23", created: 13, completed: 16, pending: 27 },
    { date: "07-24", created: 21, completed: 15, pending: 33 }, { date: "07-25", created: 16, completed: 18, pending: 31 },
    { date: "07-26", created: 12, completed: 15, pending: 28 }, { date: "07-27", created: 17, completed: 17, pending: 28 },
  ],
  modelAgreement: [
    { type: "行动分类", confirm: 62, partial: 17, reject: 13, insufficient: 8 },
    { type: "EASS", confirm: 54, partial: 21, reject: 10, insufficient: 15 },
    { type: "IR", confirm: 71, partial: 12, reject: 8, insufficient: 9 },
    { type: "UPR", confirm: 48, partial: 19, reject: 21, insufficient: 12 },
    { type: "ESGSI", confirm: 51, partial: 18, reject: 17, insufficient: 14 },
    { type: "风险分级", confirm: 57, partial: 11, reject: 9, insufficient: 23 },
  ],
  sourceFreshness: [
    { source: "企业报告", coverage: 96, daysOld: 7, status: "fresh" }, { source: "监管许可", coverage: 84, daysOld: 18, status: "fresh" },
    { source: "外部事件", coverage: 78, daysOld: 31, status: "watch" }, { source: "第三方鉴证", coverage: 61, daysOld: 47, status: "watch" },
    { source: "供应链记录", coverage: 54, daysOld: 83, status: "stale" },
  ],
  evidenceCoverage: [
    { label: "目标时间", coverage: 58 }, { label: "量化 KPI", coverage: 66 }, { label: "实施方法", coverage: 73 },
    { label: "行动路径", coverage: 61 }, { label: "第三方鉴证", coverage: 49 },
  ],
};
