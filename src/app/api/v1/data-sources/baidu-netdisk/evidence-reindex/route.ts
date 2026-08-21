import { NextRequest, NextResponse } from "next/server";
import type { EvidenceReindexScope, PdfDocumentKind } from "@/types";
import { createEvidenceReindex, previewEvidenceReindex, resumeEvidenceReindexRuns, scheduleEvidenceReindex } from "@/server/netdisk/evidence-reindex";
import { evidenceReindexFunnel, listPdfEvidenceExceptions } from "@/server/netdisk/sqlite-store";
import { isMockDataMode, mockEvidenceFunnel } from "@/server/analysis/mock-server-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isLocalRequest(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0];
  return host === "127.0.0.1" || host === "localhost";
}

export function GET() {
  if (isMockDataMode()) return NextResponse.json({ funnel: mockEvidenceFunnel(), exceptions: [] });
  resumeEvidenceReindexRuns();
  return NextResponse.json({ funnel: evidenceReindexFunnel(), exceptions: listPdfEvidenceExceptions(20) });
}

export async function POST(request: NextRequest) {
  if (!isLocalRequest(request)) return NextResponse.json({ cause: "Evidence reindex is restricted to the local host." }, { status: 403 });
  resumeEvidenceReindexRuns();
  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ cause: "Request body must be valid JSON.", impact: "No evidence job was created.", nextAction: "Send scope, kind, extractorVersion and dryRun as JSON." }, { status: 400 });
  }
  const scopes: EvidenceReindexScope[] = ["missing_only", "failed_only", "version_outdated"];
  const scope = String(payload.scope ?? "missing_only") as EvidenceReindexScope;
  const kind = String(payload.kind ?? "esg_report") as PdfDocumentKind;
  const extractorVersion = String(payload.extractorVersion ?? "evidence-rules-v2");
  const batchSize = Number(payload.batchSize ?? 20);
  if (!scopes.includes(scope) || kind !== "esg_report" || !extractorVersion.trim() || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
    return NextResponse.json({ cause: "Evidence reindex parameters are invalid.", impact: "No evidence job was created.", nextAction: "Use scope missing_only, failed_only or version_outdated; kind esg_report; and batchSize 1–50." }, { status: 400 });
  }
  const options = { scope, kind, extractorVersion, batchSize };
  if (payload.dryRun !== false) return NextResponse.json({ dryRun: true, preview: previewEvidenceReindex(options) });
  const run = createEvidenceReindex(options);
  if (["queued", "running"].includes(run.status)) scheduleEvidenceReindex(run.jobId, batchSize);
  return NextResponse.json({ dryRun: false, run }, { status: 202 });
}
