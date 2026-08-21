import { NextRequest, NextResponse } from "next/server";
import { liveDashboard } from "@/server/analysis/live-analysis";
import type { SampleGroup } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const light = params.get("light") === "1" || params.get("light") === "true";
  const response = NextResponse.json(liveDashboard({
    year: params.get("year") ? Number(params.get("year")) : undefined,
    industry: params.get("industry") ?? undefined,
    riskBand: params.get("riskBand") ?? undefined,
    sampleGroup: (params.get("sampleGroup") as SampleGroup | null) ?? undefined,
    light,
  }, { light }));
  if (process.env.GREENLENS_PROFILE_DASHBOARD === "1") {
    const logMemory = (stage: string) => {
      const memory = process.memoryUsage();
      console.log(JSON.stringify({ event: "dashboard-profile", stage, heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024), rssMb: Math.round(memory.rss / 1024 / 1024) }));
    };
    logMemory("response");
    setTimeout(() => logMemory("response+2s"), 2_000).unref();
  }
  return response;
}
