import { NextRequest, NextResponse } from "next/server";
import { riskInterpretationFocusSchema, riskInterpretationSchema } from "@/contracts/analysis";
import { buildRiskInterpretation } from "@/lib/risk-interpretation";
import { liveCompanyRecords, liveEvidence, liveHistories } from "@/server/analysis/live-analysis";

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
  const interpretation = buildRiskInterpretation({
    company,
    cohort: companies.filter((item) => item.reportYear === reportYear),
    evidence: liveEvidence(id, reportYear),
    history: liveHistories(companies).filter((item) => item.companyId === id),
    focus,
  });
  return NextResponse.json(riskInterpretationSchema.parse(interpretation));
}
