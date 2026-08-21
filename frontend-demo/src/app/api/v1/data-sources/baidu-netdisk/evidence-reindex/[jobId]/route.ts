import { NextRequest, NextResponse } from "next/server";
import { getEvidenceReindexRun } from "@/server/netdisk/sqlite-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  const run = getEvidenceReindexRun(jobId);
  return run
    ? NextResponse.json(run)
    : NextResponse.json({ cause: "Evidence reindex job was not found.", impact: "Progress cannot be displayed.", nextAction: "Check the job ID or create a new dry run." }, { status: 404 });
}
