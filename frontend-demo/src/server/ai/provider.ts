import { z } from "zod";
import { riskInterpretationSchema } from "@/contracts/analysis";
import type { MetricCode, RiskInterpretation } from "@/types";

const supportedProviders = new Set(["openai", "openai-compatible", "deepseek"]);
const deepSeekDefaults = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  timeoutMs: 60_000,
  temperature: 0.1,
  maxTokens: 2_400,
};

const narrativeSchema = z.object({
  headline: z.string().trim().min(1).max(180),
  summary: z.string().trim().min(1).max(1_600),
  researchBrief: z.object({
    finding: z.string().trim().min(1).max(500),
    evidenceAssessment: z.string().trim().min(1).max(500),
    modelAgreement: z.string().trim().min(1).max(500),
    priorityAction: z.string().trim().min(1).max(400),
  }).strict(),
  drivers: z.array(z.object({
    metricCode: z.string().trim().min(1),
    finding: z.string().trim().min(1).max(600),
    whyItMatters: z.string().trim().min(1).max(500),
    evidenceAssessment: z.string().trim().min(1).max(600),
    evidenceGap: z.string().trim().min(1).max(500),
    nextAction: z.string().trim().min(1).max(500),
    supportingCitationIds: z.array(z.string().trim().min(1)).max(4),
    counterCitationIds: z.array(z.string().trim().min(1)).max(4),
  }).strict()).max(8),
  evidenceGaps: z.array(z.string().trim().min(1).max(400)).max(10),
  uncertaintyReasons: z.array(z.string().trim().min(1).max(400)).max(8),
  historyText: z.string().trim().min(1).max(800),
  industryText: z.string().trim().min(1).max(800),
  recommendedActions: z.array(z.string().trim().min(1).max(400)).max(8),
}).strict();

type ProviderStatus = "disabled" | "generated" | "fallback";
type ProviderFailureReason = "not_enabled" | "misconfigured" | "unsupported_provider" | "request_failed" | "invalid_response";

export interface AiProviderResult {
  interpretation: RiskInterpretation;
  status: ProviderStatus;
  provider?: string;
  model?: string;
  reason?: ProviderFailureReason;
  diagnostic?: string;
}

interface ProviderConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  maxEvidenceChars: number;
}

interface GenerateOptions {
  env?: Record<string, string | undefined>;
  request?: typeof fetch;
}

export async function generateRiskInterpretationWithProvider(
  draft: RiskInterpretation,
  options: GenerateOptions = {},
): Promise<AiProviderResult> {
  const env = options.env ?? process.env;
  if (env.GREENLENS_AI_ENABLED !== "true") {
    return { interpretation: draft, status: "disabled", reason: "not_enabled" };
  }

  const config = readProviderConfig(env);
  if (!config.ok) {
    return { interpretation: draft, status: "fallback", provider: config.provider, reason: config.reason };
  }

  try {
    const responseText = await callOpenAiCompatible(config.value, draft, options.request ?? fetch);
    const narrative = narrativeSchema.parse(parseJsonObject(responseText));
    assertNarrativeUsesKnownContext(narrative, draft);
    const interpretation = mergeNarrative(draft, narrative);
    return {
      interpretation: riskInterpretationSchema.parse(interpretation),
      status: "generated",
      provider: config.value.provider,
      model: config.value.model,
    };
  } catch (error) {
    return {
      interpretation: draft,
      status: "fallback",
      provider: config.value.provider,
      model: config.value.model,
      reason: error instanceof ProviderRequestError ? "request_failed" : "invalid_response",
      ...(error instanceof ProviderRequestError ? { diagnostic: error.diagnostic } : {}),
    };
  }
}

function readProviderConfig(env: Record<string, string | undefined>):
  | { ok: true; value: ProviderConfig }
  | { ok: false; provider?: string; reason: "misconfigured" | "unsupported_provider" } {
  const provider = env.GREENLENS_AI_PROVIDER?.trim().toLowerCase();
  if (!provider || !supportedProviders.has(provider)) {
    return { ok: false, provider, reason: provider ? "unsupported_provider" : "misconfigured" };
  }

  const isDeepSeek = provider === "deepseek";
  const baseUrl = (env.GREENLENS_AI_BASE_URL?.trim() || (isDeepSeek ? deepSeekDefaults.baseUrl : "")).replace(/\/$/, "");
  const model = env.GREENLENS_AI_MODEL?.trim() || (isDeepSeek ? deepSeekDefaults.model : "");
  const apiKey = env.GREENLENS_AI_API_KEY?.trim();
  if (!baseUrl || !model || !apiKey || !isHttpUrl(baseUrl)) {
    return { ok: false, provider, reason: "misconfigured" };
  }

  return {
    ok: true,
    value: {
      provider,
      baseUrl,
      model,
      apiKey,
      timeoutMs: boundedNumber(env.GREENLENS_AI_TIMEOUT_MS, isDeepSeek ? deepSeekDefaults.timeoutMs : 30_000, 1_000, 120_000),
      temperature: boundedNumber(env.GREENLENS_AI_TEMPERATURE, isDeepSeek ? deepSeekDefaults.temperature : 0.2, 0, 1),
      maxTokens: boundedNumber(env.GREENLENS_AI_MAX_TOKENS, isDeepSeek ? deepSeekDefaults.maxTokens : 1_800, 256, 8_000),
      maxEvidenceChars: boundedNumber(env.GREENLENS_AI_MAX_EVIDENCE_CHARS, 800, 100, 4_000),
    },
  };
}

async function callOpenAiCompatible(config: ProviderConfig, draft: RiskInterpretation, request: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const endpoint = config.baseUrl.endsWith("/chat/completions") ? config.baseUrl : `${config.baseUrl}/chat/completions`;
    const response = await request(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: false,
        response_format: { type: "json_object" },
        ...(config.provider === "deepseek" ? { thinking: { type: "disabled" } } : {}),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(buildProviderContext(draft, config.maxEvidenceChars)) },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new ProviderRequestError(`Provider returned HTTP ${response.status}.`, `http_${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new ProviderRequestError("Provider returned no message content.", "empty_content");
    return content;
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error;
    throw new ProviderRequestError("Provider request failed.", error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error");
  } finally {
    clearTimeout(timer);
  }
}

function buildProviderContext(draft: RiskInterpretation, maxEvidenceChars: number) {
  const referenceByCitationId = new Map(draft.citations.map((citation, index) => [citation.id, `[${index + 1}]`]));
  return {
    task: "基于限定的指标证据包形成中文 ESG 风险研究解读。逐项给出判断、重要性、证据支持程度、证据缺口和下一步核验动作。",
    company: {
      companyId: draft.companyId,
      companyName: draft.companyName,
      reportYear: draft.reportYear,
      riskBand: draft.riskBand,
      finalIndex: draft.finalIndex,
      evidenceCoverage: draft.evidenceCoverage,
      focus: draft.focus,
    },
    robustnessViews: draft.robustness,
    deterministicDraft: {
      headline: draft.headline,
      summary: draft.summary,
      researchBrief: draft.researchBrief,
      drivers: draft.drivers.map((driver) => ({
        metricCode: driver.metricCode,
        label: driver.label,
        riskValue: driver.riskValue,
        threshold: driver.threshold,
        contribution: driver.contribution,
        status: driver.status,
        deterministicFinding: driver.finding,
        whyItMatters: driver.whyItMatters,
        evidenceAssessment: driver.evidenceAssessment,
        evidenceGap: driver.evidenceGap,
        nextAction: driver.nextAction,
        calculation: driver.calculation,
        citationIds: driver.citationIds,
        evidenceRelations: driver.evidenceRelations.map((relation) => ({
          ...relation,
          reference: referenceByCitationId.get(relation.citationId),
        })),
      })),
      evidenceGaps: draft.evidenceGaps,
      uncertainty: draft.uncertainty,
      history: draft.history,
      industry: draft.industry,
      recommendedActions: draft.recommendedActions,
    },
    citations: draft.citations.map((citation, index) => ({
      reference: `[${index + 1}]`,
      id: citation.id,
      evidenceId: citation.evidenceId,
      kind: citation.kind,
      label: citation.label,
      sourceLabel: citation.sourceLabel,
      page: citation.page,
      eventDate: citation.eventDate,
      excerpt: citation.excerpt.slice(0, maxEvidenceChars),
    })),
    versions: draft.versions,
    outputShape: {
      headline: "string",
      summary: "string",
      researchBrief: { finding: "string", evidenceAssessment: "string", modelAgreement: "string", priorityAction: "string" },
      drivers: [{
        metricCode: "existing metric code",
        finding: "string with supplied [n] references when applicable",
        whyItMatters: "string",
        evidenceAssessment: "string with supplied [n] references when applicable",
        evidenceGap: "string",
        nextAction: "string",
        supportingCitationIds: ["existing citation id"],
        counterCitationIds: ["existing citation id"],
      }],
      evidenceGaps: ["string"],
      uncertaintyReasons: ["string"],
      historyText: "string",
      industryText: "string",
      recommendedActions: ["string"],
    },
  };
}

const systemPrompt = [
  "You are GreenLens, an ESG evidence research assistant.",
  "Return one JSON object only, matching outputShape exactly. Do not use Markdown fences.",
  "Analyze only information present in deterministicDraft, robustnessViews, citations, company and versions.",
  "For each metric, distinguish the risk finding, why it matters, evidence that supports or counters it, what remains unknown, and the most specific next verification action.",
  "Treat GSI and Red Flags as separate robustness views. Describe agreement or divergence only when the supplied values support it; missing GSI must remain missing.",
  "Do not create new facts, numbers, companies, years, metrics, evidence, pages or causal conclusions.",
  "Keep facts, model inferences and unknown items distinguishable. Risk is a research signal, not a greenwashing verdict.",
  "Citation markers and citation IDs may only use the supplied references and IDs. Never classify one citation as both supporting and counter evidence for the same metric.",
  "If evidence is insufficient or only contextual, say so explicitly instead of filling the gap with general ESG knowledge.",
  "Do not change availability judgments, uncertainty level, metric order, thresholds, versions or recommendation scope.",
].join(" ");

function mergeNarrative(draft: RiskInterpretation, narrative: z.infer<typeof narrativeSchema>): RiskInterpretation {
  const narrativeByMetric = new Map<MetricCode, (typeof narrative.drivers)[number]>();
  for (const item of narrative.drivers) narrativeByMetric.set(item.metricCode as MetricCode, item);
  return {
    ...draft,
    headline: narrative.headline,
    summary: narrative.summary,
    researchBrief: narrative.researchBrief,
    drivers: draft.drivers.map((driver) => {
      const generated = narrativeByMetric.get(driver.metricCode);
      if (!generated) return driver;
      return {
        ...driver,
        explanation: generated.finding,
        finding: generated.finding,
        whyItMatters: generated.whyItMatters,
        evidenceAssessment: generated.evidenceAssessment,
        evidenceGap: generated.evidenceGap,
        nextAction: generated.nextAction,
        supportingCitationIds: generated.supportingCitationIds,
        counterCitationIds: generated.counterCitationIds,
      };
    }),
    evidenceGaps: narrative.evidenceGaps,
    uncertainty: { ...draft.uncertainty, reasons: narrative.uncertaintyReasons },
    history: { ...draft.history, text: narrative.historyText },
    industry: { ...draft.industry, text: narrative.industryText },
    recommendedActions: narrative.recommendedActions.slice(0, 4),
  };
}

function assertNarrativeUsesKnownContext(narrative: z.infer<typeof narrativeSchema>, draft: RiskInterpretation) {
  const metricCodes = new Set(draft.drivers.map((driver) => driver.metricCode));
  const returnedMetricCodes = new Set(narrative.drivers.map((driver) => driver.metricCode as MetricCode));
  if (returnedMetricCodes.size !== narrative.drivers.length || returnedMetricCodes.size !== metricCodes.size) {
    throw new Error("Provider did not return one interpretation for every metric packet.");
  }
  if (narrative.drivers.some((driver) => !metricCodes.has(driver.metricCode as MetricCode))) {
    throw new Error("Provider introduced an unknown metric.");
  }

  const draftByMetric = new Map(draft.drivers.map((driver) => [driver.metricCode, driver]));
  for (const driver of narrative.drivers) {
    const source = draftByMetric.get(driver.metricCode as MetricCode);
    if (!source) continue;
    const allowed = new Set(source.citationIds);
    const supplied = [...driver.supportingCitationIds, ...driver.counterCitationIds];
    if (supplied.some((citationId) => !allowed.has(citationId))) throw new Error("Provider assigned evidence outside the metric packet.");
    if (driver.supportingCitationIds.some((citationId) => driver.counterCitationIds.includes(citationId))) {
      throw new Error("Provider assigned conflicting evidence relations.");
    }
  }

  const allText = collectStrings(narrative).join("\n");
  for (const match of allText.matchAll(/\[(\d+)]/g)) {
    const reference = Number(match[1]);
    if (reference < 1 || reference > draft.citations.length) throw new Error("Provider introduced an unknown citation.");
  }
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
}

function parseJsonObject(value: string): unknown {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Provider response did not contain a JSON object.");
  return JSON.parse(trimmed.slice(start, end + 1));
}

function boundedNumber(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

class ProviderRequestError extends Error {
  constructor(message: string, readonly diagnostic: string) {
    super(message);
  }
}
