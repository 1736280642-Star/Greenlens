import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { companies, companyHistory, evidence } from "@/mocks/fixtures/companies";
import { generateRiskInterpretationWithProvider } from "@/server/ai/provider";
import { GET } from "./route";

vi.mock("@/server/analysis/live-analysis", () => ({
  liveCompanyRecords: () => companies,
  liveEvidence: (companyId: string, reportYear: number) => evidence.filter((item) => item.companyId === companyId && item.reportYear === reportYear),
  liveGsiScore: () => null,
  liveHistories: () => companyHistory,
}));

vi.mock("@/server/ai/provider", () => ({
  generateRiskInterpretationWithProvider: vi.fn(),
}));

const company = companies.find((item) => item.companyId === "cy-materials")!;
const provider = vi.mocked(generateRiskInterpretationWithProvider);

function request() {
  return new NextRequest(`http://localhost/api/v1/company-years/${company.companyId}/interpretation?reportYear=${company.reportYear}&focus=overview`);
}

describe("provider-only risk interpretation route", () => {
  beforeEach(() => provider.mockReset());

  it("returns an interpretation only when the Provider generated it", async () => {
    provider.mockImplementation(async (draft) => ({
      interpretation: { ...draft, headline: "真实 Provider 生成的风险解读" },
      status: "generated",
      provider: "deepseek",
      model: "deepseek-v4-flash",
    }));

    const response = await GET(request(), { params: Promise.resolve({ id: company.companyId }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("X-GreenLens-AI-Status")).toBe("generated");
    expect(payload.headline).toBe("真实 Provider 生成的风险解读");
  });

  it("rejects deterministic output when the Provider is disabled", async () => {
    provider.mockImplementation(async (draft) => ({
      interpretation: draft,
      status: "disabled",
      reason: "not_enabled",
    }));

    const response = await GET(request(), { params: Promise.resolve({ id: company.companyId }) });
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("X-GreenLens-AI-Status")).toBe("disabled");
    expect(payload.cause).toContain("尚未启用");
  });

  it("rejects deterministic fallback when Provider output is invalid", async () => {
    provider.mockImplementation(async (draft) => ({
      interpretation: draft,
      status: "fallback",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      reason: "invalid_response",
    }));

    const response = await GET(request(), { params: Promise.resolve({ id: company.companyId }) });
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("X-GreenLens-AI-Status")).toBe("fallback");
    expect(payload.impact).toContain("不会使用本地规则结果");
  });
});
