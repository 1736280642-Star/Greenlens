import { NextResponse } from "next/server";
import { pdfQueueSummary } from "@/server/netdisk/sqlite-store";
import { isMockDataMode, mockPdfQueueSummary } from "@/server/analysis/mock-server-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() { return NextResponse.json(isMockDataMode() ? mockPdfQueueSummary() : pdfQueueSummary()); }
