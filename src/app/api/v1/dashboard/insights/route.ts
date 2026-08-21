import { NextResponse } from "next/server";
import { liveDashboardInsights } from "@/server/analysis/dashboard-insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(liveDashboardInsights());
}
