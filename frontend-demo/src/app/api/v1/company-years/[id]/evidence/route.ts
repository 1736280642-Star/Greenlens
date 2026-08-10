import { NextRequest, NextResponse } from "next/server";
import { liveEvidence } from "@/server/analysis/live-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const year = request.nextUrl.searchParams.get("reportYear");
  return NextResponse.json(liveEvidence(id, year ? Number(year) : undefined));
}
