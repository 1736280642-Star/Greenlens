import { NextRequest, NextResponse } from "next/server";
import { createAnalysisJobRecord } from "@/server/netdisk/sqlite-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const input = await request.json().catch(() => null) as { companyId?: string; reportYear?: number; fileName?: string; fileSize?: number } | null;
  const companyId = input?.companyId?.trim();
  const reportYear = input?.reportYear;
  const fileName = input?.fileName?.trim();
  const fileSize = input?.fileSize;
  if (!companyId || !fileName || typeof reportYear !== "number" || !Number.isInteger(reportYear) || typeof fileSize !== "number" || !Number.isFinite(fileSize) || fileSize < 0) {
    return NextResponse.json({
      cause: "Invalid analysis job input.",
      impact: "No analysis task was created.",
      nextAction: "Send companyId, reportYear, fileName and fileSize.",
    }, { status: 400 });
  }
  return NextResponse.json(createAnalysisJobRecord({ companyId, reportYear: Number(reportYear), fileName, fileSize: Number(fileSize) }));
}
