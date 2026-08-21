import { NextRequest, NextResponse } from "next/server";
import { riskInterpretationFocusSchema, riskInterpretationSchema } from "@/contracts/analysis";
import { buildRiskInterpretation } from "@/lib/risk-interpretation";
import { liveCompanyRecords, liveEvidence, liveGsiScore, liveHistories } from "@/server/analysis/live-analysis";
import { generateRiskInterpretationWithProvider } from "@/server/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reportYear = Number(request.nextUrl.searchParams.get("reportYear"));
  const focus = riskInterpretationFocusSchema.catch("overview").parse(request.nextUrl.searchParams.get("focus") ?? "overview");
  if (!Number.isInteger(reportYear)) {
    return NextResponse.json({ cause: "reportYear is required.", impact: "Risk interpretation cannot select a company-year record.", nextAction: "Provide an integer reportYear and retry." }, { status: 400 });
  }
  const companies = liveCompanyRecords();
  const company = companies.find((item) => item.companyId === id && item.reportYear === reportYear);
  if (!company) {
    return NextResponse.json({ cause: "Company-year record was not found.", impact: "No interpretation can be generated.", nextAction: "Choose an available report year and retry." }, { status: 404 });
  }
  const deterministicInterpretation = buildRiskInterpretation({
    company,
    cohort: companies.filter((item) => item.reportYear === reportYear),
    evidence: liveEvidence(id, reportYear),
    history: liveHistories(companies).filter((item) => item.companyId === id),
    gsi: liveGsiScore(id, reportYear),
    focus,
  });
  const result = await generateRiskInterpretationWithProvider(deterministicInterpretation);
  const headers = {
    "X-GreenLens-AI-Status": result.status,
    ...(result.provider ? { "X-GreenLens-AI-Provider": result.provider } : {}),
    ...(result.model ? { "X-GreenLens-AI-Model": result.model } : {}),
    ...(result.reason ? { "X-GreenLens-AI-Reason": result.reason } : {}),
    ...(result.diagnostic ? { "X-GreenLens-AI-Diagnostic": result.diagnostic } : {}),
  };
  if (result.status !== "generated") {
    return NextResponse.json(providerFailure(result.reason), { status: 503, headers });
  }
  return NextResponse.json(riskInterpretationSchema.parse(result.interpretation), { headers });
}

function providerFailure(reason: string | undefined) {
  if (reason === "not_enabled") {
    return {
      cause: "AI Provider 尚未启用。",
      impact: "当前页面不会展示本地规则生成的解读，以免将降级结果误认为真实 AI 输出。",
      nextAction: "在服务端启用 GREENLENS_AI_ENABLED，并配置可用的 Provider 凭证后重试。",
    };
  }
  if (reason === "misconfigured" || reason === "unsupported_provider") {
    return {
      cause: reason === "unsupported_provider" ? "当前 AI Provider 类型不受支持。" : "AI Provider 配置不完整。",
      impact: "当前无法取得经过 Provider 生成并校验的风险解读。",
      nextAction: "检查服务端 Provider、Base URL、Model 与 API Key 配置后重试。",
    };
  }
  return {
    cause: reason === "invalid_response" ? "AI Provider 返回内容未通过结构或证据边界校验。" : "AI Provider 请求失败。",
    impact: "当前页面不会使用本地规则结果替代真实 AI 解读。",
    nextAction: "检查 Provider 可用性与模型响应后重试。",
  };
}
