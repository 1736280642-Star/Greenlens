"use client";

import { AlertTriangle, Bot, CalendarDays, ChevronRight, Download, ExternalLink, FileText, GitCompareArrows, MoreHorizontal, RefreshCw, Search, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { analysisRepository } from "@/repositories";
import { useDemoStore } from "@/stores/demo-store";
import { formatDecimal, formatMetricPercent, formatPercent, getMetric, type CompanyMetricHistoryPoint, type CompanyYearRecord, type EsgRatingRecord, type EvidenceItem, type MetricCode, type ViolationEvent } from "@/types";

type Tab = "overview" | "evidence" | "facts" | "ratings" | "history";

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const requestedYear = Number(search.get("year") ?? 2024);
  const reportYear = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100 ? requestedYear : 2024;
  const router = useRouter();
  const [company, setCompany] = useState<CompanyYearRecord | null>(null);
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [events, setEvents] = useState<ViolationEvent[]>([]);
  const [history, setHistory] = useState<CompanyMetricHistoryPoint[]>([]);
  const [ratings, setRatings] = useState<EsgRatingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfRef, setPdfRef] = useState<{ sourceLabel: string; page: number; pageCount: number; text: string } | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const tab = (search.get("tab") ?? "overview") as Tab;
  const evidenceId = search.get("evidence");
  const { toggleCompare, compareIds, selectCompany, selectEvidence, notify, showToast } = useDemoStore();

  useEffect(() => {
    let active = true;
    Promise.all([
      analysisRepository.getCompany(id, "success", reportYear),
      analysisRepository.listEvidence(id, "success", reportYear),
      analysisRepository.listViolationEvents(id, { fromYear: reportYear - 4, toYear: reportYear }),
      analysisRepository.getCompanyHistory(id, { fromYear: reportYear - 9, toYear: reportYear }),
      analysisRepository.listEsgRatings(id, { fromYear: reportYear - 4, toYear: reportYear }),
    ])
      .then(([record, evidence, violationItems, historyItems, ratingItems]) => { if (active) { setCompany(record); setItems(evidence); setEvents(violationItems); setHistory(historyItems); setRatings(ratingItems); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "企业分析请求失败。"); })
      .finally(() => { if (active) setLoading(false); });
    selectCompany(id, reportYear);
    return () => { active = false; };
  }, [id, reportYear, selectCompany]);
  useEffect(() => { if (evidenceId) selectEvidence(evidenceId); }, [evidenceId, selectEvidence]);
  if (loading) return <div className="page"><div className="skeleton skeleton-header"/><div className="panel skeleton-panel"/></div>;
  if (error) return <div className="state-panel"><AlertTriangle size={24}/><h2>企业分析载入失败</h2><p><strong>成因：</strong>{error}<br/><strong>影响：</strong>当前不能查看指标公式或证据链。<br/><strong>下一步：</strong>检查 Repository 配置或后端状态后重试。</p><button className="primary-button" onClick={() => location.reload()}><RefreshCw size={15}/>重新载入</button></div>;
  if (!company) return <div className="state-panel"><Search size={24}/><h2>未找到公司记录</h2><p>当前公司 ID 没有匹配的公司-年份数据，可能已被移除或链接已失效。</p><Link className="primary-button" href="/companies">返回企业库</Link></div>;
  const currentEvidence = items.find((item) => item.id === evidenceId) ?? items[0];

  function setTab(next: Tab, evidence?: string) { const query = new URLSearchParams(search.toString()); query.set("tab", next); if (evidence) query.set("evidence", evidence); router.replace(`/companies/${id}?${query}`); }
  function openEvidence(evidence: string) { selectEvidence(evidence); setTab("evidence", evidence); }
  function openReview(evidence?: string, assistant = false) {
    const query = new URLSearchParams({ companyId: id, year: String(reportYear) });
    if (evidence) query.set("evidence", evidence);
    if (assistant) query.set("assistant", "open");
    router.push(`/review?${query}`);
  }
  async function openPdf(evidence: EvidenceItem) {
    if (!company || !evidence.page) return;
    setPdfLoading(true);
    try {
      const reference = await analysisRepository.getEvidencePageText(company.companyId, evidence.id);
      if (reference) {
        setPdfRef({ sourceLabel: reference.sourceLabel, page: reference.page, pageCount: reference.pageCount, text: reference.text });
        setPdfPage(reference.page);
        setPdfOpen(true);
      } else {
        showToast("该证据没有可用的 PDF 原文");
      }
    } catch (reason) {
      showToast(`PDF 原文读取失败：${reason instanceof Error ? reason.message : "数据接口未响应"}`);
    } finally {
      setPdfLoading(false);
    }
  }
  async function changePdfPage(next: number) {
    if (!company || !currentEvidence || next < 1) return;
    setPdfPage(next);
    setPdfLoading(true);
    try {
      const reference = await analysisRepository.getEvidencePageText(company.companyId, currentEvidence.id, next);
      if (reference) setPdfRef({ sourceLabel: reference.sourceLabel, page: reference.page, pageCount: reference.pageCount, text: reference.text });
    } catch {
      // Keep the currently loaded page text when the adjacent page is unavailable.
    } finally {
      setPdfLoading(false);
    }
  }
  function exportSummary() {
    if (!company) return;
    const text = `数据版本：${company.versions.data}。风险结果仅作为待复核信号。\n\n${company.companyName} 研究摘要\nE-AA-ESGSI：${formatPercent(company.finalIndex)}\nEASS：${formatMetricPercent(company,"EASS")}\nIR：${formatMetricPercent(company,"IR")}\nUPR：${formatMetricPercent(company,"UPR")}\n证据完整度：${company.evidenceCoverage}%\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = `${company.companyId}-research-${new Date().toISOString().slice(0,10)}.txt`; a.click(); URL.revokeObjectURL(url);
    notify("研究摘要已导出", `${company.companyName}当前研究摘要已生成。`); showToast("研究摘要已导出");
  }

  return <div className="page company-detail-page">
    <header className="company-header"><div className="breadcrumbs"><Link href="/companies">企业</Link><ChevronRight size={13}/><span>{company.companyName}</span></div><div className="company-title-row"><div><div className="company-title"><h2>{company.companyName}</h2><span className="demo-badge">LIVE DATA</span></div><p><code>{company.stockCode}</code> · {company.industry} · 报告年度 {company.reportYear}</p></div><div className="header-actions"><button className="secondary-button" onClick={() => { if (!toggleCompare(company.companyId)) showToast("最多同时比较 5 家"); }}><GitCompareArrows size={15}/>{compareIds.includes(company.companyId) ? "移出对比" : "加入对比"}</button><button className="secondary-button" onClick={exportSummary}><Download size={15}/>导出摘要</button><button className="primary-button" onClick={() => openReview(currentEvidence?.id ?? getMetric(company,"UPR")?.evidenceIds[0])}><ShieldAlert size={15}/>发起复核</button><button className="icon-button" title="复制分析链接" aria-label="复制分析链接" onClick={() => { navigator.clipboard.writeText(location.href); showToast("分析链接已复制"); }}><MoreHorizontal/></button></div></div><div className="company-meta"><span>报告发布日 <code>{company.publishDate}</code></span><span>数据版本 <code>{company.versions.data}</code></span><span>评分版本 <code>{company.versions.model}</code></span><span>复核状态 <code>{company.reviewStatus}</code></span></div></header>
    <section className="risk-summary-band"><button><span>E-AA-ESGSI</span><strong className="risk-score">{formatPercent(company.finalIndex)}</strong><em>{company.riskBand==="high"?"高风险，建议优先复核":company.riskBand==="medium"?"中风险，建议核验":company.riskBand==="low"?"低风险信号":"暂不可评分，需补充输入"}</em></button><button><span>EASS</span><strong className="risk-score">{formatMetricPercent(company,"EASS")}</strong><em>越高表示行动越实质</em></button><button><span>IR / UPR</span><strong>{formatMetricPercent(company,"IR")} / {formatMetricPercent(company,"UPR")}</strong><em>模糊声明 / 未验证计划</em></button><button onClick={() => { const evidenceId=getMetric(company,"UPR")?.evidenceIds[0]; if(evidenceId) openEvidence(evidenceId); }}><span>主要原因</span><strong>未验证计划比例</strong><em>定位分子与证据 →</em></button></section>
    <nav className="tabs" aria-label="企业分析视图">{[["overview","总览"],["evidence","报告证据"],["facts","外部事实"],["ratings","评级分歧"],["history","历史变化"]].map(([key,label]) => <button className={tab === key ? "active" : ""} onClick={() => setTab(key as Tab)} key={key}>{label}</button>)}</nav>
    {tab === "overview" && <Overview company={company} onEvidence={openEvidence} />}
    {tab === "evidence" && <LiveEvidenceView items={items} current={currentEvidence} onSelect={(item) => { selectEvidence(item.id); setTab("evidence", item.id); }} onAI={() => openReview(currentEvidence?.id, true)} onReview={() => openReview(currentEvidence?.id)} onPdf={(item) => void openPdf(item)} />}
    {tab === "facts" && <FactsView events={events} evidenceId={items.find((item) => item.type === "external")?.id} onReview={(evidence) => openReview(evidence)} />}
    {tab === "ratings" && <LiveRatingsView ratings={ratings} reportYear={reportYear} />}
    {tab === "history" && <HistoryView company={company} history={history} />}
    {pdfOpen && <div className="modal-scrim"><section className="modal pdf-modal" role="dialog" aria-modal="true" aria-label="PDF 原文查看器"><header><div><FileText size={17}/><h3>{pdfRef?.sourceLabel ?? "PDF 原文"}</h3><code>第 {pdfPage} 页</code></div><button className="icon-button" onClick={() => setPdfOpen(false)} aria-label="关闭 PDF 查看器"><X/></button></header>{pdfRef && <div className="pdf-toolbar"><button className="secondary-button" disabled={pdfPage <= 1 || pdfLoading} onClick={() => void changePdfPage(pdfPage - 1)}>上一页</button><span>{pdfPage} / {pdfRef.pageCount}</span><button className="secondary-button" disabled={pdfPage >= pdfRef.pageCount || pdfLoading} onClick={() => void changePdfPage(pdfPage + 1)}>下一页</button></div>}<div className="pdf-page"><span>GREENLENS READ-ONLY SOURCE</span><h3>第 {pdfPage} 页</h3>{pdfLoading ? <p>正在载入原文…</p> : <p className="pdf-highlight">{pdfRef?.text || "当前页没有可展示的文本层。"}</p>}<small>{pdfPage}</small></div></section></div>}
  </div>;
}

function Overview({ company, onEvidence }: { company: CompanyYearRecord; onEvidence: (id: string) => void }) {
  const actions=company.environmentalActions; const focus=company.esgTopics;
  const uprEvidence=getMetric(company,"UPR")?.evidenceIds[0]; const eassEvidence=getMetric(company,"EASS")?.evidenceIds[0]; const esgsiEvidence=getMetric(company,"ESGSI")?.evidenceIds[0];
  return <div className="detail-grid metric-detail-grid"><section className="panel"><header className="panel-header"><div><h3>核心指标</h3><p>原始值、归一化值与风险方向分开</p></div><code>{company.versions.score}</code></header><div className="panel-body metric-ledger detail-ledger">{company.metrics.map((metric)=><button className="ledger-row" key={metric.code} disabled={!metric.evidenceIds[0]} onClick={()=>metric.evidenceIds[0]&&onEvidence(metric.evidenceIds[0])}><span><strong>{metric.code.replace("EAA_ESGSI","E-AA-ESGSI")}</strong><small>{metric.label}</small></span><span className="ledger-meter"><i style={{width:`${(metric.riskValue??0)*100}%`}}/><b style={{left:`${(metric.threshold??.5)*100}%`}}/></span><code>{formatPercent(metric.normalizedValue)}</code></button>)}</div><div className="index-waterfall detail-waterfall"><span><small>ESGSI</small><strong>{formatDecimal(company.indexBreakdown.baseEsgsiNormalized)}</strong></span><i>+</i><span><small>行动</small><strong>{formatDecimal(company.indexBreakdown.actionPenalty.contribution)}</strong></span><i>+</i><span><small>模糊</small><strong>{formatDecimal(company.indexBreakdown.indeterminatePenalty.contribution)}</strong></span><i>+</i><span><small>计划</small><strong>{formatDecimal(company.indexBreakdown.planningPenalty.contribution)}</strong></span><i>=</i><span className="final"><small>原始 / 归一化</small><strong>{formatDecimal(company.indexBreakdown.finalRaw)} / {formatDecimal(company.indexBreakdown.finalNormalized)}</strong></span></div></section><section className="panel"><header className="panel-header"><div><h3>文本与 ESG 关注度</h3><p>预处理输出与 E/S/G 结构</p></div></header><div className="text-stat-grid"><span><small>总词数</small><strong>{company.textProcessing.totalWords.toLocaleString()}</strong></span><span><small>环境句</small><strong>{company.textProcessing.environmentalSentenceCount.toLocaleString()}</strong></span><span><small>Tokens</small><strong>{company.textProcessing.tokenCount.toLocaleString()}</strong></span><span><small>失衡</small><strong>{Math.round(focus.imbalanceScore*100)}%</strong></span></div><div className="focus-bars">{[["E",focus.eCount,focus.eFocus,"#30D5E8"],["S",focus.sCount,focus.sFocus,"#5B8CFF"],["G",focus.gCount,focus.gFocus,"#E879F9"]].map(([label,count,value,color])=><div key={label as string}><span><strong>{label}</strong><code>{count as number} · {(Number(value)*100).toFixed(2)}%</code></span><i><b style={{width:`${Math.min(100,Number(value)*5000)}%`,background:color as string}}/></i></div>)}</div><div className="action-composition-detail"><span><strong>行动分类</strong><code>{actions.totalStatements} 条</code></span><div className="action-stack"><i style={{width:`${actions.totalStatements?actions.implemented/actions.totalStatements*100:0}%`,background:"#38E07B"}}/><i style={{width:`${actions.totalStatements?actions.planning/actions.totalStatements*100:0}%`,background:"#5B8CFF"}}/><i style={{width:`${actions.totalStatements?actions.indeterminate/actions.totalStatements*100:0}%`,background:"#F4D35E"}}/></div><small>已实施 {actions.implemented} · 计划 {actions.planning} · 模糊 {actions.indeterminate}</small></div></section><section className="panel evidence-table-panel"><header className="panel-header"><div><h3>关键证据</h3><p>指标可回溯到分子、分母与原文</p></div></header><div className="evidence-rows"><button disabled={!uprEvidence} onClick={()=>uprEvidence&&onEvidence(uprEvidence)}><i className="warning"/><span><strong>UPR：计划缺少基准年与阶段目标</strong><small>报告第 42 页 · 分子证据</small></span><ChevronRight/></button><button disabled={!eassEvidence} onClick={()=>eassEvidence&&onEvidence(eassEvidence)}><i className="pending"/><span><strong>EASS：行动仍处于计划阶段</strong><small>报告第 43 页 · 行动分类</small></span><ChevronRight/></button><button disabled={!esgsiEvidence} onClick={()=>esgsiEvidence&&onEvidence(esgsiEvidence)}><i className="danger"/><span><strong>ESGSI：实质信息缺少可比数据</strong><small>报告第 47 页 · 量化证据</small></span><ChevronRight/></button></div></section><section className="panel next-actions"><header className="panel-header"><h3>下一步建议</h3></header><ol><li><span>核验</span>确认计划的时间、KPI、方法和路径</li><li><span>复核</span>抽查环境行动三分类</li><li><span>补充</span>确认第三方鉴证范围</li></ol></section></div>;
}

function LiveEvidenceView({ items, current, onSelect, onAI, onReview, onPdf }: { items: EvidenceItem[]; current?: EvidenceItem; onSelect: (item: EvidenceItem) => void; onAI: () => void; onReview: () => void; onPdf: (item: EvidenceItem) => void }) {
  if (!current) return <div className="state-panel"><FileText/><h2>暂无报告证据</h2><p>当前公司年度尚未形成可展示的结构化证据记录。</p></div>;
  return <div className="evidence-workspace">
    <aside className="evidence-nav"><label><Search size={15}/><input placeholder="搜索证据元数据"/></label><span className="section-kicker">证据索引</span>{items.filter((item) => item.type !== "external").map((item) => <button className={current.id === item.id ? "active" : ""} key={item.id} onClick={() => onSelect(item)}><span>{item.page ? `第 ${item.page} 页` : "页码缺失"}</span><strong>{item.title}</strong><small>{item.actionClass ?? item.type} · {item.status === "insufficient" ? "证据不足" : "待复核"}</small></button>)}</aside>
    <article className="evidence-document"><header><span>{current.page ? `第 ${current.page} 页` : "页码缺失"}</span><code>{current.sourceLabel}</code><button className="secondary-button" disabled={!current.page} onClick={() => onPdf(current)}><FileText size={14}/>查看原 PDF</button></header><div className="document-sheet"><span className="section-kicker">READ-ONLY SOURCE REFERENCE</span><h3>{current.title}</h3><p>{current.excerpt || "该证据没有可展示的原文段落。"}</p><p><strong>证据类型：</strong>{current.type}　<strong>行动分类：</strong>{current.actionClass ?? "未分类"}　<strong>复核状态：</strong>{current.status}</p></div></article>
    <aside className="evidence-explanation"><span className={`status-chip ${current.status}`}>{current.status === "insufficient" ? "证据不足" : "待复核"}</span><h3>{current.title}</h3><p>原文段落由后端从 PDF 文本层提取并持久化；「查看原 PDF」仅返回证据定位页的只读文本，不下发文件本体。</p><dl><div><dt>来源文件</dt><dd>{current.sourceLabel}</dd></div><div><dt>定位页码</dt><dd>{current.page ?? "--"}</dd></div><div><dt>结构化分类</dt><dd>{current.actionClass ?? current.type}</dd></div></dl><div className="inline-actions"><button className="secondary-button" onClick={onReview}>加入复核</button><button className="primary-button" onClick={onAI}><Bot size={15}/>询问 AI</button></div></aside>
  </div>;
}

const vendorLabels: Record<string, string> = {
  csmar_shangdao: "商道融绿 (CSMAR)",
  csmar_runling: "润灵环球 (CSMAR)",
  wind_shangdao: "商道融绿 (Wind)",
  huazheng: "华证",
  msci: "MSCI",
  bloomberg: "彭博",
  cnrds: "CNRDS",
  wind: "Wind ESG",
  menglang: "盟浪",
  ftse: "富时罗素",
  hexun: "和讯",
};

function LiveRatingsView({ ratings, reportYear }: { ratings: EsgRatingRecord[]; reportYear: number }) {
  const filtered = ratings.filter((item) => item.reportYear >= reportYear - 4 && item.reportYear <= reportYear);
  if (!filtered.length) return <div className="state-panel"><ShieldAlert/><h2>暂无外部评级数据</h2><p>当前公司报告年度区间内没有可用的外部 ESG 评级记录。</p></div>;
  const vendors = [...new Set(filtered.map((item) => item.vendor))].sort();
  const years = [...new Set(filtered.map((item) => item.reportYear))].sort((a, b) => a - b);
  return <section className="panel ratings-detail"><header className="panel-header"><div><h3>多源外部 ESG 评级</h3><p>各来源独立展示，不以均值替代原始评分；数值量纲见评分尺度列</p></div><code>{years.length} 年 × {vendors.length} 家来源</code></header>
    <div className="data-table-wrap"><table className="data-table ratings-table"><thead><tr><th>来源</th>{years.map((year) => <th key={year} className="numeric">{year}</th>)}<th>评分尺度</th></tr></thead>
    <tbody>{vendors.map((vendor) => { const vendorRows = filtered.filter((item) => item.vendor === vendor); return <tr key={vendor}><td><strong>{vendorLabels[vendor] ?? vendor}</strong></td>{years.map((year) => { const row = vendorRows.find((item) => item.reportYear === year); return <td key={year} className="numeric">{row ? (row.rating || (row.score == null ? "--" : row.score)) : "—"}</td>; })}<td>{vendorRows[0]?.scoreScale ?? "--"}</td></tr>; })}</tbody></table></div>
    <div className="method-note"><strong>如何理解分歧</strong><p>不同机构的覆盖范围、年份口径与归一化方式不同；离散程度仅作为补充证据，不直接等同于综合风险。</p></div>
  </section>;
}

function FactsView({ events, evidenceId, onReview }: { events: ViolationEvent[]; evidenceId?: string; onReview: (id: string) => void }) {
  const [selected, setSelected] = useState(0);
  const showToast = useDemoStore((state) => state.showToast);
  if (!events.length) return <div className="state-panel"><CalendarDays/><h2>暂无违规或监管事件</h2><p>当前公司与时间范围没有返回可核验的外部事件，系统不会把缺失事件解释为低风险。</p></div>;
  const selectedIndex = Math.min(selected, events.length - 1);
  const current = events[selectedIndex];
  return <div className="facts-layout"><section className="panel event-timeline"><header className="panel-header"><h3>违规与监管事件</h3><span>违规年度 ≠ 公告日期</span></header>{events.map((event,index)=><button className={selectedIndex===index?"selected":""} onClick={()=>setSelected(index)} key={event.id}><span><CalendarDays size={15}/>{event.announcementDate}</span><strong>{event.title ?? event.violationTypes.join("、")}</strong><small>{event.authority ?? event.sourceLabel}</small></button>)}</section><section className="panel fact-detail"><header className="panel-header"><div><h3>{current.title ?? current.violationTypes.join("、")}</h3><p>{current.announcementDate} · {current.authority ?? current.sourceLabel}</p></div><span className={`status-chip ${current.reviewStatus}`}>{current.reviewStatus === "verified" ? "已核验" : current.reviewStatus === "insufficient" ? "证据不足" : "待复核"}</span></header><div className="panel-body"><p>{current.behavior}</p><div className="fact-metrics"><div><span>关联主体</span><strong>{current.relation ?? "待确认"}</strong><small>{current.subjectName ?? "主体名称缺失"}</small></div><div><span>违规年度</span><strong>{current.violationYears.join(" / ")}</strong><small>{current.violationTypes.join("、")}</small></div><div><span>处罚金额</span><strong>{current.companyPenalty == null ? "未披露" : `¥${current.companyPenalty.toLocaleString()}`}</strong><small>{current.action}</small></div></div><fieldset><legend>人工判断</legend>{["相关","不相关","部分相关","无法判断"].map((label)=><button key={label} disabled={!evidenceId} onClick={()=>evidenceId&&onReview(evidenceId)}>{label}</button>)}</fieldset>{current.sourceUrl&&<a href={current.sourceUrl} onClick={(event)=>{event.preventDefault();showToast("虚构来源不发起外部访问");}} className="source-link">查看虚构来源 <ExternalLink size={13}/></a>}</div></section></div>;
}
function HistoryView({ company, history }: { company: CompanyYearRecord; history: CompanyMetricHistoryPoint[] }) {
  const options: Array<[string, MetricCode | "FINAL"]> = [["E-AA-ESGSI","FINAL"],["EASS","EASS"],["IR","IR"],["UPR","UPR"],["ESGSI","ESGSI"],["Imbalance","IMBALANCE"]];
  const [metric,setMetric]=useState(options[0][0]);
  const [showTable,setShowTable]=useState(false);
  const code=options.find(([label])=>label===metric)?.[1]??"FINAL";
  const rows=history.map((point)=>({ year: point.reportYear, value: code==="FINAL" ? point.finalIndex : point.metrics[code]?.normalizedValue ?? null }));
  const chartRows=rows.filter((row): row is {year:number;value:number}=>row.value!=null);
  const width=700; const startX=55; const step=chartRows.length>1?width/(chartRows.length-1):0;
  const points=chartRows.map((row,index)=>`${startX+index*step},${240-row.value*180}`).join(" ");
  return <section className="panel history-view"><header className="panel-header"><div><h3>跨年指标变化</h3><p>{company.panelMetadata.firstYear}–{company.panelMetadata.lastYear} 公司年度序列；缺失年份保留断点</p></div><select value={metric} onChange={(e)=>setMetric(e.target.value)}>{options.map(([label])=><option key={label}>{label}</option>)}</select></header>{chartRows.length?<><div className="history-chart"><svg viewBox="0 0 800 280"><line x1="40" y1="240" x2="770" y2="240"/><polyline points={points}/><g>{chartRows.map((row,index)=><circle key={`${metric}-${row.year}`} cx={startX+index*step} cy={240-row.value*180} r={row.year===company.reportYear?6:4}/>)}</g>{chartRows.map((row,index)=><text key={row.year} x={startX-14+index*step} y="265">{row.year}</text>)}</svg><span>{metric} · metric-contract-v2 · {history[0]?.dataVersion}</span></div><button className="text-button" onClick={()=>setShowTable(!showTable)}>{showTable?"隐藏数据表":"查看数据表"}</button>{showTable&&<div className="data-table-wrap"><table className="data-table"><thead><tr><th>年份</th><th className="numeric">{metric}</th></tr></thead><tbody>{rows.map((row)=><tr key={`${metric}-${row.year}`}><td>{row.year}</td><td className="numeric">{row.value==null?"--":`${Math.round(row.value*100)}%`}</td></tr>)}</tbody></table></div>}</>:<div className="queue-empty">当前指标没有可用的跨年序列，系统不会生成替代值。</div>}</section>;
}
