import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AnalysisJob, NetdiskPdfDocumentInput } from "@/types";
import { CURRENT_EVIDENCE_EXTRACTOR_VERSION } from "@/server/netdisk/evidence-extractor";
import { parsePdfText, PDF_PARSER_VERSION } from "@/server/analysis/pdf-parser";
import { ingestNetdiskPdfDocuments, netdiskCompanyScores, persistNetdiskPdfState } from "@/server/netdisk/local-netdisk";
import {
  getAnalysisJobContext,
  isAnalysisJobCancellationRequested,
  persistedEnvironmentalAspects,
  persistedEvidenceItems,
  updateAnalysisJobRecord,
} from "@/server/netdisk/sqlite-store";

export const PDF_FORMULA_VERSION = "pdf-actions-v2";
export const PDF_WORKER_VERSION = "local-pdf-worker-v1";

class AnalysisPipelineError extends Error {
  constructor(readonly detail: NonNullable<AnalysisJob["error"]>) {
    super(detail.cause);
  }
}

function cancelled(jobId: string) {
  return isAnalysisJobCancellationRequested(jobId);
}

function update(jobId: string, patch: Partial<AnalysisJob>) {
  if (cancelled(jobId)) throw new AnalysisPipelineError({ cause: "分析任务已取消。", impact: "后续解析与指标计算已停止。", nextAction: "如需继续，请重新启动该任务。" });
  updateAnalysisJobRecord(jobId, patch);
}

function pipelineFailure(error: unknown): NonNullable<AnalysisJob["error"]> {
  if (error instanceof AnalysisPipelineError) return error.detail;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (/PasswordException|password|encrypted/i.test(`${name} ${message}`)) {
    return { cause: "PDF 已加密或需要密码。", impact: "系统不能读取正文，也不会生成证据与指标。", nextAction: "上传解除密码保护的文本版 PDF。" };
  }
  if (/InvalidPDFException|invalid pdf|format error/i.test(`${name} ${message}`)) {
    return { cause: "PDF 结构损坏或格式无效。", impact: "解析流程在正文抽取前终止。", nextAction: "从可信来源重新下载或重新导出 PDF 后重试。" };
  }
  return { cause: `PDF 处理失败：${message.slice(0, 240)}`, impact: "本次任务未生成可用分析结果。", nextAction: "确认文件可正常打开后重试；若仍失败，请记录任务编号并排查解析日志。" };
}

export async function processAnalysisJob(jobId: string) {
  const context = getAnalysisJobContext(jobId);
  if (!context || cancelled(jobId)) return;
  const startedAt = new Date().toISOString();
  try {
    update(jobId, { status: "running", phase: "collect", stage: "validating", progress: 6, startedAt, error: undefined });
    const bytes = await readFile(context.storagePath);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== context.fileHash || bytes.length !== context.fileSize) {
      throw new AnalysisPipelineError({ cause: "持久化文件与上传校验值不一致。", impact: "为避免分析错误版本，任务已停止。", nextAction: "重新上传原始 PDF；如重复出现，请检查本地存储介质。" });
    }

    update(jobId, { status: "running", phase: "preprocess", stage: "parsing", progress: 15 });
    const parsed = await parsePdfText(new Uint8Array(bytes), (pageNumber, pageCount) => {
      update(jobId, { status: "running", phase: "preprocess", stage: "parsing", progress: Math.round(15 + (pageNumber / pageCount) * 35) });
    });
    const { pages, pageCount, textPageCount, textCoverage, textMode } = parsed;
    if (textPageCount === 0) {
      throw new AnalysisPipelineError({ cause: "报告没有可用文本层，可能是扫描件。", impact: "正文证据尚未抽取，EASS、IR 与 UPR 暂不可计算。", nextAction: "当前 MVP 仅支持文本型 PDF；请上传文本版，或在后续 OCR Worker 上线后重试。" });
    }

    update(jobId, {
      status: "running", phase: "preprocess", stage: "segmenting", progress: 56,
      document: { documentId: context.documentId, fileName: context.fileName, fileSize: context.fileSize, fileHash: context.fileHash, pageCount, textPageCount, textCoverage },
    });
    const score = netdiskCompanyScores().find((item) => item.companyId === context.companyId && item.reportYear === context.reportYear)
      ?? netdiskCompanyScores().find((item) => item.companyId === context.companyId);
    const document: NetdiskPdfDocumentInput = {
      documentId: context.documentId,
      fsid: `local-upload:${context.documentId}`,
      filename: context.fileName,
      size: context.fileSize,
      md5: context.fileHash,
      stockCode: score?.stockCode,
      companyName: score?.companyName,
      reportYear: context.reportYear,
      kind: "esg_report",
      pageCount,
      textPageCount,
      textCoverage,
      textMode,
      pages,
    };

    update(jobId, { status: "running", phase: "extract", stage: "extracting", progress: 65 });
    ingestNetdiskPdfDocuments([document], true);
    persistNetdiskPdfState();

    update(jobId, { status: "running", phase: "classify", stage: "classifying", progress: 78 });
    const evidence = persistedEvidenceItems(context.companyId, context.reportYear).filter((item) => item.documentId === context.documentId);
    const aspects = persistedEnvironmentalAspects(context.companyId, context.reportYear).filter((item) => item.documentId === context.documentId);
    const classified = evidence.filter((item) => item.actionClass);
    const implemented = classified.filter((item) => item.actionClass === "implemented").length;
    const planning = classified.filter((item) => item.actionClass === "planning").length;
    const indeterminate = classified.filter((item) => item.actionClass === "indeterminate").length;
    const unverifiedPlans = classified.filter((item) => item.actionClass === "planning" && item.status === "insufficient").length;
    const total = implemented + planning + indeterminate;

    update(jobId, { status: "running", phase: "calculate", stage: "calculating", progress: 90 });
    const calculationStatus = total > 0 ? "calculated" as const : "unavailable" as const;
    const result: NonNullable<AnalysisJob["result"]> = {
      eass: total ? (implemented + 0.5 * planning) / total : null,
      ir: total ? indeterminate / total : null,
      upr: planning ? unverifiedPlans / planning : null,
      evidenceCount: evidence.length,
      environmentalAspectCount: aspects.length,
      calculationStatus,
      unavailableReason: total ? undefined : "PDF 中没有召回可分类的环境行动句段。",
      parserVersion: PDF_PARSER_VERSION,
      extractorVersion: CURRENT_EVIDENCE_EXTRACTOR_VERSION,
      formulaVersion: PDF_FORMULA_VERSION,
      calculatedAt: new Date().toISOString(),
    };

    update(jobId, { status: "running", phase: "risk", stage: "linking", progress: 97, result });
    const completedAt = new Date().toISOString();
    updateAnalysisJobRecord(jobId, { status: "completed", phase: "risk", stage: "completed", progress: 100, result, completedAt, error: undefined });
  } catch (error) {
    if (cancelled(jobId)) return;
    updateAnalysisJobRecord(jobId, { status: "failed", stage: "failed", completedAt: new Date().toISOString(), error: pipelineFailure(error) });
  }
}
