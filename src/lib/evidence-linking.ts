import type { EvidenceItem, MetricCode } from "@/types";

const maxEvidencePerMetric = 3;

export type MetricEvidenceRelation = "supporting" | "counter" | "context";
export type MetricEvidenceStrength = "strong" | "moderate" | "weak";

export interface MetricEvidenceMatch {
  evidenceId: string;
  relation: MetricEvidenceRelation;
  strength: MetricEvidenceStrength;
  relevance: string;
}

interface MatchOptions {
  excludeInferredIds?: ReadonlySet<string>;
}

/**
 * Links a calculated metric only to persisted evidence that participates in,
 * or directly describes, that metric. The function never creates evidence IDs.
 */
export function evidenceIdsForMetric(
  metricCode: MetricCode,
  evidence: EvidenceItem[],
  explicitIds: string[] = [],
): string[] {
  return evidenceMatchesForMetric(metricCode, evidence, explicitIds).map((item) => item.evidenceId);
}

export function evidenceMatchesForMetric(
  metricCode: MetricCode,
  evidence: EvidenceItem[],
  explicitIds: string[] = [],
  options: MatchOptions = {},
): MetricEvidenceMatch[] {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const explicitSet = new Set(explicitIds);
  const candidates = [...new Map([
    ...explicitIds.map((id) => evidenceById.get(id)).filter((item): item is EvidenceItem => Boolean(item)),
    ...evidence.filter((item) => item.metricCode === metricCode),
    ...evidence.filter((item) => isMetricInput(metricCode, item)),
  ].map((item) => [item.id, item])).values()]
    .flatMap((item) => {
      const exact = item.metricCode === metricCode;
      const explicit = explicitSet.has(item.id);
      if (options.excludeInferredIds?.has(item.id) && !exact && !explicit) return [];
      const relation = relationForMetric(metricCode, item, exact || explicit);
      if (!relation) return [];
      return [{
        item,
        relation: relation.relation,
        relevance: relation.relevance,
        strength: evidenceStrength(item, exact || explicit),
        sourceRank: exact ? 0 : explicit ? 1 : 2,
      }];
    })
    .sort((left, right) => left.sourceRank - right.sourceRank || compareEvidence(left.item, right.item));

  if (metricCode === "EASS") {
    const supporting = candidates.filter((item) => item.relation === "supporting").slice(0, 2);
    const counter = candidates.find((item) => item.relation === "counter");
    return [...supporting, ...(counter ? [counter] : [])].slice(0, maxEvidencePerMetric).map(toMatch);
  }
  return candidates.slice(0, maxEvidencePerMetric).map(toMatch);
}

function isMetricInput(metricCode: MetricCode, evidence: EvidenceItem): boolean {
  if (evidence.type === "external") return false;
  if (metricCode === "EASS") return evidence.actionClass != null && (!evidence.metricCode || evidence.metricCode === "EASS");
  if (metricCode === "IR") return evidence.actionClass === "indeterminate";
  if (metricCode === "UPR") return evidence.actionClass === "planning" && evidence.status === "insufficient";
  return false;
}

function relationForMetric(metricCode: MetricCode, evidence: EvidenceItem, explicitOrExact: boolean): { relation: MetricEvidenceRelation; relevance: string } | null {
  if (evidence.type === "external") return null;
  if (metricCode === "UPR") {
    if (evidence.metricCode === "UPR") return { relation: "supporting", relevance: "该证据被明确标注为未验证计划指标依据。" };
    if (evidence.actionClass === "planning" && evidence.status === "insufficient") return { relation: "supporting", relevance: "该计划缺少完整验证要素，直接支持未验证计划风险判断。" };
    return null;
  }
  if (metricCode === "IR") {
    if (evidence.metricCode === "IR" || evidence.actionClass === "indeterminate") return { relation: "supporting", relevance: "该声明缺少可核验边界或无法判断完成状态，支持模糊声明风险判断。" };
    return null;
  }
  if (metricCode === "EASS") {
    if (evidence.metricCode && evidence.metricCode !== "EASS") return null;
    if (evidence.actionClass === "implemented") return { relation: "counter", relevance: "该证据记录已实施行动，会削弱行动实质不足的风险判断。" };
    if (evidence.actionClass === "planning") return { relation: "supporting", relevance: "该证据仍处于计划阶段，支持行动实质不足的风险判断。" };
    if (evidence.actionClass === "indeterminate") return { relation: "supporting", relevance: "该证据无法确认行动是否实施，支持行动实质不足的风险判断。" };
    if (explicitOrExact) return { relation: "context", relevance: "该证据被明确关联到行动实质性指标，需要结合行动分类进一步核验。" };
    return null;
  }
  if (evidence.metricCode === metricCode) return { relation: "supporting", relevance: `该证据被明确关联到 ${metricCode} 指标。` };
  return null;
}

function evidenceStrength(evidence: EvidenceItem, explicitOrExact: boolean): MetricEvidenceStrength {
  if (explicitOrExact || evidence.status === "verified") return "strong";
  if (evidence.status === "insufficient" || evidence.status === "disputed") return "moderate";
  return "weak";
}

function toMatch(candidate: { item: EvidenceItem; relation: MetricEvidenceRelation; relevance: string; strength: MetricEvidenceStrength }) {
  return {
    evidenceId: candidate.item.id,
    relation: candidate.relation,
    strength: candidate.strength,
    relevance: candidate.relevance,
  };
}

function compareEvidence(left: EvidenceItem, right: EvidenceItem): number {
  const statusPriority = { insufficient: 0, disputed: 1, pending: 2, verified: 3 } as const;
  return statusPriority[left.status] - statusPriority[right.status]
    || (left.page ?? Number.MAX_SAFE_INTEGER) - (right.page ?? Number.MAX_SAFE_INTEGER)
    || left.id.localeCompare(right.id);
}
