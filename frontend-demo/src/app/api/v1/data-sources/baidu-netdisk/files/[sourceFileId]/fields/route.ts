import { NextResponse } from "next/server";
import { netdiskFieldCatalog } from "@/server/netdisk/local-netdisk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ sourceFileId: string }> }) {
  const { sourceFileId } = await params;
  const catalog = netdiskFieldCatalog(sourceFileId);
  return catalog ? NextResponse.json(catalog) : NextResponse.json({ cause: "Source file schema is unavailable.", impact: "The file cannot be mapped yet.", nextAction: "Run data-source sync first." }, { status: 404 });
}
