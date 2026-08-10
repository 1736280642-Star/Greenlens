"use client";

import { Check, ChevronRight, Clock3, RefreshCw, SkipForward, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { analysisRepository } from "@/repositories";
import { useDemoStore } from "@/stores/demo-store";
import { getMetric, type CompanyYearRecord, type DashboardReviewTask, type EvidenceItem, type ReviewRecord } from "@/types";

type ReviewTab = DashboardReviewTask["reviewType"] | "all";

const reviewTypes: Array<{ key: ReviewTab; label: string }> = [
  { key: "all", label: "全部" },
  { key: "action_classification", label: "行动分类" },
  { key: "EASS", label: "EASS" },
  { key: "IR", label: "IR" },
  { key: "UPR", label: "UPR" },
  { key: "risk_band", label: "风险分级" },
];

function ageLabel(hours: number) {
  return hours < 24 ? `${hours} 小时` : `${Math.floor(hours / 24)} 天`;
}

function targetType(type: DashboardReviewTask["reviewType"]): ReviewRecord["targetType"] {
  if (type === "action_classification") return "action_classification";
  if (type === "risk_band") return "risk_label";
  return "metric";
}

export default function ReviewPage() {
  const [companies, setCompanies] = useState<CompanyYearRecord[]>([]);
  const [queue, setQueue] = useState<DashboardReviewTask[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [tab, setTab] = useState<ReviewTab>("UPR");
  const [index, setIndex] = useState(0);
  const [decision, setDecision] = useState("insufficient");
  const [note, setNote] = useState("");
  const [completed, setCompleted] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { pendingReviews, setPendingReviews, saveReview, undoReview, reviews, showToast } = useDemoStore();
  const visible = useMemo(() => tab === "all" ? queue : queue.filter((item) => item.reviewType === tab), [queue, tab]);
  const current = visible[index % Math.max(1, visible.length)] ?? queue[0];
  const company = companies.find((item) => item.companyId === current?.companyId);
  const item = evidence.find((entry) => entry.id === current?.evidenceId);
  const metric = company && current ? getMetric(company, current.metricCode) : undefined;

  useEffect(() => {
    let active = true;
    Promise.all([analysisRepository.listCompanies(), analysisRepository.getDashboardInsights()])
      .then(([companyItems, insights]) => {
        if (!active) return;
        const params = new URLSearchParams(location.search);
        const industry = params.get("industry");
        const risk = params.get("risk");
        const factor = params.get("factor");
        const riskBands: Record<string, CompanyYearRecord["riskBand"]> = { "高风险": "high", "中风险": "medium", "低风险": "low", "暂不可评分": "unavailable" };
        const companyMap = new Map(companyItems.map((item) => [item.companyId, item]));
        const scopedQueue = insights.reviewTasks.filter((task) => {
          const record = companyMap.get(task.companyId);
          return record && (!industry || record.industry === industry) && (!risk || record.riskBand === riskBands[risk]) && (!factor || task.metricCode === factor);
        });
        setCompanies(companyItems);
        setQueue(scopedQueue);
        setPendingReviews(scopedQueue.length);
        if (industry || risk || factor) setTab("all");
      })
      .catch((reason: Error) => active && setError(reason.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [setPendingReviews]);

  useEffect(() => {
    if (!current) return;
    let active = true;
    const currentCompany = companies.find((item) => item.companyId === current.companyId);
    analysisRepository.listEvidence(current.companyId, "success", currentCompany?.reportYear)
      .then((items) => { if (active) setEvidence(items); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "复核证据请求失败。"); });
    return () => { active = false; };
  }, [companies, current]);

  useEffect(() => {
    if (!undoId) return;
    const timer = setTimeout(() => setUndoId(null), 8000);
    return () => clearTimeout(timer);
  }, [undoId]);

  async function save(next: boolean) {
    if (!current || !company) return;
    const id = `review-${current.id}`;
    const review: ReviewRecord = {
      id,
      targetId: current.evidenceId,
      companyId: company.companyId,
      targetType: targetType(current.reviewType),
      originalDecision: current.evidenceStatus,
      humanDecision: decision as ReviewRecord["humanDecision"],
      reasonCode: `${current.metricCode.toLowerCase()}-manual-review`,
      note,
      reviewedAt: new Date().toISOString(),
    };
    try {
      const saved = await analysisRepository.saveReview(review);
      saveReview(saved);
      setUndoId(saved.id);
      setCompleted((value) => value + 1);
      setNote("");
      if (next) setIndex((value) => value + 1);
    } catch (reason) {
      showToast(`复核保存失败：${reason instanceof Error ? reason.message : "数据接口未响应"}。请检查接口后重试。`);
    }
  }

  if (loading) return <div className="page"><div className="skeleton skeleton-header"/><div className="panel skeleton-panel"/></div>;
  if (error) return <div className="state-panel"><RefreshCw/><h2>复核队列载入失败</h2><p>成因：{error}。影响：当前无法保存人工判断。下一步：检查数据接口后重新载入页面。</p><button className="primary-button" onClick={() => location.reload()}>重新载入</button></div>;
  if (!queue.length) return <div className="state-panel"><RefreshCw/><h2>当前筛选下没有复核任务</h2><p>Dashboard 传入的行业、风险或指标组合没有匹配任务。清除队列筛选后可查看全部合成任务。</p><button className="primary-button" onClick={() => location.assign("/review")}>查看全部任务</button></div>;
  if (!current || !company) return <div className="state-panel"><RefreshCw/><h2>复核任务数据不完整</h2><p>成因：任务没有匹配公司记录。影响：当前无法保存人工判断。下一步：检查 Repository 数据关联后重新载入。</p><button className="primary-button" onClick={() => location.reload()}>重新载入</button></div>;

  return <div className="page review-page">
    <header className="page-header"><div><h2>复核中心</h2><p>围绕行动分类与六项指标记录人工判断，结果同步到 Dashboard。</p></div><div className="session-stats"><span>本次完成 <strong>{completed}</strong></span><span>已跳过 <strong>{skipped}</strong></span><span>剩余 <strong>{pendingReviews}</strong></span></div></header>
    <div className="tabs review-tabs">{reviewTypes.map(({ key, label }) => <button className={tab === key ? "active" : ""} onClick={() => { setTab(key); setIndex(0); }} key={key}>{label}<span>{key === "all" ? queue.length : queue.filter((item) => item.reviewType === key).length}</span></button>)}</div>
    <div className="review-layout">
      <section className="review-queue"><header><span>待处理任务</span><small>{visible.length} 条</small></header>{visible.length ? visible.map((task, taskIndex) => { const recordCompany = companies.find((entry) => entry.companyId === task.companyId); return <button className={taskIndex === index ? "selected" : ""} onClick={() => setIndex(taskIndex)} key={task.id}><div><strong>{recordCompany?.companyName ?? task.companyId}</strong><span className="status-chip">{task.metricCode.replace("EAA_ESGSI", "E-AA-ESGSI")}</span></div><p>{task.reason}</p><small><Clock3 size={12}/>{ageLabel(task.ageHours)}<code>影响 {task.impact}</code><ChevronRight size={14}/></small></button>; }) : <div className="queue-empty">当前类型没有待复核任务</div>}</section>
      <section className="review-decision">
        <header><div><span className="section-kicker">{reviewTypes.find((type) => type.key === current.reviewType)?.label} · {current.metricCode.replace("EAA_ESGSI", "E-AA-ESGSI")}</span><h3>{item?.title ?? current.reason}</h3><p>{company.companyName} · {company.reportYear} · 影响优先级 {current.impact}</p></div><span className="status-chip pending">待复核</span></header>
        <div className="review-evidence"><span>模型判断</span><strong>{current.reason}</strong><blockquote>{item?.excerpt ?? "后端未返回该证据的定位信息，请回企业分析页核对证据链。"}</blockquote><small>{item ? `${item.sourceLabel} · ${item.page ? `第 ${item.page} 页` : "外部记录"}` : `证据 ID ${current.evidenceId}`}</small><dl className="review-metric-contract"><div><dt>原始值</dt><dd>{Math.round(current.metricValue * 100)}%</dd></div><div><dt>阈值</dt><dd>{Math.round(current.threshold * 100)}%</dd></div><div><dt>分子 / 分母</dt><dd>{metric?.numerator ?? "--"} / {metric?.denominator ?? "--"}</dd></div><div><dt>公式版本</dt><dd>{metric?.formulaVersion ?? company.versions.score}</dd></div></dl></div>
        <div className="decision-form"><fieldset><legend>人工决定</legend>{[["confirm","确认"],["reject","驳回"],["partial","部分相关"],["insufficient","证据不足"]].map(([value,label]) => <label className={decision === value ? "selected" : ""} key={value}><input type="radio" checked={decision === value} onChange={() => setDecision(value)}/><span>{label}</span></label>)}</fieldset><label className="field-label"><span>原因与备注</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录判断依据，便于后续追溯"/></label></div>
        <footer><button className="quiet-button" onClick={() => { setSkipped((value) => value + 1); setIndex((value) => value + 1); }}><SkipForward size={15}/>跳过</button><div><button className="secondary-button" onClick={() => save(false)}>保存</button><button className="primary-button" onClick={() => save(true)}>保存并下一条 <ChevronRight size={15}/></button></div></footer>
      </section>
    </div>
    {undoId && reviews.some((review) => review.id === undoId) && <div className="undo-banner"><Check size={16}/><span>已保存最近一条复核结果</span><button onClick={() => { undoReview(undoId); setUndoId(null); showToast("已撤销复核结果"); }}><Undo2 size={14}/>撤销</button><small>8 秒内有效</small></div>}
  </div>;
}
