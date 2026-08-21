import { NextRequest, NextResponse } from "next/server";
import { evidencePageText } from "@/server/netdisk/sqlite-store";
import { isMockDataMode, mockEvidencePageText } from "@/server/analysis/mock-server-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; evidenceId: string }> }) {
  const { id, evidenceId } = await params;
  const rawPage = request.nextUrl.searchParams.get("page");
  const page = rawPage == null ? undefined : Number(rawPage);
  const reference = isMockDataMode() ? mockEvidencePageText(id, evidenceId, Number.isFinite(page) ? page : undefined) : evidencePageText(id, evidenceId, Number.isFinite(page) ? page : undefined);
  return reference ? NextResponse.json(reference) : NextResponse.json({
    cause: "No PDF page text is available for this evidence.",
    impact: "The evidence cannot be opened in the read-only page viewer.",
    nextAction: "Confirm the evidence belongs to an ingested ESG report document.",
  }, { status: 404 });
}
