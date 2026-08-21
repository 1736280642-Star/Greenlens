import { NextResponse } from "next/server";
import { reviewQueueActionSchema } from "@/contracts/analysis";
import { listReviewQueueActions, saveReviewQueueAction } from "@/server/netdisk/sqlite-store";

export async function GET() {
  return NextResponse.json(listReviewQueueActions());
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = reviewQueueActionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "跳过状态格式无效，请刷新任务后重试。" }, { status: 400 });
  }
  return NextResponse.json(saveReviewQueueAction(parsed.data));
}
