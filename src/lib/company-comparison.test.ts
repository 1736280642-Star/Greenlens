import { describe, expect, it } from "vitest";
import { demoRepository } from "@/repositories/demo-repository";
import { deriveActionComposition } from "@/lib/company-comparison";

describe("deriveActionComposition", () => {
  it("uses linked evidence counts when available", async () => {
    const company = (await demoRepository.listCompanies())[0];
    const result = deriveActionComposition(company);

    expect(result.basis).toBe("evidence");
    expect(result.total).toBe(company.environmentalActions.totalStatements);
    expect(result.implemented + result.planning + result.indeterminate).toBeCloseTo(1);
  });

  it("derives proportions from EASS and IR without inventing counts", async () => {
    const company = (await demoRepository.listCompanies())[0];
    const metrics = company.metrics.map((metric) => {
      if (metric.code === "EASS") return { ...metric, rawValue: 0.4 };
      if (metric.code === "IR") return { ...metric, rawValue: 0.6 };
      return metric;
    });
    const result = deriveActionComposition({
      ...company,
      metrics,
      environmentalActions: {
        ...company.environmentalActions,
        implemented: 0,
        planning: 0,
        indeterminate: 0,
        totalStatements: 0,
      },
    });

    expect(result).toMatchObject({
      basis: "model",
      total: null,
      implemented: 0.4,
      planning: 0,
      indeterminate: 0.6,
    });
  });
});
