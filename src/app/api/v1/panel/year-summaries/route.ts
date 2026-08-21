import { NextRequest, NextResponse } from "next/server";
import { liveCompanyRecords, liveQuality } from "@/server/analysis/live-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const fromYear = Number(request.nextUrl.searchParams.get("fromYear") ?? "-Infinity");
  const toYear = Number(request.nextUrl.searchParams.get("toYear") ?? "Infinity");
  return NextResponse.json(liveQuality(liveCompanyRecords()).filter((item) => item.year >= fromYear && item.year <= toYear));
}
