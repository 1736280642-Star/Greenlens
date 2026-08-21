import { NextResponse } from "next/server";
import { netdiskRecordSummary } from "@/server/netdisk/local-netdisk";

export const dynamic = "force-dynamic";

export function GET() { return NextResponse.json(netdiskRecordSummary()); }
