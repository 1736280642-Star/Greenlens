import { NextResponse } from "next/server";
import { pdfQueueSummary } from "@/server/netdisk/sqlite-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() { return NextResponse.json(pdfQueueSummary()); }
