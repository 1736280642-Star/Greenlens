import { NextRequest, NextResponse } from "next/server";
import { liveCompanyRecords } from "@/server/analysis/live-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestedYear = request.nextUrl.searchParams.get("reportYear");
  const matches = liveCompanyRecords().filter((record) => record.companyId === id).sort((a, b) => b.reportYear - a.reportYear);
  const record = requestedYear ? matches.find((item) => item.reportYear === Number(requestedYear)) : matches[0];
  return record ? NextResponse.json(record) : NextResponse.json(null, { status: 404 });
}
