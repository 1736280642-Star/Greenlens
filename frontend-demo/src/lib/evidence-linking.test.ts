import { describe, expect, it } from "vitest";
import type { EvidenceItem } from "@/types";
import { evidenceMatchesForMetric } from "./evidence-linking";

const base = { companyId: "company-1", reportYear: 2025, sourceLabel: "2025 ESG report" };
const evidence: EvidenceItem[] = [
  { ...base, id: "plan-unverified", type: "claim", actionClass: "planning", title: "目标缺少验证要素", excerpt: "计划降低排放。", status: "insufficient" },
  { ...base, id: "plan-verified", type: "claim", actionClass: "planning", title: "目标要素完整", excerpt: "计划在 2030 年降低排放 30%。", status: "pending" },
  { ...base, id: "implemented", type: "action", actionClass: "implemented", title: "项目已实施", excerpt: "项目已经投产。", status: "verified" },
  { ...base, id: "indeterminate", type: "claim", actionClass: "indeterminate", title: "持续提升", excerpt: "持续提升环境表现。", status: "pending" },
  { ...base, id: "upr-explicit", type: "claim", metricCode: "UPR", title: "明确 UPR 证据", excerpt: "目标缺少基准年。", status: "pending" },
];

describe("metric evidence matching", () => {
  it("links UPR only to unverified planning or explicit UPR evidence", () => {
    const matches = evidenceMatchesForMetric("UPR", evidence, ["upr-explicit"]);
    expect(matches.map((item) => item.evidenceId)).toEqual(["upr-explicit", "plan-unverified"]);
    expect(matches.every((item) => item.relation === "supporting")).toBe(true);
    expect(matches.some((item) => item.evidenceId === "plan-verified")).toBe(false);
  });

  it("keeps EASS evidence independent from evidence reserved by specific metrics", () => {
    const reserved = new Set(["plan-unverified", "indeterminate"]);
    const matches = evidenceMatchesForMetric("EASS", evidence, [], { excludeInferredIds: reserved });
    expect(matches.map((item) => item.evidenceId)).toEqual(["plan-verified", "implemented"]);
    expect(matches.find((item) => item.evidenceId === "implemented")?.relation).toBe("counter");
    expect(matches.some((item) => reserved.has(item.evidenceId))).toBe(false);
  });

  it("marks indeterminate statements as direct IR support", () => {
    expect(evidenceMatchesForMetric("IR", evidence)).toEqual([
      expect.objectContaining({ evidenceId: "indeterminate", relation: "supporting" }),
    ]);
  });
});
