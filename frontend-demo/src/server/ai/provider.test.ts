import { describe, expect, it, vi } from "vitest";
import { companies, companyHistory, evidence } from "@/mocks/fixtures/companies";
import { buildRiskInterpretation } from "@/lib/risk-interpretation";
import { generateRiskInterpretationWithProvider } from "./provider";

const company = companies.find((item) => item.companyId === "cy-materials")!;
const draft = buildRiskInterpretation({
  company,
  cohort: companies,
  evidence: evidence.filter((item) => item.companyId === company.companyId && item.reportYear === company.reportYear),
  history: companyHistory,
});

const enabledEnvironment = {
  GREENLENS_AI_ENABLED: "true",
  GREENLENS_AI_PROVIDER: "openai-compatible",
  GREENLENS_AI_BASE_URL: "https://provider.example/v1",
  GREENLENS_AI_MODEL: "research-model",
  GREENLENS_AI_API_KEY: "test-key-not-a-secret",
};

const deepSeekEnvironment = {
  GREENLENS_AI_ENABLED: "true",
  GREENLENS_AI_PROVIDER: "deepseek",
  GREENLENS_AI_API_KEY: "test-key-not-a-secret",
};

function narrative(overrides: Record<string, unknown> = {}) {
  return {
    headline: "基于现有指标和证据形成的研究信号",
    summary: "当前结果用于研究筛查，仍需结合引用证据与不确定性判断。",
    researchBrief: {
      finding: "综合风险信号需要优先复核。",
      evidenceAssessment: "现有证据可定位，但仍存在反证材料缺口。",
      modelAgreement: "主模型与 Red Flag 视角可用，GSI 暂缺。",
      priorityAction: "优先核验排名第一的风险来源。",
    },
    drivers: draft.drivers.map((driver) => ({
      metricCode: driver.metricCode,
      finding: `${driver.label}需要进一步核验。`,
      whyItMatters: driver.whyItMatters,
      evidenceAssessment: driver.evidenceAssessment,
      evidenceGap: driver.evidenceGap,
      nextAction: driver.nextAction,
      supportingCitationIds: driver.supportingCitationIds,
      counterCitationIds: driver.counterCitationIds,
    })),
    evidenceGaps: draft.evidenceGaps,
    uncertaintyReasons: draft.uncertainty.reasons,
    historyText: draft.history.text,
    industryText: draft.industry.text,
    recommendedActions: draft.recommendedActions,
    ...overrides,
  };
}

function providerResponse(content: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GreenLens AI provider adapter", () => {
  it("does not call a provider unless server-side AI is explicitly enabled", async () => {
    const request = vi.fn();
    const result = await generateRiskInterpretationWithProvider(draft, { env: {}, request: request as unknown as typeof fetch });
    expect(result).toMatchObject({ status: "disabled", reason: "not_enabled", interpretation: draft });
    expect(request).not.toHaveBeenCalled();
  });

  it("merges provider narrative while preserving metrics, citations and versions", async () => {
    const request = vi.fn<typeof fetch>(async () => providerResponse(narrative()));
    const result = await generateRiskInterpretationWithProvider(draft, {
      env: enabledEnvironment,
      request: request as unknown as typeof fetch,
    });

    expect(result.status).toBe("generated");
    expect(result.interpretation.headline).toBe("基于现有指标和证据形成的研究信号");
    expect(result.interpretation.citations).toEqual(draft.citations);
    expect(result.interpretation.drivers.map((item) => ({
      metricCode: item.metricCode,
      riskValue: item.riskValue,
      threshold: item.threshold,
      citationIds: item.citationIds,
    }))).toEqual(draft.drivers.map((item) => ({
      metricCode: item.metricCode,
      riskValue: item.riskValue,
      threshold: item.threshold,
      citationIds: item.citationIds,
    })));
    expect(result.interpretation.versions).toEqual(draft.versions);
    expect(request).toHaveBeenCalledOnce();
  });

  it("uses DeepSeek defaults with JSON output and non-thinking mode", async () => {
    const request = vi.fn<typeof fetch>(async () => providerResponse(narrative()));
    const result = await generateRiskInterpretationWithProvider(draft, {
      env: deepSeekEnvironment,
      request: request as unknown as typeof fetch,
    });

    expect(result).toMatchObject({ status: "generated", provider: "deepseek", model: "deepseek-v4-flash" });
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      stream: false,
      temperature: 0.1,
      max_tokens: 2_400,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    });
    const context = JSON.parse(body.messages[1].content);
    expect(context.robustnessViews).toEqual(draft.robustness);
    expect(context.deterministicDraft.drivers[0]).toMatchObject({
      calculation: draft.drivers[0].calculation,
      evidenceRelations: expect.any(Array),
    });
  });

  it("does not duplicate a configured chat-completions endpoint", async () => {
    const request = vi.fn<typeof fetch>(async () => providerResponse(narrative()));
    await generateRiskInterpretationWithProvider(draft, {
      env: { ...deepSeekEnvironment, GREENLENS_AI_BASE_URL: "https://api.deepseek.com/chat/completions" },
      request: request as unknown as typeof fetch,
    });

    expect(request.mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
  });

  it("falls back to deterministic output when the provider invents a citation", async () => {
    const request = vi.fn(async () => providerResponse(narrative({ summary: "无法由现有证据支持的内容 [99]。" })));
    const result = await generateRiskInterpretationWithProvider(draft, {
      env: enabledEnvironment,
      request: request as unknown as typeof fetch,
    });

    expect(result).toMatchObject({ status: "fallback", reason: "invalid_response" });
    expect(result.interpretation).toEqual(draft);
  });

  it("falls back without exposing provider errors when the request fails", async () => {
    const request = vi.fn(async () => new Response("rate limited", { status: 429 }));
    const result = await generateRiskInterpretationWithProvider(draft, {
      env: enabledEnvironment,
      request: request as unknown as typeof fetch,
    });

    expect(result).toMatchObject({ status: "fallback", reason: "request_failed", diagnostic: "http_429" });
    expect(result.interpretation).toEqual(draft);
  });
});
