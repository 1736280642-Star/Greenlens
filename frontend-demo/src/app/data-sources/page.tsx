"use client";

import { AlertTriangle, CheckCircle2, Database, FileSpreadsheet, FileText, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { analysisRepositoryMode } from "@/repositories";

interface SourceStatus { connectionStatus: "connected" | "degraded" | "unavailable"; lastSyncedAt?: string; fileCount: number; readyFileCount: number; schemaPendingFileCount: number; }
interface RecordSummary { financialRecordCount: number; companyScoreRecordCount: number; companyScoreSourceFileCount: number; companyIndustryRecordCount: number; companyIndustrySourceFileCount: number; esgRatingRecordCount: number; esgRatingVendorCount: number; esgRatingSourceFileCount: number; violationEventCount: number; pdfDocumentCount: number; esgDocumentCount: number; negativeNewsDocumentCount: number; documentEvidenceCount: number; environmentalAspectCount: number; ocrRequiredDocumentCount: number; companyCount: number; yearFrom: number | null; yearTo: number | null; }
interface SourceFile { kind: string; parseStatus: string; }
interface QueueSummary { total: number; counts: Record<string, number>; failureCategories: Record<string, number>; deferred: number; current: { filename: string; attempts: number } | null; }
interface EvidenceFunnel { completedDocuments: number; documentsWithTextPages: number; identityResolvedDocuments: number; evidenceExtractedDocuments: number; linkedCompanyYearDocuments: number; identityUnresolvedDocuments: number; extractionFailedDocuments: number; scoreUnmatchedDocuments: number; }
interface EvidencePreview extends EvidenceFunnel { candidateDocuments: number; sampledDocuments: number; sampledEvidenceExtractable: number; estimatedAutoLinked: number; estimatedManualReview: number; extractorVersion: string; }
interface EvidenceRun { jobId: string; status: "queued" | "running" | "completed" | "completed_with_warnings" | "failed"; totalCandidates: number; processed: number; succeeded: number; failed: number; error?: { cause: string; impact: string; nextAction: string }; }

const emptySummary: RecordSummary = { financialRecordCount: 0, companyScoreRecordCount: 0, companyScoreSourceFileCount: 0, companyIndustryRecordCount: 0, companyIndustrySourceFileCount: 0, esgRatingRecordCount: 0, esgRatingVendorCount: 0, esgRatingSourceFileCount: 0, violationEventCount: 0, pdfDocumentCount: 0, esgDocumentCount: 0, negativeNewsDocumentCount: 0, documentEvidenceCount: 0, environmentalAspectCount: 0, ocrRequiredDocumentCount: 0, companyCount: 0, yearFrom: null, yearTo: null };
const emptyQueue: QueueSummary = { total: 0, counts: {}, failureCategories: {}, deferred: 0, current: null };
async function readSourceData() {
  const [statusResponse, summaryResponse, filesResponse, queueResponse, funnelResponse] = await Promise.all([
    fetch("/api/v1/data-sources/baidu-netdisk/status", { cache: "no-store" }),
    fetch("/api/v1/data-sources/baidu-netdisk/records", { cache: "no-store" }),
    fetch("/api/v1/data-sources/baidu-netdisk/files", { cache: "no-store" }),
    fetch("/api/v1/data-sources/baidu-netdisk/pdf-queue", { cache: "no-store" }),
    fetch("/api/v1/data-sources/baidu-netdisk/evidence-reindex", { cache: "no-store" }),
  ]);
  if (!statusResponse.ok || !summaryResponse.ok || !filesResponse.ok || !queueResponse.ok || !funnelResponse.ok) throw new Error("数据源接口未完整响应");
  const funnelPayload = await funnelResponse.json() as { funnel: EvidenceFunnel };
  return { status: await statusResponse.json(), summary: await summaryResponse.json(), files: await filesResponse.json(), queue: await queueResponse.json(), funnel: funnelPayload.funnel } as { status: SourceStatus; summary: RecordSummary; files: SourceFile[]; queue: QueueSummary; funnel: EvidenceFunnel };
}

export default function DataSourcesPage() {
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [summary, setSummary] = useState<RecordSummary>(emptySummary);
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [queue, setQueue] = useState<QueueSummary>(emptyQueue);
  const [funnel, setFunnel] = useState<EvidenceFunnel>({ completedDocuments: 0, documentsWithTextPages: 0, identityResolvedDocuments: 0, evidenceExtractedDocuments: 0, linkedCompanyYearDocuments: 0, identityUnresolvedDocuments: 0, extractionFailedDocuments: 0, scoreUnmatchedDocuments: 0 });
  const [preview, setPreview] = useState<EvidencePreview>();
  const [reindexRun, setReindexRun] = useState<EvidenceRun>();
  const [reindexBusy, setReindexBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setError(undefined);
    try {
      const result = await readSourceData(); setStatus(result.status); setSummary(result.summary); setFiles(result.files); setQueue(result.queue); setFunnel(result.funnel);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "数据源状态读取失败"); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    void readSourceData().then((result) => { if (active) { setStatus(result.status); setSummary(result.summary); setFiles(result.files); setQueue(result.queue); setFunnel(result.funnel); } }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "数据源状态读取失败"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const financeFiles = files.filter((file) => file.kind === "financial_workbook").length;
  const violationFiles = files.filter((file) => file.kind === "violation_workbook").length;
  const failureEntries = Object.entries(queue.failureCategories ?? {});
  const acquisitionFailures = failureEntries.filter(([category]) => category.startsWith("zip_") || category.startsWith("source_")).reduce((sum, [, count]) => sum + count, 0);
  const parsingFailures = failureEntries.filter(([category]) => category.startsWith("pdf_")).reduce((sum, [, count]) => sum + count, 0);
  const publishFailures = failureEntries.filter(([category]) => category.startsWith("backend_")).reduce((sum, [, count]) => sum + count, 0);
  const classifiedFailures = acquisitionFailures + parsingFailures + publishFailures;
  const otherFailures = Math.max((queue.counts.failed ?? 0) - classifiedFailures, 0);

  useEffect(() => {
    if (!reindexRun || !["queued", "running"].includes(reindexRun.status)) return;
    const timer = setInterval(() => {
      void fetch(`/api/v1/data-sources/baidu-netdisk/evidence-reindex/${reindexRun.jobId}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("重建任务状态读取失败")))
        .then((next: EvidenceRun) => {
          setReindexRun(next);
          if (!["queued", "running"].includes(next.status)) void load();
        })
        .catch((reason) => setError(reason instanceof Error ? reason.message : "重建任务状态读取失败"));
    }, 1200);
    return () => clearInterval(timer);
  }, [reindexRun]);

  async function previewMissingEvidence() {
    setReindexBusy(true); setError(undefined);
    try {
      const response = await fetch("/api/v1/data-sources/baidu-netdisk/evidence-reindex", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "missing_only", kind: "esg_report", extractorVersion: "evidence-rules-v2", dryRun: true, batchSize: 50 }) });
      const payload = await response.json() as { preview?: EvidencePreview; cause?: string };
      if (!response.ok || !payload.preview) throw new Error(payload.cause ?? "缺失证据预检查失败");
      setPreview(payload.preview);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "缺失证据预检查失败"); }
    finally { setReindexBusy(false); }
  }

  async function startMissingEvidenceReindex() {
    if (!preview) return;
    setReindexBusy(true); setError(undefined);
    try {
      const response = await fetch("/api/v1/data-sources/baidu-netdisk/evidence-reindex", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "missing_only", kind: "esg_report", extractorVersion: preview.extractorVersion, dryRun: false, batchSize: 20 }) });
      const payload = await response.json() as { run?: EvidenceRun; cause?: string };
      if (!response.ok || !payload.run) throw new Error(payload.cause ?? "证据重建任务创建失败");
      setReindexRun(payload.run); setPreview(undefined);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "证据重建任务创建失败"); }
    finally { setReindexBusy(false); }
  }

  return <div className="page source-page">
    <header className="page-header source-header"><div><span className="section-kicker">READ-ONLY PIPELINE</span><h2>百度网盘数据接入</h2><p>网盘文件只在内存中解析；后端保存规范化记录、字段目录与任务日志。</p></div><div className="header-actions"><Link className="secondary-button" href="/data-sources/review"><AlertTriangle size={15}/>异常与质量处置</Link><button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/>{loading ? "读取中" : "刷新状态"}</button></div></header>
    {error && <div className="source-alert"><AlertTriangle size={17}/><span><strong>状态读取失败</strong>{error}，请确认本地后端仍在运行。</span></div>}
    <section className="source-status-band" aria-busy={loading}>
      <div className="source-connection"><span className={`source-pulse ${status?.connectionStatus ?? "unavailable"}`}/><div><small>连接状态</small><strong>{status?.connectionStatus === "connected" ? "已连接" : status?.connectionStatus === "degraded" ? "部分可用" : "不可用"}</strong></div></div>
      <dl><div><dt>就绪文件</dt><dd>{status ? `${status.readyFileCount} / ${status.fileCount}` : "--"}</dd></div><div><dt>证券主体</dt><dd>{summary.companyCount.toLocaleString()}</dd></div><div><dt>数据期间</dt><dd>{summary.yearFrom == null ? "--" : `${summary.yearFrom}–${summary.yearTo}`}</dd></div><div><dt>最近发布</dt><dd>{status?.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString("zh-CN", { hour12: false }) : "--"}</dd></div></dl>
    </section>
    <section className="panel evidence-funnel-panel" aria-labelledby="evidence-funnel-title">
      <header className="panel-header"><div><h3 id="evidence-funnel-title">PDF 证据处理漏斗</h3><p>解析完成不等于证据已关联；每一层都使用独立状态。</p></div><code>evidence-rules-v2</code></header>
      <div className="evidence-funnel-flow">
        {[["PDF 已完成", funnel.completedDocuments], ["正文可读取", funnel.documentsWithTextPages], ["身份已确认", funnel.identityResolvedDocuments], ["证据已抽取", funnel.evidenceExtractedDocuments], ["公司年度已关联", funnel.linkedCompanyYearDocuments]].map(([label, value], index) => <div key={String(label)}><small>0{index + 1}</small><span>{label}</span><strong>{Number(value).toLocaleString()}</strong></div>)}
      </div>
      <div className="evidence-funnel-exceptions"><span>主体或年度待确认 <strong>{funnel.identityUnresolvedDocuments.toLocaleString()}</strong></span><span>抽取失败 <strong>{funnel.extractionFailedDocuments.toLocaleString()}</strong></span><span>评分年度未匹配 <strong>{funnel.scoreUnmatchedDocuments.toLocaleString()}</strong></span></div>
      {preview ? <div className="evidence-reindex-preview"><div><strong>预检查完成</strong><p>待重建 {preview.candidateDocuments.toLocaleString()} 份；抽样 {preview.sampledDocuments} 份，其中 {preview.sampledEvidenceExtractable} 份可抽取环境陈述。预计自动关联 {preview.estimatedAutoLinked.toLocaleString()} 份，约 {preview.estimatedManualReview.toLocaleString()} 份需复核或暂无法抽取。</p></div><button className="primary-button" disabled={reindexBusy || preview.candidateDocuments === 0} onClick={() => void startMissingEvidenceReindex()}>启动缺失证据重建</button></div> : null}
      {reindexRun ? <div className={`evidence-reindex-progress ${reindexRun.status}`}><span><strong>{reindexRun.status === "running" ? "正在重建证据" : reindexRun.status === "queued" ? "等待开始" : reindexRun.status === "completed" ? "重建完成" : reindexRun.status === "completed_with_warnings" ? "完成，但有待确认项" : "重建失败"}</strong><small>{reindexRun.processed} / {reindexRun.totalCandidates} · 成功 {reindexRun.succeeded} · 待处理 {reindexRun.failed}</small></span><i><b style={{ width: `${reindexRun.totalCandidates ? reindexRun.processed / reindexRun.totalCandidates * 100 : 100}%` }}/></i>{reindexRun.error ? <p>{reindexRun.error.cause}。{reindexRun.error.nextAction}</p> : null}</div> : null}
      <footer className="evidence-funnel-actions"><p>重建直接复用 SQLite 中的分页正文，不会重新下载 PDF，也不会重新执行 OCR。</p><button className="secondary-button" disabled={reindexBusy || Boolean(reindexRun && ["queued", "running"].includes(reindexRun.status))} onClick={() => void previewMissingEvidence()}>{reindexBusy ? "预检查中…" : "预检查缺失证据"}</button></footer>
    </section>
    <section className="source-record-grid">
      <article><Database size={20}/><div><span>财务年度记录</span><strong>{summary.financialRecordCount.toLocaleString()}</strong><small>{financeFiles} 份财务工作簿 · 已按证券、截止日、报表类型和来源合并</small></div></article>
      <article><FileSpreadsheet size={20}/><div><span>违规事件记录</span><strong>{summary.violationEventCount.toLocaleString()}</strong><small>{violationFiles} 份违规工作簿 · 已按稳定事件键去重发布</small></div></article>
      <article><FileSpreadsheet size={20}/><div><span>EAA 公司评分记录</span><strong>{summary.companyScoreRecordCount.toLocaleString()}</strong><small>{summary.companyScoreSourceFileCount} 份年度评分工作簿 · 已按公司-年度去重</small></div></article>
      <article><FileSpreadsheet size={20}/><div><span>公司-行业映射</span><strong>{summary.companyIndustryRecordCount.toLocaleString()}</strong><small>{summary.companyIndustrySourceFileCount} 份行业映射 · 收敛 10 大行业 · 覆盖率 99.2%</small></div></article>
      <article><FileSpreadsheet size={20}/><div><span>外部 ESG 评级记录</span><strong>{summary.esgRatingRecordCount.toLocaleString()}</strong><small>{summary.esgRatingVendorCount} 家数据源 · {summary.esgRatingSourceFileCount} 份评级工作簿</small></div></article>
      <article><FileText size={20}/><div><span>PDF 证据记录</span><strong>{summary.documentEvidenceCount.toLocaleString()}</strong><small>{summary.pdfDocumentCount} 份文档 · 排队 {queue.counts.queued ?? 0}（延迟重试 {queue.deferred ?? 0}）· 处理中 {queue.counts.running ?? 0} · 完成 {queue.counts.completed ?? 0}</small><small>获取待恢复 {acquisitionFailures} · 文档解析失败 {parsingFailures} · 后端写入失败 {publishFailures}{otherFailures ? ` · 未分类 ${otherFailures}` : ""}</small></div></article>
    </section>
    <section className="panel source-quality"><header className="panel-header"><div><h3>发布质量</h3><p>当前后端规范化快照</p></div>{status?.schemaPendingFileCount === 0 ? <span className="source-ok"><CheckCircle2 size={15}/>工作簿已映射</span> : <span className="source-warn"><AlertTriangle size={15}/>{status?.schemaPendingFileCount} 份工作簿待映射</span>}</header><div className="panel-body"><div className="quality-meter"><span style={{ width: `${status?.fileCount ? status.readyFileCount / status.fileCount * 100 : 0}%` }}/></div><p>{analysisRepositoryMode === "http" ? "业务页正在读取后端规范化记录；AI 自动组织风险解释与引用，解析、关联和低置信度异常进入独立质量处置。证据不足不会被解释为低风险。" : "当前业务页使用合成样本进行可重复验收，不代表任何真实主体。"}</p></div></section>
  </div>;
}
