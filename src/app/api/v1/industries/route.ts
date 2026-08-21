import { NextResponse } from "next/server";
import { netdiskCompanyIndustries } from "@/server/netdisk/local-netdisk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const industries = [...new Set(netdiskCompanyIndustries()
    .map((record) => record.industryGroup || record.industryName)
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  return NextResponse.json({ industries });
}
