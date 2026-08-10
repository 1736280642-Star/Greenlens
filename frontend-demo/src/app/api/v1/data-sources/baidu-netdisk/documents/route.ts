import { NextResponse } from "next/server";
import { netdiskPdfDocuments } from "@/server/netdisk/local-netdisk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() { return NextResponse.json(netdiskPdfDocuments()); }
