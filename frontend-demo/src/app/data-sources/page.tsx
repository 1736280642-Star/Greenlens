"use client";

import { AlertTriangle, CheckCircle2, Database, FileSpreadsheet, FileText, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { analysisRepositoryMode } from "@/repositories";

interface SourceStatus { connectionStatus: "connected" | "degraded" | "unavailable"; lastSyncedAt?: string; fileCount: number; readyFileCount: number; schemaPendingFileCount: number; }
interface RecordSummary { financialRecordCount: number; companyScoreRecordCount: number; companyScoreSourceFileCount: number; companyIndustryRecordCount: number; companyIndustrySourceFileCount: number; esgRatingRecordCount: number; esgRatingVendorCount: number; esgRatingSourceFileCount: number; violationEventCount: number; pdfDocumentCount: number; esgDocumentCount: number; negativeNewsDocumentCount: number; documentEvidenceCount: number; environmentalAspectCount: number; ocrRequiredDocumentCount: number; companyCount: number; yearFrom: number | null; yearTo: number | null; }
interface SourceFile { kind: string; parseStatus: string; }
interface QueueSummary { total: number; counts: Record<string, number>; current: { filename: string; attempts: number } | null; }

const emptySummary: RecordSummary = { financialRecordCount: 0, companyScoreRecordCount: 0, companyScoreSourceFileCount: 0, companyIndustryRecordCount: 0, companyIndustrySourceFileCount: 0, esgRatingRecordCount: 0, esgRatingVendorCount: 0, esgRatingSourceFileCount: 0, violationEventCount: 0, pdfDocumentCount: 0, esgDocumentCount: 0, negativeNewsDocumentCount: 0, documentEvidenceCount: 0, environmentalAspectCount: 0, ocrRequiredDocumentCount: 0, companyCount: 0, yearFrom: null, yearTo: null };
const emptyQueue: QueueSummary = { total: 0, counts: {}, current: null };
async function readSourceData() {
  const [statusResponse, summaryResponse, filesResponse, queueResponse] = await Promise.all([
    fetch("/api/v1/data-sources/baidu-netdisk/status", { cache: "no-store" }),
    fetch("/api/v1/data-sources/baidu-netdisk/records", { cache: "no-store" }),
    fetch("/api/v1/data-sources/baidu-netdisk/files", { cache: "no-store" }),
    fetch("/api/v1/data-sources/baidu-netdisk/pdf-queue", { cache: "no-store" }),
  ]);
  if (!statusResponse.ok || !summaryResponse.ok || !filesResponse.ok || !queueResponse.ok) throw new Error("数据源接口未完整响应");
  return { status: await statusResponse.json(), summary: await summaryResponse.json(), files: await filesResponse.json(), queue: await queueResponse.json() } as { status: SourceStatus; summary: RecordSummary; files: SourceFile[]; queue: QueueSummary };
}

export default function DataSourcesPage() {
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [summary, setSummary] = useState<RecordSummary>(emptySummary);
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [queue, setQueue] = useState<QueueSummary>(emptyQueue);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setError(undefined);
    try {
      const result = await readSourceData(); setStatus(result.status); setSummary(result.summary); setFiles(result.files); setQueue(result.queue);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "数据源状态读取失败"); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    void readSourceData().then((result) => { if (active) { setStatus(result.status); setSummary(result.summary); setFiles(result.files); setQueue(result.queue); } }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "数据源状态读取失败"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const financeFiles = files.filter((file) => file.kind === "financial_workbook").length;
  const violationFiles = files.filter((file) => file.kind === "violation_workbook").length;

  return <div className="page source-page">
    <header className="page-header source-header"><div><span className="section-kicker">READ-ONLY PIPELINE</span><h2>百度网盘数据接入</h2><p>网盘文件只在内存中解析；后端保存规范化记录、字段目录与任务日志。</p></div><div className="header-actions"><Link className="secondary-button" href="/data-sources/review"><AlertTriangle size={15}/>异常与质量处置</Link><button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/>{loading ? "读取中" : "刷新状态"}</button></div></header>
    {error && <div className="source-alert"><AlertTriangle size={17}/><span><strong>状态读取失败</strong>{error}，请确认本地后端仍在运行。</span></div>}
    <section className="source-status-band" aria-busy={loading}>
      <div className="source-connection"><span className={`source-pulse ${status?.connectionStatus ?? "unavailable"}`}/><div><small>连接状态</small><strong>{status?.connectionStatus === "connected" ? "已连接" : status?.connectionStatus === "degraded" ? "部分可用" : "不可用"}</strong></div></div>
      <dl><div><dt>就绪文件</dt><dd>{status ? `${status.readyFileCount} / ${status.fileCount}` : "--"}</dd></div><div><dt>证券主体</dt><dd>{summary.companyCount.toLocaleString()}</dd></div><div><dt>数据期间</dt><dd>{summary.yearFrom == null ? "--" : `${summary.yearFrom}–${summary.yearTo}`}</dd></div><div><dt>最近发布</dt><dd>{status?.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString("zh-CN", { hour12: false }) : "--"}</dd></div></dl>
    </section>
    <section className="source-record-grid">
      <article><Database size={20}/><div><span>财务年度记录</span><strong>{summary.financialRecordCount.toLocaleString()}</strong><small>{financeFiles} 份财务工作簿 · 已按证券、截止日、报表类型和来源合并</small></div></article>
      <article><FileSpreadsheet size={20}/><div><span>违规事件记录</span><strong>{summary.violationEventCount.toLocaleString()}</strong><small>{violationFiles} 份违规工作簿 · 已按稳定事件键去重发布</small></div></article>
      <article><FileSpreadsheet size={20}/><div><span>EAA 公司评分记录</span><strong>{summary.companyScoreRecordCount.toLocaleString()}</strong><small>{summary.companyScoreSourceFileCount} 份年度评分工作簿 · 已按公司-年度去重</small></div></article>
      <article><FileSpreadsheet size={20}/><div><span>公司-行业映射</span><strong>{summary.companyIndustryRecordCount.toLocaleString()}</strong><small>{summary.companyIndustrySourceFileCount} 份行业映射 · 收敛 10 大行业 · 覆盖率 99.2%</small></div></article>
      <article><FileSpreadsheet size={20}/><div><span>外部 ESG 评级记录</span><strong>{summary.esgRatingRecordCount.toLocaleString()}</strong><small>{summary.esgRatingVendorCount} 家数据源 · {summary.esgRatingSourceFileCount} 份评级工作簿</small></div></article>
      <article><FileText size={20}/><div><span>PDF 证据记录</span><strong>{summary.documentEvidenceCount.toLocaleString()}</strong><small>{summary.pdfDocumentCount} 份文档 · 队列 {queue.counts.queued ?? 0} · 处理中 {queue.counts.running ?? 0} · 完成 {queue.counts.completed ?? 0} · 失败 {queue.counts.failed ?? 0}</small></div></article>
    </section>
    <section className="panel source-quality"><header className="panel-header"><div><h3>发布质量</h3><p>当前后端规范化快照</p></div>{status?.schemaPendingFileCount === 0 ? <span className="source-ok"><CheckCircle2 size={15}/>工作簿已映射</span> : <span className="source-warn"><AlertTriangle size={15}/>{status?.schemaPendingFileCount} 份工作簿待映射</span>}</header><div className="panel-body"><div className="quality-meter"><span style={{ width: `${status?.fileCount ? status.readyFileCount / status.fileCount * 100 : 0}%` }}/></div><p>{analysisRepositoryMode === "http" ? "业务页正在读取后端规范化记录；AI 自动组织风险解释与引用，解析、关联和低置信度异常进入独立质量处置。证据不足不会被解释为低风险。" : "当前业务页使用合成样本进行可重复验收，不代表任何真实主体。"}</p></div></section>
  </div>;
}
