"use client";

import { AlertTriangle, Check, ChevronRight, FileText, Minimize2, Play, RotateCcw, Square, UploadCloud } from "lucide-react";
import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { analysisRepository, analysisRepositoryMode } from "@/repositories";
import { useDemoStore, defaultYear } from "@/stores/demo-store";
import { formatMetricPercent, formatPercent, type AnalysisJob, type CompanyYearRecord } from "@/types";

type Phase = "idle" | "validating" | "preprocessing" | "extracting" | "classifying" | "calculating" | "risk" | "complete" | "failed" | "ocr";
const steps: Array<{ id: Phase; label: string; detail: string; duration: number }> = [
  { id: "validating", label: "报告采集与校验", detail: "collect_ESG_reports", duration: 500 },
  { id: "preprocessing", label: "文本预处理", detail: "词数、句子与 Token", duration: 700 },
  { id: "extracting", label: "ESG 特征与关注度", detail: "Count / Focus / Imbalance", duration: 850 },
  { id: "classifying", label: "环境行动分类", detail: "Implemented / Planning / Indeterminate", duration: 800 },
  { id: "calculating", label: "核心指标计算", detail: "EASS / IR / UPR / ESI", duration: 850 },
  { id: "risk", label: "调整指数与风险分级", detail: "EAA-ESI / risk_classification", duration: 650 },
];

const jobPhaseMap: Record<AnalysisJob["phase"], Phase> = {
  collect: "validating",
  preprocess: "preprocessing",
  extract: "extracting",
  classify: "classifying",
  calculate: "calculating",
  risk: "risk",
};

export default function ReportsPage() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [company, setCompany] = useState("");
  const [year, setYear] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [completed, setCompleted] = useState<Phase[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [retryJobId, setRetryJobId] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<AnalysisJob["error"]>();
  const [completedJob, setCompletedJob] = useState<AnalysisJob | null>(null);
  const [companyRecords, setCompanyRecords] = useState<CompanyYearRecord[]>([]);
  const [resultRecord, setResultRecord] = useState<CompanyYearRecord | null>(null);
  const { notify, showToast } = useDemoStore();
  const companyOptions = useMemo(() => Array.from(new Map(companyRecords.map((record) => [record.companyId, record])).values()), [companyRecords]);
  const resolvedCompany = company || companyOptions[0]?.companyId || "";
  const resolvedYear = year || String(companyRecords.find((record) => record.companyId === resolvedCompany)?.reportYear ?? defaultYear);
  const yearOptions = useMemo(() => Array.from(new Set(companyRecords.filter((record) => record.companyId === resolvedCompany).map((record) => record.reportYear))).sort((a, b) => b - a), [companyRecords, resolvedCompany]);

  useEffect(() => {
    let active = true;
    analysisRepository.listCompanies()
      .then((records) => { if (active) setCompanyRecords(records); })
      .catch((reason) => { if (active) showToast(`检测选项载入失败：${reason instanceof Error ? reason.message : "数据接口未响应"}。请检查接口后重试。`); });
    return () => { active = false; };
  }, [showToast]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const job = await analysisRepository.getAnalysisJob(jobId!);
        if (cancelled) return;
        const currentPhase = jobPhaseMap[job.phase];
        const currentIndex = steps.findIndex((step) => step.id === currentPhase);
        setCompleted(steps.slice(0, job.status === "completed" ? steps.length : Math.max(0, currentIndex)).map((step) => step.id));

        if (job.status === "completed") {
          const record = await analysisRepository.getCompany(job.resultCompanyId ?? resolvedCompany, "success", Number(resolvedYear));
          if (!record) throw new Error("任务已完成，但未返回匹配的公司年度结果。");
          setResultRecord(record);
          setCompletedJob(job);
          setPhase("complete");
          setJobId(null);
          setRetryJobId(null);
          notify("报告检测完成", `${file?.name} 的${job.result ? "真实 PDF" : "合成"}分析已生成。`);
          showToast("报告检测已完成");
          return;
        }
        if (job.status === "cancelled") {
          setPhase("idle");
          setJobId(null);
          showToast("检测任务已取消，已上传文件保留用于重新提交");
          return;
        }
        if (job.status === "failed") {
          setTaskError(job.error);
          const needsOcr = Boolean(job.error?.nextAction.includes("OCR") && (analysisRepositoryMode === "http" || file?.name.toLowerCase().includes("scan")));
          setPhase(needsOcr ? "ocr" : "failed");
          setRetryJobId(job.jobId);
          setJobId(null);
          return;
        }

        setPhase(currentPhase);
        timer = setTimeout(poll, 350);
      } catch (reason) {
        if (cancelled) return;
        setTaskError({ cause: reason instanceof Error ? reason.message : "任务状态请求失败。", impact: "当前无法确认检测进度与结果。", nextAction: "检查数据接口后重新提交任务。" });
        setPhase("failed");
        setJobId(null);
      }
    }

    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [jobId, file?.name, notify, resolvedCompany, resolvedYear, showToast]);

  function accept(candidate?: File) {
    if (!candidate) return;
    if (candidate.type !== "application/pdf" && !candidate.name.toLowerCase().endsWith(".pdf")) { showToast("请选择 PDF 文件"); return; }
    if (candidate.size > 30 * 1024 * 1024) { showToast("文件超过 30MB 限制"); return; }
    setFile(candidate); setPhase("idle"); setCompleted([]); setJobId(null); setRetryJobId(null); setTaskError(undefined); setResultRecord(null); setCompletedJob(null);
  }
  function drop(event: DragEvent) { event.preventDefault(); accept(event.dataTransfer.files[0]); }
  async function start(candidate = file) { if (!candidate) return; try { const job = await analysisRepository.createAnalysisJob({ companyId: resolvedCompany, reportYear: Number(resolvedYear), fileName: candidate.name, fileSize: candidate.size, file: candidate }); setCompleted([]); setRetryJobId(null); setTaskError(undefined); setResultRecord(null); setCompletedJob(null); setPhase("validating"); setJobId(job.jobId); } catch (reason) { showToast(reason instanceof Error ? reason.message : "无法创建检测任务"); } }
  function retryWithOcr() { if (!file) return; const candidate = new File([file], file.name.replace(/broken|scan/ig, "ocr"), { type: file.type }); setFile(candidate); void start(candidate); }
  async function retry() { if (analysisRepositoryMode === "http" && retryJobId) { try { const job = await analysisRepository.retryAnalysisJob(retryJobId); setTaskError(undefined); setPhase("validating"); setJobId(job.jobId); setRetryJobId(null); } catch (reason) { showToast(reason instanceof Error ? reason.message : "无法重试检测任务"); } return; } retryWithOcr(); }
  async function cancel() { if (!jobId) return; try { await analysisRepository.cancelAnalysisJob(jobId); setJobId(null); setPhase("idle"); showToast("检测任务已取消"); } catch (reason) { showToast(reason instanceof Error ? reason.message : "无法取消检测任务"); } }
  function reset() { setFile(null); setPhase("idle"); setCompleted([]); setJobId(null); setRetryJobId(null); setTaskError(undefined); setResultRecord(null); setCompletedJob(null); }
  function downloadResult() {
    const live = completedJob?.result;
    const text = `${live ? "研究辅助信号：结果来自用户上传 PDF 的规则抽取，须由研究人员核验，不构成漂绿判定。" : "演示数据：企业、事件、报告与指标均为合成内容，不代表任何真实主体。"}\n\nGreenLens 报告检测摘要\n文件：${file?.name}\n报告年度：${resultRecord?.reportYear ?? resolvedYear}\nEASS：${live ? (live.eass == null ? "暂不可计算" : `${Math.round(live.eass * 100)}%`) : resultRecord ? formatMetricPercent(resultRecord,"EASS") : "--"}\nIR：${live ? (live.ir == null ? "暂不可计算" : `${Math.round(live.ir * 100)}%`) : resultRecord ? formatMetricPercent(resultRecord,"IR") : "--"}\nUPR：${live ? (live.upr == null ? "暂不可计算" : `${Math.round(live.upr * 100)}%`) : resultRecord ? formatMetricPercent(resultRecord,"UPR") : "--"}\nEAA-ESI：${live ? "暂不可计算（完整 ESI 模型未接通）" : formatPercent(resultRecord?.finalIndex)}\n${live ? `解析器：${live.parserVersion}\n抽取器：${live.extractorVersion}\n公式：${live.formulaVersion}\n计算时间：${live.calculatedAt}\n` : ""}`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `greenlens-report-${live ? "analysis" : "demo"}-${new Date().toISOString().slice(0, 10)}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("分析摘要已下载");
  }
  const running = steps.some((step) => step.id === phase);
  const liveResult = completedJob?.result;
  const metricPercent = (value: number | null | undefined, fallback: string) => value == null ? fallback : `${Math.round(value * 100)}%`;

  return <div className="page reports-page">
    <header className="page-header"><div><h2>报告检测</h2><p>{analysisRepositoryMode === "http" ? "PDF 将进入本地私有存储，并由真实解析与证据抽取任务处理。" : "自动化验收使用确定性合成任务，不上传文件正文。"}</p></div>{running && <div className="header-actions"><button className="quiet-button" onClick={() => void cancel()}><Square size={14}/>取消任务</button><button className="secondary-button" onClick={() => { notify("检测任务在后台运行", file?.name ?? "报告"); showToast("任务已最小化"); }}><Minimize2 size={15}/>最小化任务</button></div>}</header>
    {phase === "idle" && <div className="report-setup"><section className={`upload-zone ${file ? "has-file" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={drop}><input ref={input} type="file" accept="application/pdf" aria-label="选择待检测的 PDF 报告" onChange={(event) => accept(event.target.files?.[0])}/>{file ? <><FileText size={34}/><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(2)} MB · PDF</span><button className="text-button" onClick={() => input.current?.click()}>更换文件</button></> : <><UploadCloud size={36}/><strong>拖入 PDF 报告</strong><span>或点击选择文件 · 单个文件不超过 30MB</span><button className="secondary-button" onClick={() => input.current?.click()}>选择 PDF</button></>}</section><section className="panel report-options"><header className="panel-header"><h3>检测设置</h3><span>{analysisRepositoryMode === "http" ? "真实任务" : "合成任务"}</span></header><div className="panel-body form-stack"><label><span>关联公司</span><select value={resolvedCompany} onChange={(e)=>{setCompany(e.target.value);setYear("");}}>{companyOptions.map((record)=><option value={record.companyId} key={record.companyId}>{record.companyName}</option>)}</select></label><label><span>报告年度</span><select value={resolvedYear} onChange={(e)=>setYear(e.target.value)}>{yearOptions.map((item)=><option key={item}>{item}</option>)}</select></label><div className="privacy-note"><Check size={16}/><span><strong>{analysisRepositoryMode === "http" ? "本地私有处理" : "自动化验收模式"}</strong>{analysisRepositoryMode === "http" ? "文件正文会保存到本机私有运行目录，用于解析、重试和证据回链。" : "仅使用文件名驱动确定性流程，不保存正文。"}</span></div><button className="primary-button" disabled={!file || !companyOptions.length || !yearOptions.length} onClick={() => void start()}><Play size={15}/>上传并开始检测</button></div></section></div>}
    {phase !== "idle" && phase !== "complete" && <section className="panel task-panel">
      <header className="panel-header"><div><h3>{file?.name}</h3><p>{resolvedCompany} · {resolvedYear} · {analysisRepositoryMode === "http" ? "SQLite 持久任务" : "Repository 验收任务"}</p></div><span className="status-chip pending">{phase === "failed" ? "检测失败" : phase === "ocr" ? "需要 OCR" : "处理中"}</span></header>
      <div className="task-layout">
        <div className="task-stepper">{steps.map((step,index) => { const active=phase===step.id; const done=completed.includes(step.id); const failed=(phase==="failed" || phase==="ocr") && step.id==="extracting"; return <div className={`task-step ${active?"active":""} ${done?"done":""} ${failed?"failed":""}`} key={step.id}><span>{done?<Check size={15}/>:failed?<AlertTriangle size={15}/>:index+1}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div><em>{done?"已完成":active?"进行中":"等待"}</em></div>; })}</div>
        {phase === "failed" && <ErrorBlock title="报告检测未完成" cause={taskError?.cause} impact={taskError?.impact} next={taskError?.nextAction} onRetry={() => void retry()} />}
        {phase === "ocr" && <div className="task-callout"><AlertTriangle/><div><h3>{analysisRepositoryMode === "http" ? "当前文件需要 OCR" : "建议启用 OCR"}</h3><p><strong>成因：</strong>{taskError?.cause}</p><p><strong>影响：</strong>{taskError?.impact}</p><p><strong>下一步：</strong>{taskError?.nextAction}</p><button className="primary-button" onClick={analysisRepositoryMode === "http" ? () => setPhase("idle") : retryWithOcr}>{analysisRepositoryMode === "http" ? "返回并更换文件" : "启用演示 OCR"}</button></div></div>}
      </div>
    </section>}
    {phase === "complete" && resultRecord && <section className="report-result"><header><span className="result-check"><Check/></span><div><span className="section-kicker">检测完成</span><h2>{liveResult ? "PDF 证据分析已生成" : "合成分析已生成"}</h2><p>{file?.name} · {resultRecord.reportYear}{completedJob?.document?.deduplicated ? " · 已复用相同哈希结果" : ""}</p></div></header><div className="result-strip metric-result-strip"><div><span>文本处理</span><strong>{liveResult ? `${completedJob?.document?.textPageCount ?? 0} / ${completedJob?.document?.pageCount ?? 0} 页` : `${resultRecord.textProcessing.totalWords.toLocaleString()} 词`}</strong><small>{liveResult ? `${liveResult.evidenceCount} 条证据 · ${liveResult.environmentalAspectCount} 个环境议题` : `${resultRecord.textProcessing.environmentalSentenceCount.toLocaleString()} 条环境句 · ${resultRecord.textProcessing.tokenCount.toLocaleString()} Tokens`}</small></div><div><span>EASS</span><strong className="risk-score">{metricPercent(liveResult?.eass, formatMetricPercent(resultRecord,"EASS"))}</strong><small>环境行动实质性</small></div><div><span>IR / UPR</span><strong className="risk-score">{metricPercent(liveResult?.ir, formatMetricPercent(resultRecord,"IR"))} / {metricPercent(liveResult?.upr, liveResult ? "暂不可算" : formatMetricPercent(resultRecord,"UPR"))}</strong><small>模糊声明 / 未验证计划</small></div><div><span>EAA-ESI</span><strong className="risk-score">{liveResult ? "暂不可评分" : formatPercent(resultRecord.finalIndex)}</strong><small>{liveResult ? "完整 ESI 模型未接通，不以 0 代替" : resultRecord.riskBand === "high" ? "高风险，建议复核" : resultRecord.riskBand === "medium" ? "中风险，建议核验" : resultRecord.riskBand === "low" ? "低风险信号" : "暂不可评分"}</small></div></div>{liveResult && <p className="report-version-note">解析 {liveResult.parserVersion} · 抽取 {liveResult.extractorVersion} · 公式 {liveResult.formulaVersion}</p>}<div className="header-actions"><button className="quiet-button" onClick={reset}><RotateCcw size={15}/>新建检测</button><button className="secondary-button" onClick={downloadResult}><FileText size={15}/>下载分析摘要</button><button className="primary-button" onClick={() => router.push(`/companies/${resultRecord.companyId}?year=${resultRecord.reportYear}`)}>打开证据分析 <ChevronRight size={15}/></button></div></section>}
  </div>;
}

function ErrorBlock({ title, cause, impact, next, onRetry }: { title:string; cause?:string; impact?:string; next?:string; onRetry:()=>void }) { return <div className="task-callout error"><AlertTriangle/><div><h3>{title}</h3><p><strong>成因：</strong>{cause ?? "任务状态不可用。"}</p><p><strong>影响：</strong>{impact ?? "当前无法确认检测结果。"}</p><p><strong>下一步：</strong>{next ?? "检查数据接口后重新提交任务。"}</p><button className="primary-button" onClick={onRetry}>重试任务</button></div></div>; }
