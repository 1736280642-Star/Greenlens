import { NextResponse } from "next/server";
import { netdiskSyncJob } from "@/server/netdisk/local-netdisk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = netdiskSyncJob(jobId);
  return job ? NextResponse.json(job) : NextResponse.json({ cause: "Sync job was not found.", impact: "Its status cannot be displayed.", nextAction: "Start a new sync." }, { status: 404 });
}
