import { NextRequest, NextResponse } from "next/server";
import { ingestNetdiskPdfDocuments, netdiskRecordSummary, persistNetdiskPdfState } from "@/server/netdisk/local-netdisk";
import { finishSession, readSessionStatus, readStagedPdfSession, stagePdfBatch } from "@/server/netdisk/sqlite-store";
import type { NetdiskPdfDocumentInput } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function allowedHost(request: NextRequest) {
  const allowed = (process.env.GREENLENS_INGEST_ALLOWED_HOSTS ?? "127.0.0.1,localhost").split(",").map((value) => value.trim()).filter(Boolean);
  return allowed.includes(request.headers.get("host")?.split(":")[0] ?? "");
}

function validDocument(document: NetdiskPdfDocumentInput) {
  return document && typeof document.fsid === "string" && document.fsid.length > 0 && typeof document.filename === "string" && document.filename.toLowerCase().endsWith(".pdf") && ["esg_report", "negative_news"].includes(document.kind) && Number.isInteger(document.pageCount) && Array.isArray(document.pages) && document.pages.every((page) => Number.isInteger(page.page) && page.page > 0 && typeof page.text === "string" && typeof page.textHash === "string");
}

export async function POST(request: NextRequest) {
  if (process.env.GREENLENS_INGEST_ENABLED !== "true") return NextResponse.json({ cause: "Document ingestion is disabled.", impact: "No PDF evidence was imported.", nextAction: "Set GREENLENS_INGEST_ENABLED=true and restart the backend." }, { status: 403 });
  if (!allowedHost(request)) return NextResponse.json({ cause: "The caller host is not allowed.", impact: "No PDF evidence was imported.", nextAction: "Use a configured local host." }, { status: 403 });
  const input = await request.json().catch(() => null) as { sessionId?: string; complete?: boolean; append?: boolean; documents?: NetdiskPdfDocumentInput[]; failures?: Array<{ fsid: number; reason: string }> } | null;
  const sessionId = input?.sessionId?.trim();
  if (!sessionId || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return NextResponse.json({ cause: "A valid sessionId is required.", impact: "No PDF evidence was imported.", nextAction: "Reuse one alphanumeric sessionId for every document batch." }, { status: 400 });
  const documents = input?.documents;
  const maxChars = Number(process.env.GREENLENS_INGEST_MAX_BATCH_CHARS ?? 2_000_000);
  const characterCount = documents?.reduce((total, document) => total + document.pages.reduce((pageTotal, page) => pageTotal + page.text.length, 0), 0) ?? 0;
  if (!Array.isArray(documents) || !documents.length || documents.some((document) => !validDocument(document)) || characterCount > maxChars) return NextResponse.json({ cause: "Invalid PDF ingestion batch.", impact: "No PDF evidence was imported.", nextAction: `Send valid PDF page blocks totaling at most ${maxChars} characters.` }, { status: 400 });

  const acceptedPages = stagePdfBatch(sessionId, documents, Boolean(input?.complete));
  if (!input?.complete) return NextResponse.json({ status: "accepted", sessionId, acceptedPages });

  const job = ingestNetdiskPdfDocuments(readStagedPdfSession(sessionId), input.append !== false);
  persistNetdiskPdfState();
  const summary = netdiskRecordSummary();
  const failures = Array.isArray(input.failures) ? input.failures.slice(0, 5000).map((failure) => ({ fsid: Number(failure.fsid), reason: String(failure.reason).slice(0, 500) })) : [];
  const status = job.readyFileCount === job.discoveredFileCount && failures.length === 0 ? "completed" : "completed_with_warnings";
  finishSession(sessionId, status, failures.length ? { failures } : undefined);
  return NextResponse.json({ ...job, status, failedFileCount: failures.length, failures, ...summary });
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return NextResponse.json({ cause: "A valid sessionId is required." }, { status: 400 });
  const task = readSessionStatus(sessionId);
  return task ? NextResponse.json(task) : NextResponse.json({ cause: "Task log was not found." }, { status: 404 });
}
