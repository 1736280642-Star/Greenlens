"use client";

import { AlertTriangle, Check, ChevronRight, FileText, Minimize2, Play, RotateCcw, UploadCloud } from "lucide-react";
import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { analysisRepository } from "@/repositories";
import { useDemoStore, defaultYear } from "@/stores/demo-store";
import { formatMetricPercent, formatPercent, type AnalysisJob, type CompanyYearRecord } from "@/types";

type Phase = "idle" | "validating" | "preprocessing" | "extracting" | "classifying" | "calculating" | "risk" | "complete" | "failed" | "ocr";
const steps: Array<{ id: Phase; label: string; detail: string; duration: number }> = [
  { id: "validating", label: "报告采集与校验", detail: "collect_ESG_reports", duration: 500 },
  { id: "preprocessing", label: "文本预处理", detail: "词数、句子与 Token", duration: 700 },
  { id: "extracting", label: "ESG 特征与关注度", detail: "Count / Focus / Imbalance", duration: 850 },
  { id: "classifying", label: "环境行动分类", detail: "Implemented / Planning / Indeterminate", duration: 800 },
  { id: "calculating", label: "核心指标计算", detail: "EASS / IR / UPR / ESGSI", duration: 850 },
  { id: "risk", label: "调整指数与风险分级", detail: "E-AA-ESGSI / risk_classification", duration: 650 },
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
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [company, setCompany] = useState("");
  const [year, setYear] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [completed, setCompleted] = useState<Phase[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<AnalysisJob["error"]>();
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
          setPhase("complete");
          setJobId(null);
          notify("报告检测完成", `${file?.name} 的合成分析已生成。`);
          showToast("报告检测已完成");
          return;
        }
        if (job.status === "failed") {
          setTaskError(job.error);
          setPhase(job.error?.nextAction.includes("OCR") && file?.name.toLowerCase().includes("scan") ? "ocr" : "failed");
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
    setFile({ name: candidate.name, size: candidate.size }); setPhase("idle"); setCompleted([]); setJobId(null); setTaskError(undefined); setResultRecord(null);
  }
  function drop(event: DragEvent) { event.preventDefault(); accept(event.dataTransfer.files[0]); }
  async function start(candidate = file) { if (!candidate) return; try { const job = await analysisRepository.createAnalysisJob({ companyId: resolvedCompany, reportYear: Number(resolvedYear), fileName: candidate.name, fileSize: candidate.size }); setCompleted([]); setTaskError(undefined); setResultRecord(null); setPhase("validating"); setJobId(job.jobId); } catch (reason) { showToast(reason instanceof Error ? reason.message : "无法创建检测任务"); } }
  function retryWithOcr() { if (!file) return; const candidate = { ...file, name: file.name.replace(/broken|scan/ig, "ocr") }; setFile(candidate); void start(candidate); }
  function reset() { setFile(null); setPhase("idle"); setCompleted([]); setJobId(null); setTaskError(undefined); setResultRecord(null); }
  function downloadResult() {
    const text = `演示数据：企业、事件、报告与指标均为合成内容，不代表任何真实主体。\n\nGreenLens 报告检测摘要\n文件：${file?.name}\n报告年度：${resultRecord?.reportYear ?? resolvedYear}\nEASS：${resultRecord ? formatMetricPercent(resultRecord,"EASS") : "--"}\nIR：${resultRecord ? formatMetricPercent(resultRecord,"IR") : "--"}\nUPR：${resultRecord ? formatMetricPercent(resultRecord,"UPR") : "--"}\nE-AA-ESGSI：${formatPercent(resultRecord?.finalIndex)}\nSchema：metric-contract-v2\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `greenlens-report-demo-${new Date().toISOString().slice(0, 10)}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("演示摘要已下载");
  }
  const running = steps.some((step) => step.id === phase);

  return <div className="page reports-page">
    <header className="page-header"><div><h2>报告检测</h2><p>文件只在浏览器中读取名称、类型和大小，不读取正文、不上传。</p></div>{running && <button className="secondary-button" onClick={() => { notify("检测任务在后台运行", file?.name ?? "合成报告"); showToast("任务已最小化"); }}><Minimize2 size={15}/>最小化任务</button>}</header>
    {phase === "idle" && <div className="report-setup"><section className={`upload-zone ${file ? "has-file" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={drop}><input ref={input} type="file" accept="application/pdf" aria-label="选择待检测的 PDF 报告" onChange={(event) => accept(event.target.files?.[0])}/>{file ? <><FileText size={34}/><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(2)} MB · PDF</span><button className="text-button" onClick={() => input.current?.click()}>更换文件</button></> : <><UploadCloud size={36}/><strong>拖入 PDF 报告</strong><span>或点击选择文件 · 单个文件不超过 30MB</span><button className="secondary-button" onClick={() => input.current?.click()}>选择 PDF</button></>}</section><section className="panel report-options"><header className="panel-header"><h3>检测设置</h3><span>合成任务</span></header><div className="panel-body form-stack"><label><span>虚构公司</span><select value={resolvedCompany} onChange={(e)=>{setCompany(e.target.value);setYear("");}}>{companyOptions.map((record)=><option value={record.companyId} key={record.companyId}>{record.companyName}</option>)}</select></label><label><span>报告年度</span><select value={resolvedYear} onChange={(e)=>setYear(e.target.value)}>{yearOptions.map((item)=><option key={item}>{item}</option>)}</select></label><div className="privacy-note"><Check size={16}/><span><strong>本地演示模式</strong>不会读取或保存文件正文。</span></div><button className="primary-button" disabled={!file || !companyOptions.length || !yearOptions.length} onClick={() => void start()}><Play size={15}/>开始检测</button></div></section></div>}
    {phase !== "idle" && phase !== "complete" && <section className="panel task-panel"><header className="panel-header"><div><h3>{file?.name}</h3><p>{resolvedCompany} · {resolvedYear} · Repository 任务状态</p></div><span className="status-chip pending">{phase === "failed" ? "检测失败" : phase === "ocr" ? "需要 OCR" : "处理中"}</span></header><div className="task-layout"><div className="task-stepper">{steps.map((step,index) => { const active=phase===step.id; const done=completed.includes(step.id); const failed=(phase==="failed" || phase==="ocr") && step.id==="extracting"; return <div className={`task-step ${active?"active":""} ${done?"done":""} ${failed?"failed":""}`} key={step.id}><span>{done?<Check size={15}/>:failed?<AlertTriangle size={15}/>:index+1}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div><em>{done?"已完成":active?"进行中":"等待"}</em></div>; })}</div>{phase === "failed" && <ErrorBlock title="报告检测未完成" cause={taskError?.cause} impact={taskError?.impact} next={taskError?.nextAction} onRetry={retryWithOcr} />}{phase === "ocr" && <div className="task-callout"><AlertTriangle/><div><h3>建议启用 OCR</h3><p><strong>成因：</strong>{taskError?.cause}</p><p><strong>影响：</strong>{taskError?.impact}</p><p><strong>下一步：</strong>{taskError?.nextAction}</p><button className="primary-button" onClick={retryWithOcr}>启用演示 OCR</button></div></div>}</div></section>}
    {phase === "complete" && resultRecord && <section className="report-result"><header><span className="result-check"><Check/></span><div><span className="section-kicker">检测完成</span><h2>合成分析已生成</h2><p>{file?.name} · {resultRecord.reportYear} · metric-contract-v2</p></div></header><div className="result-strip metric-result-strip"><div><span>文本处理</span><strong>{resultRecord.textProcessing.totalWords.toLocaleString()} 词</strong><small>{resultRecord.textProcessing.environmentalSentenceCount.toLocaleString()} 条环境句 · {resultRecord.textProcessing.tokenCount.toLocaleString()} Tokens</small></div><div><span>EASS</span><strong className="risk-score">{formatMetricPercent(resultRecord,"EASS")}</strong><small>环境行动实质性</small></div><div><span>IR / UPR</span><strong className="risk-score">{formatMetricPercent(resultRecord,"IR")} / {formatMetricPercent(resultRecord,"UPR")}</strong><small>模糊声明 / 未验证计划</small></div><div><span>E-AA-ESGSI</span><strong className="risk-score">{formatPercent(resultRecord.finalIndex)}</strong><small>{resultRecord.riskBand === "high" ? "高风险，建议复核" : resultRecord.riskBand === "medium" ? "中风险，建议核验" : resultRecord.riskBand === "low" ? "低风险信号" : "暂不可评分"}</small></div></div><div className="header-actions"><button className="quiet-button" onClick={reset}><RotateCcw size={15}/>新建检测</button><button className="secondary-button" onClick={downloadResult}><FileText size={15}/>下载演示摘要</button><button className="primary-button" onClick={() => router.push(`/companies/${resultRecord.companyId}?year=${resultRecord.reportYear}`)}>打开完整分析 <ChevronRight size={15}/></button></div></section>}
  </div>;
}

function ErrorBlock({ title, cause, impact, next, onRetry }: { title:string; cause?:string; impact?:string; next?:string; onRetry:()=>void }) { return <div className="task-callout error"><AlertTriangle/><div><h3>{title}</h3><p><strong>成因：</strong>{cause ?? "任务状态不可用。"}</p><p><strong>影响：</strong>{impact ?? "当前无法确认检测结果。"}</p><p><strong>下一步：</strong>{next ?? "检查数据接口后重新提交任务。"}</p><button className="primary-button" onClick={onRetry}>重新提交演示任务</button></div></div>; }
