"use client";

import { AlertTriangle, Check, ChevronRight, Clock3, Filter, PanelRightClose, PanelRightOpen, RefreshCw, Search, SkipForward, Undo2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { analysisRepository } from "@/repositories";
import { useDemoStore } from "@/stores/demo-store";
import { getMetric, type CompanyYearRecord, type DashboardReviewTask, type EvidenceItem, type ReviewRecord } from "@/types";
import { EvidenceThread, metricLabel } from "./evidence-thread";
import { GreenLensPanel } from "./greenlens-panel";

type ReviewType = DashboardReviewTask["reviewType"] | "all";
type QueueStatus = "pending" | "completed" | "all";
type Decision = NonNullable<ReviewRecord["humanDecision"]>;

const reviewTypes: Array<{ key: ReviewType; label: string }> = [
  { key: "all", label: "全部" }, { key: "action_classification", label: "行动分类" }, { key: "EASS", label: "EASS" }, { key: "IR", label: "IR" }, { key: "UPR", label: "UPR" }, { key: "risk_band", label: "风险分级" },
];
const decisions: Array<{ value: Decision; label: string }> = [
  { value: "confirm", label: "确认信号" }, { value: "reject", label: "驳回信号" }, { value: "partial", label: "部分相关" }, { value: "insufficient", label: "证据不足" },
];
const reasons = ["主体关联不确定", "报告年度不匹配", "缺少原文定位", "缺少外部验证", "证据覆盖率不足", "指标计算异常", "人工核验通过", "其他"];

export function ReviewWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [companies, setCompanies] = useState<CompanyYearRecord[]>([]);
  const [queue, setQueue] = useState<DashboardReviewTask[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision>("insufficient");
  const [reasonCode, setReasonCode] = useState(reasons[4]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [undoId, setUndoId] = useState<string | null>(null);
  const { reviews, saveReview, undoReview, setPendingReviews, showToast } = useDemoStore();

  const type = validType(params.get("type"));
  const status = validStatus(params.get("status"));
  const query = params.get("q") ?? "";
  const evidenceState = params.get("evidenceState") ?? "all";
  const sort = params.get("sort") ?? "priority";
  const assistantOpen = params.get("assistant") !== "closed";
  const requestedYear = Number(params.get("year"));
  const completedIds = useMemo(() => new Set(reviews.flatMap((review) => [review.id.replace(/^review-/, ""), review.targetId])), [reviews]);
  const companyGroups = useMemo(() => groupCompanies(companies), [companies]);

  useEffect(() => {
    let active = true;
    Promise.all([analysisRepository.listCompanies(), analysisRepository.getDashboardInsights()])
      .then(([companyItems, insights]) => { if (active) { setCompanies(companyItems); setQueue(insights.reviewTasks); } })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const scopedQueue = useMemo(() => {
    const industry = params.get("industry");
    const risk = params.get("risk");
    const factor = params.get("factor");
    const riskBands: Record<string, CompanyYearRecord["riskBand"]> = { "高风险": "high", "中风险": "medium", "低风险": "low", "暂不可评分": "unavailable" };
    return queue.filter((task) => { const company = resolveCompany(companyGroups, task.companyId, requestedYear); return company && (!industry || company.industry === industry) && (!risk || company.riskBand === riskBands[risk]) && (!factor || task.metricCode === factor); });
  }, [companyGroups, params, queue, requestedYear]);

  const visible = useMemo(() => scopedQueue.filter((task) => {
    const company = resolveCompany(companyGroups, task.companyId, requestedYear);
    const done = isDone(task, completedIds);
    return (type === "all" || task.reviewType === type) && (status === "all" || (status === "completed" ? done : !done)) && (evidenceState === "all" || task.evidenceStatus === evidenceState) && (!query || `${company?.companyName ?? ""}${company?.stockCode ?? ""}${task.reason}${task.metricCode}`.toLowerCase().includes(query.toLowerCase()));
  }).sort((a, b) => sort === "age" ? b.ageHours - a.ageHours : (b.impact * b.uncertainty) - (a.impact * a.uncertainty)), [companyGroups, completedIds, evidenceState, query, requestedYear, scopedQueue, sort, status, type]);

  const requestedTask = params.get("task");
  const requestedCompany = params.get("companyId");
  const requestedEvidence = params.get("evidence");
  const current = visible.find((task) => task.id === requestedTask)
    ?? visible.find((task) => task.evidenceId === requestedEvidence)
    ?? visible.find((task) => task.companyId === requestedCompany)
    ?? visible[0]
    ?? scopedQueue[0];
  const company = current ? resolveCompany(companyGroups, current.companyId, requestedYear) : undefined;
  const currentReview = current ? reviews.find((review) => review.id === `review-${current.id}` || review.targetId === current.evidenceId) : undefined;

  useEffect(() => {
    if (!current || requestedTask) return;
    const next = new URLSearchParams(params.toString());
    const currentCompany = resolveCompany(companyGroups, current.companyId, requestedYear);
    next.set("task", current.id); next.set("companyId", current.companyId); next.set("evidence", current.evidenceId); next.set("metric", current.metricCode);
    if (currentCompany) next.set("year", String(currentCompany.reportYear));
    router.replace(`${pathname}?${next}`, { scroll: false });
  }, [companyGroups, current, params, pathname, requestedTask, requestedYear, router]);

  useEffect(() => {
    if (!current || !company) return;
    let active = true;
    Promise.resolve().then(() => { if (active) { setEvidence([]); setEvidenceError(null); setEvidenceLoading(true); } });
    analysisRepository.listEvidence(current.companyId, "success", company.reportYear)
      .then((items) => { if (active) setEvidence(items); })
      .catch((reason) => { if (active) setEvidenceError(reason instanceof Error ? reason.message : "复核证据请求失败"); })
      .finally(() => { if (active) setEvidenceLoading(false); });
    return () => { active = false; };
  }, [company, current]);

  useEffect(() => { let active = true; Promise.resolve().then(() => { if (active) { setNote(currentReview?.note ?? ""); setDecision(currentReview?.humanDecision ?? "insufficient"); setReasonCode(currentReview?.reasonCode ?? reasons[4]); } }); return () => { active = false; }; }, [current?.id, currentReview]);
  useEffect(() => { setPendingReviews(scopedQueue.filter((task) => !isDone(task, completedIds)).length); }, [completedIds, scopedQueue, setPendingReviews]);
  useEffect(() => { if (!undoId) return; const timer = setTimeout(() => setUndoId(null), 8000); return () => clearTimeout(timer); }, [undoId]);

  const selectedEvidenceId = params.get("evidence") ?? current?.evidenceId;
  const item = evidence.find((entry) => entry.id === selectedEvidenceId) ?? evidence.find((entry) => entry.id === current?.evidenceId);
  const externalEvidence = evidence.find((entry) => entry.type === "external");
  const metric = company && current ? getMetric(company, current.metricCode) : undefined;
  const previousCompany = company ? companies.filter((record) => record.companyId === company.companyId && record.reportYear < company.reportYear).sort((a, b) => b.reportYear - a.reportYear)[0] : undefined;
  const blocked = evidenceLoading || !item || company?.evidenceLinkageStatus === "unlinked" || company?.evidenceLinkageStatus === "parse_failed";

  function update(updates: Record<string, string | null>) { const next = new URLSearchParams(params.toString()); Object.entries(updates).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key)); router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }); }
  function selectTask(task: DashboardReviewTask) { const taskCompany = resolveCompany(companyGroups, task.companyId, requestedYear); update({ task: task.id, companyId: task.companyId, year: String(taskCompany?.reportYear ?? (requestedYear || 2024)), metric: task.metricCode, evidence: task.evidenceId }); }
  function move(offset: number) { if (!current || !visible.length) return; const index = visible.findIndex((task) => task.id === current.id); selectTask(visible[(index + offset + visible.length) % visible.length]); }

  async function save(next: boolean) {
    if (!current || !company || saving || (blocked && decision !== "insufficient")) return;
    setSaving(true);
    const review: ReviewRecord = { id: `review-${current.id}`, targetId: current.evidenceId, companyId: company.companyId, targetType: targetType(current.reviewType), originalDecision: current.evidenceStatus, humanDecision: decision, reasonCode, note, reviewedAt: new Date().toISOString() };
    try { const saved = await analysisRepository.saveReview(review); saveReview(saved); setUndoId(saved.id); if (next) move(1); }
    catch (reason) { showToast(`复核保存失败：${reason instanceof Error ? reason.message : "数据接口未响应"}。当前填写内容已保留，请检查接口后重试。`); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="page"><div className="skeleton skeleton-header"/><div className="panel skeleton-panel"/></div>;
  if (error) return <StatePanel title="复核队列载入失败" detail={`成因：${error}。影响：当前无法处理人工判断。下一步：检查数据接口后重新载入页面。`} action="重新载入" onAction={() => location.reload()}/>;
  if (!scopedQueue.length) return <StatePanel title="当前筛选下没有复核任务" detail="当前行业、风险或指标组合没有匹配任务。清除筛选后可以查看全部任务。" action="查看全部任务" onAction={() => location.assign("/review")}/>;
  if (!current || !company) return <StatePanel title="复核任务数据不完整" detail="任务没有匹配到规范化公司年度记录。请检查companyId与reportYear关联。" action="重新载入" onAction={() => location.reload()}/>;

  const completedCount = scopedQueue.filter((task) => isDone(task, completedIds)).length;
  return <div className={`page review-page review-workspace-page ${assistantOpen ? "assistant-open" : ""}`}>
    <header className="review-workspace-header"><div><span className="section-kicker">REVIEW DESK · HUMAN IN THE LOOP</span><h2>风险复核工作台</h2><p>基于原始证据和绿镜辅助分析，完成可追溯的人工判断。</p></div><div className="session-stats"><span>已完成 <strong>{completedCount}</strong></span><span>已跳过 <strong>{skipped}</strong></span><span>待处理 <strong>{scopedQueue.length - completedCount}</strong></span></div></header>
    <section className="review-filterbar" aria-label="复核任务筛选"><label className="review-search"><Search size={14}/><input value={query} onChange={(event) => update({ q: event.target.value || null })} placeholder="搜索公司、代码或触发原因"/></label><label><Filter size={13}/><span>证据</span><select value={evidenceState} onChange={(event) => update({ evidenceState: event.target.value === "all" ? null : event.target.value })}><option value="all">全部状态</option><option value="pending">待复核</option><option value="insufficient">证据不足</option><option value="disputed">存在争议</option><option value="verified">已验证</option></select></label><label><span>排序</span><select value={sort} onChange={(event) => update({ sort: event.target.value === "priority" ? null : event.target.value })}><option value="priority">优先级</option><option value="age">等待时间</option></select></label><button className="greenlens-toggle" aria-expanded={assistantOpen} onClick={() => update({ assistant: assistantOpen ? "closed" : "open" })}>{assistantOpen ? <PanelRightClose size={15}/> : <PanelRightOpen size={15}/>}绿镜</button></section>
    <div className="review-status-tabs" role="tablist" aria-label="任务状态">{([ ["pending", "待处理"], ["completed", "已完成"], ["all", "全部任务"] ] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={status === key} className={status === key ? "active" : ""} onClick={() => update({ status: key === "pending" ? null : key, task: null })}>{label}</button>)}</div>
    <div className="review-type-tabs" role="tablist" aria-label="复核类型">{reviewTypes.map(({ key, label }) => <button key={key} role="tab" aria-selected={type === key} className={type === key ? "active" : ""} onClick={() => update({ type: key === "all" ? null : key, task: null })}>{label}<span>{key === "all" ? scopedQueue.length : scopedQueue.filter((item) => item.reviewType === key).length}</span></button>)}</div>
    <div className="review-workspace-grid">
      <TaskQueue tasks={visible} current={current} companyGroups={companyGroups} requestedYear={requestedYear} completedIds={completedIds} onSelect={selectTask}/>
      <main className="review-case-panel"><header><div><span className="section-kicker">{current.reviewType.replace("action_classification", "ACTION")} · {metricLabel(current.metricCode)}</span><h3>{company.companyName}</h3><p><code>{company.stockCode}</code> · 报告年度 {company.reportYear} · 优先级 {current.impact}</p></div><span className={`status-chip ${currentReview ? "verified" : "pending"}`}>{currentReview ? "已复核" : "待复核"}</span></header>{evidenceError ? <div className="review-inline-error"><AlertTriangle size={16}/><p><strong>证据载入失败</strong>成因：{evidenceError}。当前只能标记“证据不足”。</p></div> : null}<EvidenceThread company={company} task={current} metric={metric} evidence={item} externalEvidence={externalEvidence} review={currentReview} selectedEvidenceId={selectedEvidenceId} onSelectEvidence={(id) => update({ evidence: id })}/></main>
      <GreenLensPanel open={assistantOpen} company={company} task={current} metric={metric} evidence={item} externalEvidence={externalEvidence} previousCompany={previousCompany} onClose={() => update({ assistant: "closed" })} onCitation={(id) => update({ evidence: id })}/>
    </div>
    <DecisionDock decision={decision} reasonCode={reasonCode} note={note} blocked={blocked} saving={saving} onDecision={setDecision} onReason={setReasonCode} onNote={setNote} onSkip={() => { setSkipped((value) => value + 1); move(1); }} onSave={(next) => void save(next)}/>
    {undoId && reviews.some((review) => review.id === undoId) ? <div className="undo-banner"><Check size={16}/><span>已保存最近一条复核结果</span><button onClick={() => { undoReview(undoId); setUndoId(null); }}><Undo2 size={14}/>撤销</button><small>8 秒内有效</small></div> : null}
  </div>;
}

function TaskQueue({ tasks, current, companyGroups, requestedYear, completedIds, onSelect }: { tasks: DashboardReviewTask[]; current: DashboardReviewTask; companyGroups: Map<string, CompanyYearRecord[]>; requestedYear: number; completedIds: Set<string>; onSelect: (task: DashboardReviewTask) => void }) {
  return <section className="review-task-queue" aria-label="复核任务队列"><header><span>任务队列</span><small>{tasks.length} 条</small></header><div className="review-task-scroll">{tasks.length ? tasks.map((task) => { const company = resolveCompany(companyGroups, task.companyId, requestedYear); const done = isDone(task, completedIds); return <button key={task.id} className={task.id === current.id ? "selected" : ""} aria-current={task.id === current.id ? "true" : undefined} onClick={() => onSelect(task)}><div><strong>{company?.companyName ?? task.companyId}</strong><span className={`queue-state ${done ? "done" : task.evidenceStatus}`}>{done ? "已完成" : evidenceLabel(task.evidenceStatus)}</span></div><p>{task.reason}</p><small><span><Clock3 size={11}/>{ageLabel(task.ageHours)}</span><code>{metricLabel(task.metricCode)}</code></small></button>; }) : <div className="queue-empty">当前筛选下没有任务。调整状态或证据条件后重试。</div>}</div></section>;
}

function DecisionDock({ decision, reasonCode, note, blocked, saving, onDecision, onReason, onNote, onSkip, onSave }: { decision: Decision; reasonCode: string; note: string; blocked: boolean; saving: boolean; onDecision: (value: Decision) => void; onReason: (value: string) => void; onNote: (value: string) => void; onSkip: () => void; onSave: (next: boolean) => void }) {
  return <section className="review-decision-dock" aria-label="人工复核决定"><div className="decision-controls"><fieldset><legend>人工决定</legend>{decisions.map(({ value, label }, index) => <label key={value} className={decision === value ? "selected" : ""} title={blocked && value !== "insufficient" ? "证据未完成关联或解析，只能选择证据不足" : undefined}><input type="radio" name="review-decision" value={value} checked={decision === value} disabled={blocked && value !== "insufficient"} onChange={() => onDecision(value)}/><span><kbd>{index + 1}</kbd>{label}</span></label>)}</fieldset><label className="dock-reason"><span>原因</span><select value={reasonCode} onChange={(event) => onReason(event.target.value)}>{reasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label><label className="dock-note"><span>备注</span><input value={note} onChange={(event) => onNote(event.target.value)} placeholder="记录判断依据，便于后续追溯"/></label></div><div className="decision-actions"><button className="quiet-button" onClick={onSkip}><SkipForward size={14}/>跳过</button><button className="secondary-button" disabled={saving} onClick={() => onSave(false)}>保存</button><button className="primary-button review-save-next" disabled={saving || (blocked && decision !== "insufficient")} onClick={() => onSave(true)}>{saving ? "保存中…" : "保存并下一条"}<ChevronRight size={14}/></button></div></section>;
}

function StatePanel({ title, detail, action, onAction }: { title: string; detail: string; action: string; onAction: () => void }) { return <div className="state-panel"><RefreshCw/><h2>{title}</h2><p>{detail}</p><button className="primary-button" onClick={onAction}>{action}</button></div>; }
function validType(value: string | null): ReviewType { return reviewTypes.some((item) => item.key === value) ? value as ReviewType : "all"; }
function validStatus(value: string | null): QueueStatus { return value === "completed" || value === "all" ? value : "pending"; }
function groupCompanies(items: CompanyYearRecord[]) { const groups = new Map<string, CompanyYearRecord[]>(); items.forEach((item) => groups.set(item.companyId, [...(groups.get(item.companyId) ?? []), item])); groups.forEach((group) => group.sort((a, b) => b.reportYear - a.reportYear)); return groups; }
function resolveCompany(groups: Map<string, CompanyYearRecord[]>, companyId: string, year: number) { const items = groups.get(companyId); return items?.find((item) => item.reportYear === year) ?? items?.[0]; }
function isDone(task: DashboardReviewTask, ids: Set<string>) { return ids.has(task.id) || ids.has(task.evidenceId); }
function ageLabel(hours: number) { return hours < 24 ? `${hours} 小时` : `${Math.floor(hours / 24)} 天`; }
function evidenceLabel(status: DashboardReviewTask["evidenceStatus"]) { return ({ verified: "已验证", pending: "待复核", insufficient: "证据不足", disputed: "存在争议" } as const)[status]; }
function targetType(type: DashboardReviewTask["reviewType"]): ReviewRecord["targetType"] { if (type === "action_classification") return "action_classification"; if (type === "risk_band") return "risk_label"; return "metric"; }
