import { NextRequest, NextResponse } from "next/server";
import { ingestNetdiskRows, netdiskRecordSummary, persistNetdiskSnapshot, type NetdiskIngestFile } from "@/server/netdisk/local-netdisk";
import { finishSession, readSessionStatus, readStagedExcelSession, stageExcelBatch } from "@/server/netdisk/sqlite-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function allowedHost(request: NextRequest) {
  const allowed = (process.env.GREENLENS_INGEST_ALLOWED_HOSTS ?? "127.0.0.1,localhost").split(",").map((value) => value.trim()).filter(Boolean);
  return allowed.includes(request.headers.get("host")?.split(":")[0] ?? "");
}

export async function POST(request: NextRequest) {
  if (process.env.GREENLENS_INGEST_ENABLED !== "true") return NextResponse.json({ cause: "Memory ingestion is disabled.", impact: "No source data was imported.", nextAction: "Set GREENLENS_INGEST_ENABLED=true and restart the backend." }, { status: 403 });
  if (!allowedHost(request)) return NextResponse.json({ cause: "The caller host is not allowed.", impact: "No source data was imported.", nextAction: "Use a configured local host." }, { status: 403 });
  const input = await request.json().catch(() => null) as { sessionId?: string; complete?: boolean; append?: boolean; files?: NetdiskIngestFile[] } | null;
  const files = input?.files;
  const maxRows = Number(process.env.GREENLENS_INGEST_MAX_BATCH_ROWS ?? 1000);
  if (!Array.isArray(files) || !files.length || files.some((file) => !file || !Array.isArray(file.rows)) || files.reduce((total, file) => total + file.rows.length, 0) > maxRows) return NextResponse.json({ cause: "Invalid ingestion batch.", impact: "No source data was imported.", nextAction: `Send 1-${maxRows} parsed rows with source metadata.` }, { status: 400 });
  const sessionId = input?.sessionId?.trim();
  if (!sessionId || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return NextResponse.json({ cause: "A valid sessionId is required.", impact: "No source data was imported.", nextAction: "Reuse one alphanumeric sessionId for every batch in this ingestion." }, { status: 400 });
  const acceptedRows = stageExcelBatch(sessionId, files, Boolean(input?.complete));
  if (!input?.complete) return NextResponse.json({ status: "accepted", sessionId, acceptedRows });
  const job = ingestNetdiskRows(readStagedExcelSession(sessionId) as NetdiskIngestFile[], true);
  const summary = netdiskRecordSummary();
  persistNetdiskSnapshot(); finishSession(sessionId, "completed");
  return NextResponse.json({ ...job, ...summary });
}

export async function GET(request: NextRequest) { const sessionId = request.nextUrl.searchParams.get("sessionId"); if (!sessionId || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return NextResponse.json({ cause: "A valid sessionId is required." }, { status: 400 }); const task = readSessionStatus(sessionId); return task ? NextResponse.json(task) : NextResponse.json({ cause: "Task log was not found." }, { status: 404 }); }
