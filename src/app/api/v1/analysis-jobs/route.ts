import { after, NextRequest, NextResponse } from "next/server";
import { persistUploadedPdf, PdfUploadError } from "@/server/analysis/pdf-upload";
import { processAnalysisJob } from "@/server/analysis/pdf-analysis-worker";
import { createAnalysisJobRecord, findCompletedAnalysisJob } from "@/server/netdisk/sqlite-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const input = await request.formData().catch(() => null);
  const companyId = input?.get("companyId")?.toString().trim();
  const reportYear = Number(input?.get("reportYear"));
  const file = input?.get("file");
  if (!companyId || !/^[A-Za-z0-9_-]{1,128}$/.test(companyId) || !Number.isInteger(reportYear) || reportYear < 1990 || reportYear > new Date().getFullYear() + 1 || !(file instanceof File)) {
    return NextResponse.json({
      cause: "Invalid analysis job input.",
      impact: "No analysis task was created.",
      nextAction: "Send companyId, reportYear and one PDF file as multipart/form-data.",
    }, { status: 400 });
  }
  try {
    const stored = await persistUploadedPdf(file, companyId, reportYear);
    const existing = findCompletedAnalysisJob(stored.fileHash, companyId, reportYear);
    if (existing) return NextResponse.json({ ...existing, document: existing.document ? { ...existing.document, deduplicated: true } : undefined });
    const job = createAnalysisJobRecord({ companyId, reportYear, ...stored });
    after(() => processAnalysisJob(job.jobId));
    return NextResponse.json(job, { status: 202 });
  } catch (error) {
    if (error instanceof PdfUploadError) {
      return NextResponse.json({ cause: error.message, impact: error.impact, nextAction: error.nextAction }, { status: error.status });
    }
    return NextResponse.json({ cause: "PDF 持久化失败。", impact: "分析任务未创建。", nextAction: "检查本地运行目录的磁盘空间与写入权限后重试。" }, { status: 500 });
  }
}
