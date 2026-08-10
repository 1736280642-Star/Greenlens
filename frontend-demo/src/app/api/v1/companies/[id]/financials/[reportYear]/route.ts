import { NextResponse } from "next/server";
import { financialRecord } from "@/server/netdisk/local-netdisk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string; reportYear: string }> }) {
  const { id, reportYear } = await params;
  const record = financialRecord(id, Number(reportYear));
  return record ? NextResponse.json(record) : NextResponse.json(null, { status: 404 });
}
