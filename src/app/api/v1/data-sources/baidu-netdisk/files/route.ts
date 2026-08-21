import { NextRequest, NextResponse } from "next/server";
import { netdiskFiles } from "@/server/netdisk/local-netdisk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path") ?? undefined;
  const kind = request.nextUrl.searchParams.get("kind") ?? undefined;
  const parseStatus = request.nextUrl.searchParams.get("parseStatus") ?? undefined;
  return NextResponse.json(netdiskFiles().filter((file) => (!path || file.path.startsWith(path)) && (!kind || file.kind === kind) && (!parseStatus || file.parseStatus === parseStatus)));
}
