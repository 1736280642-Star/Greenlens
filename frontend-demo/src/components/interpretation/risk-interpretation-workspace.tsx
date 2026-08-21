"use client";

import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  FileText,
  GitCompareArrows,
  LoaderCircle,
  MessageSquareWarning,
  Quote,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { analysisRepository } from "@/repositories";
import { useDemoStore } from "@/stores/demo-store";
import type {
  CompanyYearRecord,
  EvidencePageReference,
  RiskInterpretation,
  RiskInterpretationCitation,
  RiskInterpretationFocus,
  ReviewRecord,
} from "@/types";

const views: Array<{ key: RiskInterpretationFocus; label: string }> = [
  { key: "overview", label: "综合解读" },
  { key: "drivers", label: "风险来源" },
  { key: "evidence", label: "证据账本" },
  { key: "history", label: "历史变化" },
  { key: "industry", label: "行业比较" },
];

const feedbackOptions = [
  ["entity_mismatch", "主体匹配错误"],
  ["year_mismatch", "报告年度错误"],
  ["evidence_mismatch", "证据关联错误"],
  ["analysis_error", "解读内容错误"],
  ["other", "其他问题"],
] as const;

const subscribeToContextActions = () => () => undefined;
const getContextActionsRoot = () => document.getElementById("review-context-actions");
const getServerContextActionsRoot = () => null;

export function RiskInterpretationWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const globalYear = useDemoStore((state) => state.year);
  const { selectCompany, selectEvidence, toggleCompare, compareIds, saveReview, showToast } = useDemoStore();
  const yearParam = Number(params.get("year"));
  const reportYear = Number.isInteger(yearParam) ? yearParam : globalYear;
  const view = validView(params.get("view"));
  const requestedCompanyId = params.get("companyId");
  const requestedEvidenceId = params.get("evidence");

  const [companies, setCompanies] = useState<CompanyYearRecord[]>([]);
  const [interpretation, setInterpretation] = useState<RiskInterpretation | null>(null);
  const [pageReference, setPageReference] = useState<{ evidenceId: string; value: EvidencePageReference } | null>(null);
  const [loadedYear, setLoadedYear] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [evidenceFilter, setEvidenceFilter] = useState("all");
  const [feedbackOpen, setFeedbackOpen] = useState(params.get("feedback") === "open");
  const [feedbackCategory, setFeedbackCategory] = useState("analysis_error");
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const actionsRoot = useSyncExternalStore(subscribeToContextActions, getContextActionsRoot, getServerContextActionsRoot);

  const rankedCompanies = useMemo(() => companies
    .filter((company) => riskFilter === "all" || company.riskBand === riskFilter)
    .filter((company) => evidenceFilter === "all"
      || evidenceFilter === "linked" && company.evidenceLinkageStatus === "linked"
      || evidenceFilter === "attention" && (company.evidenceLinkageStatus !== "linked" || company.evidenceCoverage < 70))
    .filter((company) => !query || `${company.companyName}${company.stockCode}${company.industry}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => priorityScore(b) - priorityScore(a)), [companies, evidenceFilter, query, riskFilter]);
  const company = companies.find((item) => item.companyId === requestedCompanyId) ?? rankedCompanies[0] ?? companies[0];
  const selectedCitation = interpretation?.citations.find((item) => item.evidenceId === requestedEvidenceId) ?? interpretation?.citations[0];

  useEffect(() => {
    let active = true;
    analysisRepository.listCompanies("success", { year: reportYear })
      .then((items) => { if (active) { setCompanies(items); setLoadedYear(reportYear); setError(null); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "公司年度数据载入失败"); })
    return () => { active = false; };
  }, [reportYear]);

  useEffect(() => {
    if (!company) return;
    selectCompany(company.companyId, company.reportYear);
    if (requestedCompanyId === company.companyId && params.get("year") === String(company.reportYear)) return;
    updateUrl(router, pathname, params, { companyId: company.companyId, year: String(company.reportYear) });
  }, [company, params, pathname, requestedCompanyId, router, selectCompany]);

  useEffect(() => {
    if (!company) return;
    let active = true;
    analysisRepository.getRiskInterpretation(company.companyId, company.reportYear, view)
      .then((result) => { if (active) { setInterpretation(result); setError(null); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "自动解读生成失败"); })
    return () => { active = false; };
  }, [company, view]);

  useEffect(() => {
    if (!company || !selectedCitation?.page) return;
    let active = true;
    analysisRepository.getEvidencePageText(company.companyId, selectedCitation.evidenceId, selectedCitation.page)
      .then((reference) => { if (active && reference) setPageReference({ evidenceId: selectedCitation.evidenceId, value: reference }); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [company, selectedCitation]);

  function chooseCompany(next: CompanyYearRecord) {
    setInterpretation(null);
    updateUrl(router, pathname, params, { companyId: next.companyId, year: String(next.reportYear), evidence: null, metric: null });
  }

  function chooseView(next: RiskInterpretationFocus) {
    updateUrl(router, pathname, params, { view: next === "overview" ? null : next });
  }

  function chooseCitation(citation: RiskInterpretationCitation) {
    selectEvidence(citation.evidenceId);
    updateUrl(router, pathname, params, { evidence: citation.evidenceId });
  }

  function openOriginal() {
    const citation = selectedCitation ?? interpretation?.citations.find((item) => item.page);
    if (!citation) {
      showToast("当前解读没有可定位的报告原文");
      return;
    }
    chooseCitation(citation);
    chooseView("evidence");
    window.setTimeout(() => document.querySelector(".interpretation-source-reader")?.scrollIntoView({ block: "nearest" }), 40);
  }

  function addToCompare() {
    if (!company) return;
    if (!toggleCompare(company.companyId)) showToast("最多同时比较 5 家公司");
    else showToast(compareIds.includes(company.companyId) ? "已移出对比" : "已加入对比");
  }

  function exportSummary() {
    if (!interpretation) return;
    const body = toMarkdown(interpretation);
    const url = URL.createObjectURL(new Blob([body], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${interpretation.companyId}-${interpretation.reportYear}-risk-interpretation.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("AI 风险解读摘要已导出");
  }

  async function submitFeedback(event: FormEvent) {
    event.preventDefault();
    if (!company || !interpretation || feedbackSaving) return;
    setFeedbackSaving(true);
    const review: ReviewRecord = {
      id: `interpretation-feedback-${crypto.randomUUID()}`,
      targetId: interpretation.id,
      companyId: company.companyId,
      targetType: "interpretation",
      originalDecision: "auto_interpretation",
      humanDecision: "reject",
      reasonCode: feedbackCategory,
      note: feedbackNote.trim() || undefined,
      reviewedAt: new Date().toISOString(),
    };
    try {
      const saved = await analysisRepository.saveReview(review);
      saveReview(saved);
      setFeedbackOpen(false);
      setFeedbackNote("");
      showToast("解读问题已记录，将进入异常与质量处置");
    } catch (reason) {
      showToast(`问题记录失败：${reason instanceof Error ? reason.message : "接口未响应"}。填写内容已保留，请重试。`);
    } finally {
      setFeedbackSaving(false);
    }
  }

  const loading = loadedYear !== reportYear;
  const visibleInterpretation = interpretation && company && interpretation.companyId === company.companyId && interpretation.reportYear === company.reportYear && interpretation.focus === view ? interpretation : null;
  const visiblePageReference = pageReference && pageReference.evidenceId === selectedCitation?.evidenceId ? pageReference.value : null;
  if (loading) return <div className="page interpretation-page"><div className="interpretation-loading"><LoaderCircle className="spin"/><span>正在读取公司年度数据</span></div></div>;
  if (error && !companies.length) return <StatePanel title="AI 风险解读载入失败" detail={`原因：${error}。影响：当前无法生成结构化风险解读。下一步：检查数据接口后重试。`}/>;
  if (!companies.length) return <StatePanel title={`${reportYear} 年没有可解读记录`} detail="系统不会自动切换到其他报告年度。请在顶部选择存在公司年度记录的年份。"/>;

  const contextActions = <>
    <button className="secondary-button" onClick={openOriginal} aria-label="查看原文"><FileText size={15}/><span>查看原文</span></button>
    <button className="secondary-button" onClick={addToCompare} aria-label={company && compareIds.includes(company.companyId) ? "移出对比" : "加入对比"}><GitCompareArrows size={15}/><span>{company && compareIds.includes(company.companyId) ? "移出对比" : "加入对比"}</span></button>
    <button className="secondary-button" disabled={!interpretation} onClick={exportSummary} aria-label="导出摘要"><Download size={15}/><span>导出摘要</span></button>
    <button className="quiet-button" onClick={() => setFeedbackOpen(true)} aria-label="报告问题"><MessageSquareWarning size={15}/><span>报告问题</span></button>
  </>;

  return <>
    {actionsRoot ? createPortal(contextActions, actionsRoot) : null}
    <div className="page interpretation-page" aria-label="AI 风险解读">
    <div className="interpretation-layout">
      <aside className="interpretation-priority" aria-label="重点解读公司">
        <header><div><span>重点解读公司</span><small>{rankedCompanies.length} 家</small></div><label><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索公司或代码"/></label><div className="interpretation-filters"><select aria-label="风险筛选" value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}><option value="all">全部风险</option><option value="high">高风险</option><option value="medium">中风险</option><option value="low">低风险</option><option value="unavailable">暂不可评分</option></select><select aria-label="证据筛选" value={evidenceFilter} onChange={(event) => setEvidenceFilter(event.target.value)}><option value="all">全部证据</option><option value="linked">证据已关联</option><option value="attention">证据需关注</option></select></div></header>
        <div className="interpretation-company-list">{rankedCompanies.map((item) => <button key={item.id} className={item.companyId === company?.companyId ? "selected" : ""} onClick={() => chooseCompany(item)}><div><strong>{item.companyName}</strong><span className={`risk-dot ${item.riskBand}`}/></div><small><code>{item.stockCode}</code><span>{item.industry}</span></small><div className="company-signal-row"><span>{riskLabel(item.riskBand)}</span><span>证据 {item.evidenceCoverage}%</span><span>{item.eventCount} 条外部事件</span></div></button>)}</div>
      </aside>

      <main className="interpretation-main">
        <header className="interpretation-company-header"><div><span className="section-kicker">COMPANY · {company?.stockCode}</span><h3>{company?.companyName}</h3><p>{company?.industry} · 报告年度 {company?.reportYear} · 发布日期 {company?.publishDate || "未提供"}</p></div><div className="interpretation-state"><span className={`risk-chip ${company?.riskBand}`}>{riskLabel(company?.riskBand ?? "unavailable")}</span><small>证据覆盖 {company?.evidenceCoverage}%</small></div></header>
        <nav className="interpretation-view-tabs" aria-label="风险解读视图">{views.map((item) => <button key={item.key} className={view === item.key ? "active" : ""} aria-pressed={view === item.key} onClick={() => chooseView(item.key)}>{item.label}</button>)}</nav>

        <div className="interpretation-scroll">
          {!visibleInterpretation && !error ? <div className="interpretation-loading"><LoaderCircle className="spin"/><span>正在组织指标、证据和比较信息</span></div> : null}
          {error && visibleInterpretation ? <div className="interpretation-inline-error"><AlertTriangle size={16}/><span>{error}</span></div> : null}
          {visibleInterpretation ? <InterpretationContent interpretation={visibleInterpretation} view={view} selectedCitation={selectedCitation} pageReference={visiblePageReference} onCitation={chooseCitation}/> : null}
        </div>
      </main>
    </div>

    {feedbackOpen ? <div className="interpretation-feedback-layer" role="presentation"><button className="interpretation-feedback-scrim" aria-label="关闭问题反馈" onClick={() => setFeedbackOpen(false)}/><form className="interpretation-feedback" role="dialog" aria-modal="true" aria-label="报告解读问题" onSubmit={submitFeedback}><header><div><MessageSquareWarning size={17}/><strong>报告解读问题</strong></div><button type="button" className="icon-button" onClick={() => setFeedbackOpen(false)} aria-label="关闭"><X size={17}/></button></header><p>该反馈用于修正数据和自动解读，不会直接改变企业风险等级。</p><fieldset><legend>问题类型</legend>{feedbackOptions.map(([value, label]) => <label key={value} className={feedbackCategory === value ? "selected" : ""}><input type="radio" name="feedback" value={value} checked={feedbackCategory === value} onChange={() => setFeedbackCategory(value)}/><span>{label}</span></label>)}</fieldset><label className="field-label"><span>补充说明</span><textarea value={feedbackNote} onChange={(event) => setFeedbackNote(event.target.value)} placeholder="指出错误位置或正确关联，便于后续处理"/></label><footer><button type="button" className="secondary-button" onClick={() => setFeedbackOpen(false)}>取消</button><button className="primary-button" disabled={feedbackSaving}>{feedbackSaving ? "记录中…" : "记录问题"}</button></footer></form></div> : null}
    </div>
  </>;
}

function InterpretationContent({ interpretation, view, selectedCitation, pageReference, onCitation }: { interpretation: RiskInterpretation; view: RiskInterpretationFocus; selectedCitation?: RiskInterpretationCitation; pageReference: EvidencePageReference | null; onCitation: (citation: RiskInterpretationCitation) => void }) {
  const showSummary = view === "overview";
  const showDrivers = view === "overview" || view === "drivers";
  const showEvidence = view === "overview" || view === "drivers" || view === "evidence";
  const [expandedDrivers, setExpandedDrivers] = useState<Set<string>>(() => new Set());
  function toggleDriver(metricCode: string) {
    setExpandedDrivers((current) => {
      const next = new Set(current);
      if (next.has(metricCode)) next.delete(metricCode);
      else next.add(metricCode);
      return next;
    });
  }
  return <>
    <section className={`interpretation-thesis ${showSummary ? "" : "compact"}`}><div className="interpretation-ai-mark"><Sparkles size={16}/><span>AI 研究摘要</span></div>{showSummary ? <><h4>{interpretation.headline}</h4><p>{interpretation.summary}</p></> : null}<div className="interpretation-research-brief"><article><small>核心判断</small><p>{interpretation.researchBrief.finding}</p></article><article><small>证据强度</small><p>{interpretation.researchBrief.evidenceAssessment}</p></article><article><small>模型交叉</small><p>{interpretation.researchBrief.modelAgreement}</p></article><article><small>优先核验</small><p>{interpretation.researchBrief.priorityAction}</p></article></div><div className="interpretation-thesis-meta"><span>综合指数 <strong>{formatPercent(interpretation.finalIndex)}</strong></span><span>不确定性 <strong className={`uncertainty-${interpretation.uncertainty.level}`}>{uncertaintyLabel(interpretation.uncertainty.level)}</strong></span><span>证据覆盖 <strong>{interpretation.evidenceCoverage}%</strong></span><span>稳健性视角 <strong>{robustnessLabel(interpretation.robustness.coverage)}</strong></span></div></section>

    {showDrivers ? <section className="interpretation-section"><header><div><span className="section-kicker">RISK DRIVERS</span><h4>风险来源</h4></div><small>按风险方向值排序</small></header><div className="interpretation-driver-grid">{interpretation.drivers.map((driver) => <article key={driver.metricCode} className={`driver-card ${driver.status}`}><div><span>{metricDisplayCode(driver.metricCode)}</span><strong>{formatPercent(driver.riskValue)}</strong></div><h5>{driver.label}</h5><p>{driver.explanation}</p><footer><span>阈值 {formatPercent(driver.threshold)}</span><span>{driver.citationIds.length} 条引用</span></footer></article>)}</div></section> : null}

    {view === "overview" || view === "history" || view === "industry" ? <section className="interpretation-comparisons"><article className={interpretation.history.available ? "available" : "unavailable"}><span><TrendingUp size={15}/>历史变化</span><strong>{interpretation.history.available ? formatDelta(interpretation.history.delta) : "不可比较"}</strong><p>{interpretation.history.text}</p></article><article className={interpretation.industry.available ? "available" : "unavailable"}><span><Building2 size={15}/>行业位置</span><strong>{interpretation.industry.available ? formatDelta(interpretation.industry.delta) : "样本不足"}</strong><p>{interpretation.industry.text}</p></article></section> : null}

    {showEvidence ? <section className="interpretation-section evidence-ledger"><header><div><span className="section-kicker">EVIDENCE LEDGER</span><h4>证据账本</h4></div><small>AI 判断 · 证据关系 · 核验动作</small></header><div className="evidence-ledger-list">{interpretation.drivers.map((driver, index) => {
      const citations = interpretation.citations.filter((item) => driver.citationIds.includes(item.id));
      const primaryId = driver.supportingCitationIds[0] ?? driver.counterCitationIds[0] ?? citations[0]?.id;
      const primaryCitation = citations.find((item) => item.id === primaryId) ?? citations[0];
      const secondaryCitations = citations.filter((item) => item.id !== primaryCitation?.id);
      const expanded = expandedDrivers.has(driver.metricCode);
      return <article key={driver.metricCode} className={`ledger-entry ${driver.status}`}><header><div><span className="ledger-index">{String(index + 1).padStart(2, "0")}</span><small>{metricDisplayCode(driver.metricCode)}</small><strong>{driver.label}</strong></div><div><span>{driver.status === "attention" ? "优先复核" : driver.status === "watch" ? "持续观察" : "输入不足"}</span><strong>{formatPercent(driver.riskValue)}</strong></div></header><div className="ledger-entry-body"><div className="ledger-analysis"><section className="ledger-finding"><small>AI 判断</small><p>{driver.finding}</p></section><div className="ledger-analysis-grid"><section><small>为什么重要</small><p>{driver.whyItMatters}</p></section><section><small>证据怎么说</small><p>{driver.evidenceAssessment}</p></section><section className="gap"><small>仍然缺什么</small><p>{driver.evidenceGap}</p></section><section className="action"><small>下一步核验</small><p>{driver.nextAction}</p></section></div></div><div className="ledger-sources">{primaryCitation ? <><span className="ledger-source-caption">主证据 · 默认展开</span><EvidenceLedgerSource citation={primaryCitation} relation={driver.evidenceRelations.find((item) => item.citationId === primaryCitation.id)} selected={selectedCitation?.id === primaryCitation.id} onCitation={onCitation}/>{secondaryCitations.length ? <button type="button" className="ledger-expand" aria-expanded={expanded} onClick={() => toggleDriver(driver.metricCode)}>{expanded ? "收起次级证据" : `展开其余 ${secondaryCitations.length} 条证据`}</button> : null}{expanded ? <div className="ledger-secondary-sources">{secondaryCitations.map((citation) => <EvidenceLedgerSource key={citation.id} citation={citation} relation={driver.evidenceRelations.find((item) => item.citationId === citation.id)} selected={selectedCitation?.id === citation.id} onCitation={onCitation}/>)}</div> : null}</> : <div className="ledger-missing"><AlertTriangle size={14}/><span>当前指标没有可定位引用，AI 已把它保留为证据缺口，不能视为已核实事实。</span></div>}</div></div></article>;
    })}</div>{selectedCitation ? <div className="interpretation-source-reader"><header><span><FileText size={14}/>{selectedCitation.label}</span><code>{selectedCitation.sourceLabel}</code></header><p>{pageReference?.text || selectedCitation.excerpt}</p><small>{pageReference ? `只读文本定位 · 第 ${pageReference.page}/${pageReference.pageCount} 页` : "当前展示结构化证据摘录"}</small></div> : null}</section> : null}

    {view === "overview" || view === "evidence" ? <section className="interpretation-bottom-grid"><article><header><AlertTriangle size={15}/><h4>证据与数据缺口</h4></header>{interpretation.evidenceGaps.length ? <ul>{interpretation.evidenceGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul> : <div className="interpretation-ok"><CheckCircle2 size={15}/>当前未发现阻断解读的主要缺口</div>}<small>不确定性：{interpretation.uncertainty.reasons.join("；")}</small></article><article><header><CheckCircle2 size={15}/><h4>建议研究动作</h4></header><ol>{interpretation.recommendedActions.map((action) => <li key={action}>{action}</li>)}</ol><small>建议用于后续研究，不替代专业判断。</small></article></section> : null}

    <footer className="interpretation-method-boundary">数据版本 {interpretation.versions.data} · 模型 {interpretation.versions.model} · 评分 {interpretation.versions.score} · 风险结果仅用于研究筛查，不构成企业漂绿认定。</footer>
  </>;
}

function EvidenceLedgerSource({ citation, relation, selected, onCitation }: { citation: RiskInterpretationCitation; relation?: RiskInterpretation["drivers"][number]["evidenceRelations"][number]; selected: boolean; onCitation: (citation: RiskInterpretationCitation) => void }) {
  return <button type="button" className={`ledger-source ${selected ? "selected" : ""}`} onClick={() => onCitation(citation)}><span><Quote size={13}/>{citation.label}<em className={`relation-${relation?.relation ?? "context"}`}>{relationLabel(relation?.relation)}</em><em className={`statement-${citation.kind}`}>{statementLabel(citation.kind)}</em></span><strong>{citation.excerpt}</strong>{relation ? <p>{relation.relevance}</p> : null}<small title={citation.sourceLabel}>{shortSourceLabel(citation.sourceLabel)}{citation.eventDate ? ` · ${citation.eventDate}` : ""}</small></button>;
}

function StatePanel({ title, detail }: { title: string; detail: string }) { return <div className="state-panel"><RefreshCw/><h2>{title}</h2><p>{detail}</p><button className="primary-button" onClick={() => location.reload()}>重新载入</button></div>; }
function validView(value: string | null): RiskInterpretationFocus { return views.some((item) => item.key === value) ? value as RiskInterpretationFocus : "overview"; }
function updateUrl(router: ReturnType<typeof useRouter>, pathname: string, params: URLSearchParams | ReadonlyURLSearchParams, updates: Record<string, string | null>) { const next = new URLSearchParams(params.toString()); Object.entries(updates).forEach(([key, value]) => value == null || value === "" ? next.delete(key) : next.set(key, value)); router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }); }
type ReadonlyURLSearchParams = ReturnType<typeof useSearchParams>;
function priorityScore(company: CompanyYearRecord) { const risk = ({ high: 400, medium: 250, low: 100, unavailable: 180 } as const)[company.riskBand]; const evidence = 100 - company.evidenceCoverage; const linkage = company.evidenceLinkageStatus === "linked" ? 0 : 80; return risk + evidence + linkage + company.eventCount; }
function riskLabel(band: CompanyYearRecord["riskBand"]) { return ({ high: "高风险信号", medium: "中风险信号", low: "低风险信号", unavailable: "暂不可评分" } as const)[band]; }
function uncertaintyLabel(level: RiskInterpretation["uncertainty"]["level"]) { return ({ low: "较低", medium: "中等", high: "较高", unavailable: "不可判定" } as const)[level]; }
function statementLabel(kind: RiskInterpretationCitation["kind"]) { return ({ fact: "事实", inference: "待核验", unknown: "未知" } as const)[kind]; }
function metricDisplayCode(code: RiskInterpretation["drivers"][number]["metricCode"]) { return ({ ESGSI: "ESI", EAA_ESI: "EAA-ESI" } as Partial<Record<RiskInterpretation["drivers"][number]["metricCode"], string>>)[code] ?? code; }
function relationLabel(relation: RiskInterpretation["drivers"][number]["evidenceRelations"][number]["relation"] | undefined) { return ({ supporting: "支持", counter: "反向", context: "背景" } as const)[relation ?? "context"]; }
function robustnessLabel(coverage: RiskInterpretation["robustness"]["coverage"]) { return ({ three_views: "EAA-ESI / GSI / Red Flag", two_views: "EAA-ESI / Red Flag", primary_only: "仅 EAA-ESI" } as const)[coverage]; }
function shortSourceLabel(value: string) { return value.length > 42 ? `${value.slice(0, 39)}…` : value; }
function formatPercent(value: number | null | undefined) { return value == null ? "--" : `${Math.round(value * 100)}%`; }
function formatDelta(value: number | undefined) { if (value == null) return "--"; return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}pp`; }
function toMarkdown(item: RiskInterpretation) { return [`# ${item.companyName} ${item.reportYear} 年 ESG 风险解读`, "", `> ${item.headline}`, "", item.summary, "", "## AI 研究摘要", `- 核心判断：${item.researchBrief.finding}`, `- 证据强度：${item.researchBrief.evidenceAssessment}`, `- 模型交叉：${item.researchBrief.modelAgreement}`, `- 优先核验：${item.researchBrief.priorityAction}`, "", "## 主要风险来源", ...item.drivers.flatMap((driver) => [`### ${driver.metricCode} ${driver.label} · ${formatPercent(driver.riskValue)}`, `- 判断：${driver.finding}`, `- 为什么重要：${driver.whyItMatters}`, `- 证据评估：${driver.evidenceAssessment}`, `- 证据缺口：${driver.evidenceGap}`, `- 下一步：${driver.nextAction}`]), "", "## 证据引用", ...(item.citations.length ? item.citations.map((citation, index) => `${index + 1}. ${citation.label}｜${citation.sourceLabel}\n   ${citation.excerpt}`) : ["- 当前没有可引用证据。"]), "", "## 不确定性与证据缺口", ...item.evidenceGaps.map((gap) => `- ${gap}`), `- 不确定性：${uncertaintyLabel(item.uncertainty.level)}（${item.uncertainty.reasons.join("；")}）`, "", "## 比较", `- ${item.history.text}`, `- ${item.industry.text}`, "", "## 建议研究动作", ...item.recommendedActions.map((action) => `- ${action}`), "", `数据版本：${item.versions.data}｜模型：${item.versions.model}｜评分：${item.versions.score}`, "", "风险结果仅用于研究筛查，不构成企业漂绿认定。"].join("\n"); }
