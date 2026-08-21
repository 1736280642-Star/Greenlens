"use client";

import { AlertTriangle, Check, ChevronRight, Clock3, Filter, PanelRightClose, PanelRightOpen, RefreshCw, Search, SkipForward, Undo2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { analysisRepository } from "@/repositories";
import { useDemoStore } from "@/stores/demo-store";
import { getMetric, type CompanyYearRecord, type DashboardReviewTask, type EvidenceItem, type EvidencePageReference, type ReviewQueueAction, type ReviewRecord } from "@/types";
import { EvidenceThread, metricLabel } from "./evidence-thread";
import { GreenLensPanel } from "./greenlens-panel";

type ReviewType = DashboardReviewTask["reviewType"] | "all";
type QueueStatus = "pending" | "completed" | "skipped" | "all";
type Decision = NonNullable<ReviewRecord["humanDecision"]>;

const reviewTypes: Array<{ key: ReviewType; label: string }> = [
  { key: "all", label: "全部" }, { key: "action_classification", label: "行动分类" }, { key: "EASS", label: "EASS" }, { key: "IR", label: "IR" }, { key: "UPR", label: "UPR" }, { key: "risk_band", label: "风险分级" },
];
const decisions: Array<{ value: Decision; label: string }> = [
  { value: "confirm", label: "确认信号" }, { value: "reject", label: "驳回信号" }, { value: "partial", label: "部分相关" }, { value: "insufficient", label: "证据不足" },
];
const reasonsByDecision: Record<Decision, string[]> = {
  confirm: ["原文支持当前信号", "外部事实支持当前信号", "人工核验通过", "其他"],
  reject: ["报告年度不匹配", "主体关联不确定", "指标计算异常", "原文不支持当前信号", "其他"],
  partial: ["仅部分指标成立", "上下文限定结论", "证据覆盖率不足", "缺少外部验证", "其他"],
  insufficient: ["证据尚未关联", "证据解析失败", "缺少原文定位", "证据覆盖率不足", "缺少外部验证", "其他"],
};

export function ReviewWorkspace({ mode = "review" }: { mode?: "review" | "quality" }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const globalYear = useDemoStore((state) => state.year);
  const [companies, setCompanies] = useState<CompanyYearRecord[]>([]);
  const [queue, setQueue] = useState<DashboardReviewTask[]>([]);
  const [queueActions, setQueueActions] = useState<ReviewQueueAction[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [pageReference, setPageReference] = useState<EvidencePageReference | null>(null);
  const [loading, setLoading] = useState(true);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [localQuery, setLocalQuery] = useState(params.get("q") ?? "");
  const { reviews, saveReview, undoReview, setPendingReviews, showToast } = useDemoStore();

  const type = validType(params.get("type"));
  const status = validStatus(params.get("status"));
  const query = params.get("q") ?? "";
  const evidenceState = params.get("evidenceState") ?? "all";
  const sort = params.get("sort") ?? "priority";
  const assistantOpen = params.get("assistant") !== "closed";
  const yearParam = params.get("year");
  const requestedYear = yearParam && Number.isFinite(Number(yearParam)) ? Number(yearParam) : globalYear;
  const completedIds = useMemo(() => new Set(reviews.filter((review) => review.humanDecision).flatMap((review) => [review.id.replace(/^review-/, ""), review.targetId])), [reviews]);
  const skippedIds = useMemo(() => new Set(queueActions.map((action) => action.taskId).filter((id) => !completedIds.has(id))), [completedIds, queueActions]);
  const companyGroups = useMemo(() => groupCompanies(companies), [companies]);

  useEffect(() => {
    let active = true;
    Promise.all([analysisRepository.listCompanies(), analysisRepository.getDashboardInsights(), analysisRepository.listReviewQueueActions()])
      .then(([companyItems, insights, actions]) => { if (active) { setCompanies(companyItems); setQueue(insights.reviewTasks); setQueueActions(actions); } })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (localQuery === query) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (localQuery) next.set("q", localQuery); else next.delete("q");
      next.delete("task");
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [localQuery, params, pathname, query, router]);

  const scopedQueue = useMemo(() => {
    const industry = params.get("industry");
    const risk = params.get("risk");
    const factor = params.get("factor");
    const riskBands: Record<string, CompanyYearRecord["riskBand"]> = { "高风险": "high", "中风险": "medium", "低风险": "low", "暂不可评分": "unavailable" };
    return queue.filter((task) => {
      const company = resolveCompany(companyGroups, task.companyId, requestedYear);
      const qualityException = company && (
        company.evidenceLinkageStatus === "parse_failed"
        || company.evidenceLinkageStatus === "unlinked"
        || company.evidenceLinkageStatus === "low_coverage"
        || task.evidenceStatus === "insufficient"
        || task.evidenceStatus === "disputed"
        || task.uncertainty >= 70
      );
      return company && (mode !== "quality" || qualityException) && (!industry || company.industry === industry) && (!risk || company.riskBand === riskBands[risk]) && (!factor || task.metricCode === factor);
    });
  }, [companyGroups, mode, params, queue, requestedYear]);

  const visible = useMemo(() => scopedQueue.filter((task) => {
    const company = resolveCompany(companyGroups, task.companyId, requestedYear);
    const done = isDone(task, completedIds);
    const skipped = !done && skippedIds.has(task.id);
    const matchesStatus = status === "all" || (status === "completed" ? done : status === "skipped" ? skipped : !done && !skipped);
    return matchesStatus && (type === "all" || task.reviewType === type) && (evidenceState === "all" || task.evidenceStatus === evidenceState) && (!query || `${company?.companyName ?? ""}${company?.stockCode ?? ""}${task.reason}${task.metricCode}`.toLowerCase().includes(query.toLowerCase()));
  }).sort((a, b) => sort === "age" ? b.ageHours - a.ageHours : priorityOf(b) - priorityOf(a)), [companyGroups, completedIds, evidenceState, query, requestedYear, scopedQueue, skippedIds, sort, status, type]);

  const requestedTask = params.get("task");
  const requestedCompany = params.get("companyId");
  const requestedEvidence = params.get("evidence");
  const current = visible.find((task) => task.id === requestedTask)
    ?? visible.find((task) => task.evidenceId === requestedEvidence)
    ?? visible.find((task) => task.companyId === requestedCompany)
    ?? visible[0];
  const company = current ? resolveCompany(companyGroups, current.companyId, requestedYear) : undefined;
  const currentReview = current ? reviews.find((review) => review.id === `review-${current.id}` || review.targetId === current.evidenceId) : undefined;

  useEffect(() => {
    if (!current || requestedTask) return;
    const next = new URLSearchParams(params.toString());
    next.set("task", current.id); next.set("companyId", current.companyId); next.set("evidence", current.evidenceId); next.set("metric", current.metricCode); next.set("year", String(requestedYear));
    router.replace(`${pathname}?${next}`, { scroll: false });
  }, [current, params, pathname, requestedTask, requestedYear, router]);

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

  const primaryEvidence = evidence.find((entry) => entry.id === current?.evidenceId);
  const selectedEvidenceId = params.get("evidence") ?? current?.evidenceId;
  const selectedEvidence = evidence.find((entry) => entry.id === selectedEvidenceId) ?? primaryEvidence;
  const externalEvidence = evidence.find((entry) => entry.type === "external");

  useEffect(() => {
    if (!company || !selectedEvidence || selectedEvidence.type === "external") {
      Promise.resolve().then(() => { setPageReference(null); setPageError(null); });
      return;
    }
    let active = true;
    Promise.resolve().then(() => { if (active) { setPageReference(null); setPageError(null); setPageLoading(true); } });
    analysisRepository.getEvidencePageText(company.companyId, selectedEvidence.id, selectedEvidence.page)
      .then((reference) => { if (active) setPageReference(reference); })
      .catch((reason) => { if (active) setPageError(reason instanceof Error ? reason.message : "原文页文本请求失败"); })
      .finally(() => { if (active) setPageLoading(false); });
    return () => { active = false; };
  }, [company, selectedEvidence]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      setNote(currentReview?.note ?? "");
      setDecision(currentReview?.humanDecision ?? null);
      setReasonCode(currentReview?.reasonCode ?? "");
    });
    return () => { active = false; };
  }, [current?.id, currentReview]);
  useEffect(() => { setPendingReviews(scopedQueue.filter((task) => !isDone(task, completedIds) && !skippedIds.has(task.id)).length); }, [completedIds, scopedQueue, setPendingReviews, skippedIds]);
  useEffect(() => { if (!undoId) return; const timer = setTimeout(() => setUndoId(null), 8000); return () => clearTimeout(timer); }, [undoId]);

  const metric = company && current ? getMetric(company, current.metricCode) : undefined;
  const previousCompany = company ? companies.filter((record) => record.companyId === company.companyId && record.reportYear < company.reportYear).sort((a, b) => b.reportYear - a.reportYear)[0] : undefined;
  const blocked = evidenceLoading || !primaryEvidence || company?.evidenceLinkageStatus === "unlinked" || company?.evidenceLinkageStatus === "parse_failed";
  const validationMessage = getValidationMessage(decision, reasonCode, note, blocked);

  function update(updates: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    Object.entries(updates).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  }
  function selectTask(task: DashboardReviewTask) {
    update({ task: task.id, companyId: task.companyId, year: String(requestedYear), metric: task.metricCode, evidence: task.evidenceId });
  }
  function move(offset: number) {
    if (!current || !visible.length) return;
    const index = visible.findIndex((task) => task.id === current.id);
    const candidates = visible.filter((task) => task.id !== current.id);
    if (candidates.length) selectTask(candidates[Math.max(0, Math.min(candidates.length - 1, index + offset - 1))] ?? candidates[0]);
  }
  function chooseDecision(value: Decision) {
    setDecision(value);
    if (!reasonsByDecision[value].includes(reasonCode)) setReasonCode(reasonsByDecision[value][0]);
  }
  function selectEvidence(id: string) {
    update({ evidence: id });
    window.setTimeout(() => document.querySelector(`[data-evidence-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 40);
  }

  async function save(next: boolean) {
    if (!current || !company || saving || validationMessage) return;
    setSaving(true);
    const review: ReviewRecord = { id: `review-${current.id}`, targetId: current.evidenceId, companyId: company.companyId, targetType: targetType(current.reviewType), originalDecision: current.evidenceStatus, humanDecision: decision!, reasonCode, note: note.trim(), reviewedAt: new Date().toISOString() };
    try { const saved = await analysisRepository.saveReview(review); saveReview(saved); setUndoId(saved.id); if (next) move(1); }
    catch (reason) { showToast(`复核保存失败：${reason instanceof Error ? reason.message : "数据接口未响应"}。当前填写内容已保留，请检查接口后重试。`); }
    finally { setSaving(false); }
  }
  async function skip() {
    if (!current || skipping) return;
    setSkipping(true);
    const action: ReviewQueueAction = { id: `skip-${current.id}`, taskId: current.id, companyId: current.companyId, action: "skip", reason: note.trim() || undefined, actedAt: new Date().toISOString() };
    try {
      const saved = await analysisRepository.saveReviewQueueAction(action);
      setQueueActions((items) => [saved, ...items.filter((item) => item.taskId !== saved.taskId)]);
      showToast("已持久化跳过状态，可在“已跳过”中继续处理");
      move(1);
    } catch (reason) { showToast(`跳过失败：${reason instanceof Error ? reason.message : "数据接口未响应"}。任务仍保留在待处理队列。`); }
    finally { setSkipping(false); }
  }

  if (loading) return <div className="page"><div className="skeleton skeleton-header"/><div className="panel skeleton-panel"/></div>;
  if (error) return <StatePanel title="复核队列载入失败" detail={`成因：${error}。影响：当前无法处理人工判断。下一步：检查数据接口后重新载入页面。`} action="重新载入" onAction={() => location.reload()}/>;
  if (!scopedQueue.length) return <StatePanel title={`${requestedYear} 年没有需要人工处置的质量异常`} detail="当前没有解析、关联、年份或低置信度异常；高风险信号本身不会产生人工任务。" action="返回数据源" onAction={() => location.assign("/data-sources")}/>;
  if (!current || !company) return <StatePanel title="当前筛选下没有异常记录" detail="调整状态、异常类型或搜索条件后继续。" action="清除筛选" onAction={() => location.assign(`/data-sources/review?year=${requestedYear}`)}/>;

  const completedCount = scopedQueue.filter((task) => isDone(task, completedIds)).length;
  const skippedCount = scopedQueue.filter((task) => !isDone(task, completedIds) && skippedIds.has(task.id)).length;
  const pendingCount = scopedQueue.length - completedCount - skippedCount;
  const contextState = getContextState(company, primaryEvidence, evidenceLoading, evidenceError);
  return <div className={`page review-page review-workspace-page ${assistantOpen ? "assistant-open" : "assistant-closed"}`}>
    <header className="review-commandbar">
      <div className="review-heading"><span className="section-kicker">DATA QUALITY · EXCEPTIONS ONLY</span><h2>异常与质量处置</h2><p>只处理解析、关联、年份和低置信度异常；风险高低不直接产生人工任务。</p></div>
      <div className="session-stats" aria-label="当前范围统计"><span>当前范围已完成<strong>{completedCount}</strong></span><span>持久化跳过<strong>{skippedCount}</strong></span><span>当前范围待处理<strong>{pendingCount}</strong></span></div>
      <label className="review-search"><Search size={15}/><input value={localQuery} onChange={(event) => setLocalQuery(event.target.value)} placeholder="搜索公司、代码或触发原因"/></label>
      <label className="review-select"><Filter size={14}/><span>证据</span><select value={evidenceState} onChange={(event) => update({ evidenceState: event.target.value === "all" ? null : event.target.value, task: null })}><option value="all">全部状态</option><option value="pending">待复核</option><option value="insufficient">证据不足</option><option value="disputed">存在争议</option><option value="verified">已验证</option></select></label>
      <label className="review-select"><span>排序</span><select value={sort} onChange={(event) => update({ sort: event.target.value === "priority" ? null : event.target.value })}><option value="priority">优先级</option><option value="age">等待时间</option></select></label>
      <button className="greenlens-toggle" aria-expanded={assistantOpen} onClick={() => update({ assistant: assistantOpen ? "closed" : "open" })}>{assistantOpen ? <PanelRightClose size={16}/> : <PanelRightOpen size={16}/>}绿镜</button>
    </header>
    <nav className="review-scopebar" aria-label="复核队列范围">
      <div className="review-status-tabs">{([ ["pending", "待处理", pendingCount], ["completed", "已完成", completedCount], ["skipped", "已跳过", skippedCount], ["all", "全部", scopedQueue.length] ] as const).map(([key, label, count]) => <button key={key} aria-pressed={status === key} className={status === key ? "active" : ""} onClick={() => update({ status: key === "pending" ? null : key, task: null })}>{label}<span>{count}</span></button>)}</div>
      <div className="review-type-tabs">{reviewTypes.map(({ key, label }) => <button key={key} aria-pressed={type === key} className={type === key ? "active" : ""} onClick={() => update({ type: key === "all" ? null : key, task: null })}>{label}<span>{key === "all" ? scopedQueue.length : scopedQueue.filter((item) => item.reviewType === key).length}</span></button>)}</div>
    </nav>
    <div className="review-workspace-grid">
      <TaskQueue tasks={visible} current={current} companyGroups={companyGroups} requestedYear={requestedYear} completedIds={completedIds} skippedIds={skippedIds} onSelect={selectTask}/>
      <main className="review-case-panel"><header><div><span className="section-kicker">{current.reviewType.replace("action_classification", "ACTION")} · {metricLabel(current.metricCode)}</span><h3>{company.companyName}</h3><p><code>{company.stockCode}</code><span>报告年度 {company.reportYear}</span><span>发布日期 {company.publishDate || "未提供"}</span><span>优先级 {priorityOf(current)}</span></p></div><span className={`status-chip ${currentReview ? "verified" : skippedIds.has(current.id) ? "warning" : "pending"}`}>{currentReview ? "已复核" : skippedIds.has(current.id) ? "已跳过" : "待复核"}</span></header>
        {evidenceError ? <div className="review-inline-error"><AlertTriangle size={16}/><p><strong>证据载入失败</strong>成因：{evidenceError}。影响：当前只能标记“证据不足”。下一步：检查证据接口后重试。</p></div> : null}
        <EvidenceThread company={company} task={current} metric={metric} evidence={primaryEvidence} externalEvidence={externalEvidence} review={currentReview} selectedEvidenceId={selectedEvidenceId} pageReference={pageReference} pageLoading={pageLoading} pageError={pageError} onSelectEvidence={selectEvidence}/>
      </main>
      <GreenLensPanel open={assistantOpen} company={company} task={current} metric={metric} evidence={primaryEvidence} externalEvidence={externalEvidence} previousCompany={previousCompany} contextState={contextState} onClose={() => update({ assistant: "closed" })} onCitation={selectEvidence}/>
    </div>
    <DecisionDock decision={decision} reasonCode={reasonCode} note={note} blocked={blocked} saving={saving} skipping={skipping} validationMessage={validationMessage} onDecision={chooseDecision} onReason={setReasonCode} onNote={setNote} onSkip={() => void skip()} onSave={(next) => void save(next)}/>
    {undoId && reviews.some((review) => review.id === undoId) ? <div className="undo-banner" role="status"><Check size={16}/><span>已保存最近一条复核结果</span><button onClick={() => { undoReview(undoId); setUndoId(null); }}><Undo2 size={14}/>撤销</button><small>8 秒内有效</small></div> : null}
  </div>;
}

function TaskQueue({ tasks, current, companyGroups, requestedYear, completedIds, skippedIds, onSelect }: { tasks: DashboardReviewTask[]; current: DashboardReviewTask; companyGroups: Map<string, CompanyYearRecord[]>; requestedYear: number; completedIds: Set<string>; skippedIds: Set<string>; onSelect: (task: DashboardReviewTask) => void }) {
  return <section className="review-task-queue" aria-label="复核任务队列"><header><span>任务队列</span><small>{tasks.length} 条</small></header><div className="review-task-scroll">{tasks.map((task) => { const company = resolveCompany(companyGroups, task.companyId, requestedYear); const done = isDone(task, completedIds); const skipped = !done && skippedIds.has(task.id); return <button key={task.id} className={task.id === current.id ? "selected" : ""} aria-current={task.id === current.id ? "true" : undefined} title={`${company?.companyName ?? task.companyId}：${task.reason}`} onClick={() => onSelect(task)}><div><strong>{company?.companyName ?? task.companyId}</strong><span className={`queue-state ${done ? "done" : skipped ? "skipped" : task.evidenceStatus}`}>{done ? "已完成" : skipped ? "已跳过" : evidenceLabel(task.evidenceStatus)}</span></div><p>{task.reason}</p><small><span><Clock3 size={12}/>{ageLabel(task.ageHours)}</span><code>P{priorityOf(task)} · 影响 {task.impact} · 不确定 {task.uncertainty}</code></small></button>; })}</div></section>;
}

function DecisionDock({ decision, reasonCode, note, blocked, saving, skipping, validationMessage, onDecision, onReason, onNote, onSkip, onSave }: { decision: Decision | null; reasonCode: string; note: string; blocked: boolean; saving: boolean; skipping: boolean; validationMessage: string | null; onDecision: (value: Decision) => void; onReason: (value: string) => void; onNote: (value: string) => void; onSkip: () => void; onSave: (next: boolean) => void }) {
  const reasonOptions = decision ? reasonsByDecision[decision] : [];
  return <section className="review-decision-dock" aria-label="人工复核决定">
    <div className="decision-controls"><fieldset><legend>人工结论</legend>{decisions.map(({ value, label }) => <label key={value} className={decision === value ? "selected" : ""} title={blocked && value !== "insufficient" ? "证据未完成关联或解析，只能选择证据不足" : undefined}><input type="radio" name="review-decision" value={value} checked={decision === value} disabled={blocked && value !== "insufficient"} onChange={() => onDecision(value)}/><span>{label}</span></label>)}</fieldset><label className="dock-reason"><span>判断原因</span><select value={reasonCode} disabled={!decision} onChange={(event) => onReason(event.target.value)}><option value="">先选择人工结论</option>{reasonOptions.map((reason) => <option key={reason}>{reason}</option>)}</select></label><label className="dock-note"><span>复核备注{reasonCode === "其他" ? "（必填）" : ""}</span><input value={note} onChange={(event) => onNote(event.target.value)} placeholder="记录判断依据，便于后续追溯"/></label></div>
    <div className="decision-feedback" aria-live="polite">{validationMessage ?? "结论、原因、证据引用和时间将一并保存。"}</div>
    <div className="decision-actions"><button className="quiet-button" disabled={skipping} onClick={onSkip}><SkipForward size={15}/>{skipping ? "跳过中…" : "跳过"}</button><button className="secondary-button" disabled={saving || Boolean(validationMessage)} onClick={() => onSave(false)}>保存</button><button className="primary-button review-save-next" disabled={saving || Boolean(validationMessage)} onClick={() => onSave(true)}>{saving ? "保存中…" : "保存并下一条"}<ChevronRight size={15}/></button></div>
  </section>;
}

function StatePanel({ title, detail, action, onAction }: { title: string; detail: string; action: string; onAction: () => void }) { return <div className="state-panel"><RefreshCw/><h2>{title}</h2><p>{detail}</p><button className="primary-button" onClick={onAction}>{action}</button></div>; }
function validType(value: string | null): ReviewType { return reviewTypes.some((item) => item.key === value) ? value as ReviewType : "all"; }
function validStatus(value: string | null): QueueStatus { return value === "completed" || value === "skipped" || value === "all" ? value : "pending"; }
function groupCompanies(items: CompanyYearRecord[]) { const groups = new Map<string, CompanyYearRecord[]>(); items.forEach((item) => groups.set(item.companyId, [...(groups.get(item.companyId) ?? []), item])); groups.forEach((group) => group.sort((a, b) => b.reportYear - a.reportYear)); return groups; }
function resolveCompany(groups: Map<string, CompanyYearRecord[]>, companyId: string, year: number) { return groups.get(companyId)?.find((item) => item.reportYear === year); }
function isDone(task: DashboardReviewTask, ids: Set<string>) { return ids.has(task.id) || ids.has(task.evidenceId); }
function priorityOf(task: DashboardReviewTask) { return Math.round((task.impact * task.uncertainty) / 100); }
function evidenceLabel(value: DashboardReviewTask["evidenceStatus"]) { return ({ pending: "待复核", insufficient: "证据不足", disputed: "存在争议", verified: "已验证" } as const)[value]; }
function ageLabel(hours: number) { if (hours < 24) return `${Math.max(1, Math.round(hours))} 小时`; return `${Math.floor(hours / 24)} 天`; }
function targetType(type: DashboardReviewTask["reviewType"]): ReviewRecord["targetType"] { if (type === "action_classification") return "action_classification"; if (type === "risk_band") return "risk_label"; return "metric"; }
function getValidationMessage(decision: Decision | null, reasonCode: string, note: string, blocked: boolean) {
  if (!decision) return "请先选择人工结论。";
  if (blocked && decision !== "insufficient") return "原文未完成关联或解析，只能保存“证据不足”。";
  if (!reasonCode) return "请选择与结论匹配的判断原因。";
  if (reasonCode === "其他" && !note.trim()) return "选择“其他”时需要填写复核备注。";
  return null;
}
function getContextState(company: CompanyYearRecord, evidence: EvidenceItem | undefined, loading: boolean, error: string | null) {
  if (loading) return { tone: "loading" as const, label: "正在读取证据上下文" };
  if (error || company.evidenceLinkageStatus === "parse_failed") return { tone: "critical" as const, label: "证据解析失败" };
  if (!evidence || company.evidenceLinkageStatus === "unlinked") return { tone: "critical" as const, label: "证据尚未关联" };
  if (company.evidenceLinkageStatus === "low_coverage") return { tone: "warning" as const, label: `证据覆盖不足 · ${company.evidenceCoverage}%` };
  return { tone: "ready" as const, label: `上下文已就绪 · 覆盖 ${company.evidenceCoverage}%` };
}
