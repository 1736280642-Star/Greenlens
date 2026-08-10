import { NextRequest, NextResponse } from "next/server";
import { netdiskRecordSummary } from "@/server/netdisk/local-netdisk";
import { runEvidenceLinkageMigration } from "@/server/netdisk/sqlite-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isLocalRequest(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0];
  return host === "127.0.0.1" || host === "localhost";
}

export function POST(request: NextRequest) {
  if (!isLocalRequest(request)) {
    return NextResponse.json({ cause: "Evidence migration is restricted to the local host." }, { status: 403 });
  }
  const migration = runEvidenceLinkageMigration();
  return NextResponse.json({ migration, records: netdiskRecordSummary() });
}
