import { NextResponse } from "next/server";
import { getAnalysisJobRecord } from "@/server/netdisk/sqlite-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getAnalysisJobRecord(jobId);
  return job ? NextResponse.json(job) : NextResponse.json({
    cause: "Analysis job was not found.",
    impact: "Its progress cannot be displayed.",
    nextAction: "Submit a new analysis job.",
  }, { status: 404 });
}
