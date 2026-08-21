import { after, NextResponse } from "next/server";
import { processAnalysisJob } from "@/server/analysis/pdf-analysis-worker";
import { getAnalysisJobRecord, requestAnalysisJobCancellation, retryAnalysisJobRecord } from "@/server/netdisk/sqlite-store";

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

export async function DELETE(_: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = requestAnalysisJobCancellation(jobId);
  return job ? NextResponse.json(job) : NextResponse.json({ cause: "Analysis job was not found.", impact: "No task was cancelled.", nextAction: "Refresh the task list and try again." }, { status: 404 });
}

export async function POST(_: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = retryAnalysisJobRecord(jobId);
  if (!job) return NextResponse.json({ cause: "Analysis job was not found.", impact: "No task was retried.", nextAction: "Upload the PDF again." }, { status: 404 });
  after(() => processAnalysisJob(jobId));
  return NextResponse.json(job, { status: 202 });
}
