import { describe, expect, it } from "vitest";
import { riskInterpretationSchema } from "@/contracts/analysis";
import { companies, companyHistory, evidence } from "@/mocks/fixtures/companies";
import { demoRepository } from "@/repositories/demo-repository";
import type { GsiScoreRecord } from "@/types";
import { buildRiskInterpretation } from "./risk-interpretation";

const company = companies.find((item) => item.companyId === "cy-materials")!;
const companyEvidence = evidence.filter((item) => item.companyId === company.companyId && item.reportYear === company.reportYear);

describe("risk interpretation", () => {
  it("orders drivers by risk direction and cites only linked evidence", () => {
    const result = buildRiskInterpretation({ company, cohort: companies, evidence: companyEvidence, history: companyHistory });
    const values = result.drivers.map((driver) => driver.riskValue ?? -1);
    expect(values).toEqual([...values].sort((left, right) => right - left));
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations.every((citation) => companyEvidence.some((item) => item.id === citation.evidenceId))).toBe(true);
    expect(result.drivers.flatMap((driver) => driver.citationIds).every((id) => result.citations.some((citation) => citation.id === id))).toBe(true);
    const uprIds = new Set(result.drivers.find((driver) => driver.metricCode === "UPR")?.citationIds);
    const eassIds = result.drivers.find((driver) => driver.metricCode === "EASS")?.citationIds ?? [];
    expect(eassIds.every((id) => !uprIds.has(id))).toBe(true);
    expect(result.drivers.every((driver) => driver.evidenceRelations.every((relation) => driver.citationIds.includes(relation.citationId)))).toBe(true);
    expect(() => riskInterpretationSchema.parse(result)).not.toThrow();
  });

  it("uses available history and refuses an undersized industry comparison", () => {
    const result = buildRiskInterpretation({ company, cohort: [company], evidence: companyEvidence, history: companyHistory });
    expect(result.history).toMatchObject({ available: true, comparisonYear: 2024 });
    expect(result.industry).toMatchObject({ available: false, sampleSize: 1 });
    expect(result.industry.text).toContain("不生成行业高低判断");
  });

  it("adds the matched GSI record as a separate robustness view", () => {
    const gsi: GsiScoreRecord = {
      id: "gsi-test", companyId: company.companyId, stockCode: company.stockCode, companyName: company.companyName,
      reportYear: company.reportYear, totalWords: 10_000, eCount: 120, sCount: 80, gCount: 60,
      eFocus: .46, sFocus: .31, gFocus: .23, imbalance: .23, gwScore: .61, coveragePenalty: .08, gsiFinal: .69,
      duplicateCount: 1, qualityFlags: [], calculationStatus: "calculated", modelVersion: "gsi-test-v1", dataVersion: "gsi-test-data",
      sourceFile: "test.csv", sourceRow: 2, importedAt: "2025-01-01T00:00:00.000Z",
    };
    const result = buildRiskInterpretation({ company, cohort: [company], evidence: companyEvidence, history: companyHistory, gsi });
    expect(result.robustness).toMatchObject({ coverage: "three_views", gsi: { gsiFinal: .69 }, redFlags: { count: company.riskClassification.redFlagCount } });
    expect(result.researchBrief.modelAgreement).toContain("GSI");
  });

  it("degrades explicitly when parsing and linkage are unavailable", () => {
    const unavailable = {
      ...company,
      finalIndex: null,
      riskBand: "unavailable" as const,
      evidenceCoverage: 0,
      evidenceLinkageStatus: "parse_failed" as const,
      metrics: company.metrics.map((metric) => ({ ...metric, riskValue: null, calculationStatus: "unavailable" as const, evidenceIds: [] })),
    };
    const result = buildRiskInterpretation({ company: unavailable, cohort: [unavailable], evidence: [], history: [] });
    expect(result.citations).toEqual([]);
    expect(result.uncertainty.level).toBe("unavailable");
    expect(result.evidenceGaps.join(" ")).toContain("解析失败");
    expect(result.summary).toContain("不补造风险结论");
  });

  it("links persisted action evidence when live metrics have no explicit evidence IDs", () => {
    const liveEvidence = companyEvidence
      .filter((item) => item.type !== "external")
      .map((item) => ({ ...item, metricCode: undefined }));
    const liveCompany = {
      ...company,
      metrics: company.metrics.map((metric) => ({ ...metric, evidenceIds: [] })),
    };

    const result = buildRiskInterpretation({ company: liveCompany, cohort: [liveCompany], evidence: liveEvidence, history: [] });
    const actionDrivers = result.drivers.filter((driver) => ["EASS", "IR", "UPR"].includes(driver.metricCode));

    expect(actionDrivers.some((driver) => driver.citationIds.length > 0)).toBe(true);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations.every((citation) => liveEvidence.some((item) => item.id === citation.evidenceId))).toBe(true);
    expect(result.drivers.every((driver) => driver.citationIds.length <= 3)).toBe(true);
  });

  it("returns the same validated contract through the mock repository boundary", async () => {
    const result = await demoRepository.getRiskInterpretation(company.companyId, company.reportYear, "evidence");
    expect(result).toMatchObject({ companyId: company.companyId, reportYear: company.reportYear, focus: "evidence" });
    expect(() => riskInterpretationSchema.parse(result)).not.toThrow();
  });
});
