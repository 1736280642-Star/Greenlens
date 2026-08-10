import { NextRequest, NextResponse } from "next/server";
import { reviewRecordSchema } from "@/contracts/analysis";
import { saveReviewRecord } from "@/server/netdisk/sqlite-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const input = await request.json().catch(() => null);
  const parsed = reviewRecordSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({
      cause: "Review payload does not match the review contract.",
      impact: "The human decision was not persisted.",
      nextAction: "Send a valid ReviewRecord and retry.",
    }, { status: 400 });
  }
  return NextResponse.json(saveReviewRecord(parsed.data));
}
