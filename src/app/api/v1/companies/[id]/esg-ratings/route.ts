import { NextRequest, NextResponse } from "next/server";
import { netdiskEsgRatings } from "@/server/netdisk/local-netdisk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fromYear = Number(request.nextUrl.searchParams.get("fromYear") ?? "-Infinity");
  const toYear = Number(request.nextUrl.searchParams.get("toYear") ?? "Infinity");
  const vendor = request.nextUrl.searchParams.get("vendor") ?? undefined;
  return NextResponse.json(netdiskEsgRatings().filter((record) =>
    record.companyId === id
    && record.reportYear >= fromYear
    && record.reportYear <= toYear
    && (!vendor || record.vendor === vendor),
  ));
}
