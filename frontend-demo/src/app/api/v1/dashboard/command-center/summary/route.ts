import { NextRequest, NextResponse } from "next/server";
import { liveDashboard } from "@/server/analysis/live-analysis";
import { loadDashboardConstellationRows, releaseSqliteMemory } from "@/server/netdisk/sqlite-store";
import type { SampleGroup } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = {
    year: params.get("year") ? Number(params.get("year")) : undefined,
    industry: params.get("industry") ?? undefined,
    riskBand: params.get("riskBand") ?? undefined,
    sampleGroup: (params.get("sampleGroup") as SampleGroup | null) ?? undefined,
  };
  if (params.get("constellation") === "1") {
    const rows = loadDashboardConstellationRows(query);
    releaseSqliteMemory();
    return NextResponse.json(rows);
  }
  return NextResponse.json(liveDashboard({ ...query, light: true }, { light: true }));
}
