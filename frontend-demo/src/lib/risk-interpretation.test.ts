import { describe, expect, it } from "vitest";
import { riskInterpretationSchema } from "@/contracts/analysis";
import { companies, companyHistory, evidence } from "@/mocks/fixtures/companies";
import { demoRepository } from "@/repositories/demo-repository";
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
    expect(() => riskInterpretationSchema.parse(result)).not.toThrow();
  });

  it("uses available history and refuses an undersized industry comparison", () => {
    const result = buildRiskInterpretation({ company, cohort: [company], evidence: companyEvidence, history: companyHistory });
    expect(result.history).toMatchObject({ available: true, comparisonYear: 2024 });
    expect(result.industry).toMatchObject({ available: false, sampleSize: 1 });
    expect(result.industry.text).toContain("不生成行业高低判断");
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

  it("returns the same validated contract through the mock repository boundary", async () => {
    const result = await demoRepository.getRiskInterpretation(company.companyId, company.reportYear, "evidence");
    expect(result).toMatchObject({ companyId: company.companyId, reportYear: company.reportYear, focus: "evidence" });
    expect(() => riskInterpretationSchema.parse(result)).not.toThrow();
  });
});
