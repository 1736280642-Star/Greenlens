import { NextResponse } from "next/server";
import { netdiskStatus } from "@/server/netdisk/local-netdisk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() { return NextResponse.json(netdiskStatus()); }
