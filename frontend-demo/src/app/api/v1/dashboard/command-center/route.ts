import { NextRequest, NextResponse } from "next/server";
import { liveDashboard } from "@/server/analysis/live-analysis";
import type { SampleGroup } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const light = params.get("light") === "1" || params.get("light") === "true";
  return NextResponse.json(liveDashboard({
    year: params.get("year") ? Number(params.get("year")) : undefined,
    industry: params.get("industry") ?? undefined,
    riskBand: params.get("riskBand") ?? undefined,
    sampleGroup: (params.get("sampleGroup") as SampleGroup | null) ?? undefined,
    light,
  }, { light }));
}
