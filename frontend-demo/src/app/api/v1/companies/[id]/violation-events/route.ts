import { NextRequest, NextResponse } from "next/server";
import { companyViolationEvents } from "@/server/netdisk/local-netdisk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const value = (name: string) => { const raw = request.nextUrl.searchParams.get(name); return raw == null ? undefined : Number(raw); };
  return NextResponse.json(companyViolationEvents(id, { reportYear: value("reportYear"), fromYear: value("fromYear"), toYear: value("toYear") }));
}
