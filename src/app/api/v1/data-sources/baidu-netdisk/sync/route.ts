import { NextRequest, NextResponse } from "next/server";
import { syncLocalNetdisk } from "@/server/netdisk/local-netdisk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const input = await request.json().catch(() => ({})) as { path?: string };
  try {
    return NextResponse.json(await syncLocalNetdisk(input.path));
  } catch (error) {
    const cause = error instanceof Error ? error.message : "Local netdisk sync failed.";
    return NextResponse.json({ cause, impact: "No source data was imported.", nextAction: "Configure GREENLENS_SOURCE_DIR to the synced Baidu Netdisk folder and retry." }, { status: 503 });
  }
}
