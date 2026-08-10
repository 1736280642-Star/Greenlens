import { NextRequest, NextResponse } from "next/server";
import { liveEnvironmentalAspects } from "@/server/analysis/live-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const year = Number(request.nextUrl.searchParams.get("reportYear"));
  return NextResponse.json(Number.isFinite(year) ? liveEnvironmentalAspects(id, year) : []);
}
