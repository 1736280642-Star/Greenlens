import { NextRequest, NextResponse } from "next/server";
import { confirmEvidenceDocumentIdentity } from "@/server/netdisk/evidence-reindex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isLocalRequest(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0];
  return host === "127.0.0.1" || host === "localhost";
}

export async function POST(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  if (!isLocalRequest(request)) return NextResponse.json({ cause: "Manual evidence identity confirmation is restricted to the local host." }, { status: 403 });
  const { documentId } = await context.params;
  let payload: { companyId?: string; reportYear?: number; extractorVersion?: string };
  try { payload = await request.json() as typeof payload; }
  catch { return NextResponse.json({ cause: "Request body must be valid JSON.", impact: "The document identity was not changed.", nextAction: "Send companyId and reportYear as JSON." }, { status: 400 }); }
  try {
    const result = confirmEvidenceDocumentIdentity({ documentId, companyId: payload.companyId ?? "", reportYear: Number(payload.reportYear), extractorVersion: payload.extractorVersion });
    return NextResponse.json(result);
  } catch (reason) {
    return NextResponse.json({ cause: reason instanceof Error ? reason.message : "Manual identity confirmation failed.", impact: "Previously valid evidence was preserved.", nextAction: "Check the company ID, report year and parsed PDF text before retrying." }, { status: 422 });
  }
}
