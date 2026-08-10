import { NextRequest, NextResponse } from "next/server";
import { liveCompanyRecords, liveHistories } from "@/server/analysis/live-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fromYear = Number(request.nextUrl.searchParams.get("fromYear") ?? "-Infinity");
  const toYear = Number(request.nextUrl.searchParams.get("toYear") ?? "Infinity");
  return NextResponse.json(liveHistories(liveCompanyRecords()).filter((item) => item.companyId === id && item.reportYear >= fromYear && item.reportYear <= toYear));
}
