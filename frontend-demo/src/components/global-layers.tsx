"use client";

import { useRouter } from "next/navigation";
import { Bell, BrainCircuit, Building2, Check, ChevronRight, FileScan, GitCompareArrows, ListChecks, Search, ShieldAlert, Sparkles, TableProperties, Undo2, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { analysisRepository, analysisRepositoryMode } from "@/repositories";
import { useDemoStore } from "@/stores/demo-store";
import { getMetric, type CompanyYearRecord, type EvidenceItem } from "@/types";

export function GlobalLayers() {
  const router = useRouter();
  const { drawer, openDrawer, toast, showToast, notifications, selectedCompanyId, selectedReportYear, selectedEvidenceId, saveReview, reviews, undoReview } = useDemoStore();
  const [query, setQuery] = useState("");
  const [decision, setDecision] = useState("insufficient");
  const [note, setNote] = useState("");
  const [companies, setCompanies] = useState<CompanyYearRecord[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [dataError, setDataError] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState("why-risk");
  const closeButton = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const previousDrawer = useRef(drawer);

  useEffect(() => {
    let active = true;
    analysisRepository.listCompanies().then((items) => active && setCompanies(items)).catch((reason: Error) => active && setDataError(reason.message));
    return () => { active = false; };
  }, []);

  const selectedCompany = companies.find((company) => company.companyId === selectedCompanyId && (!selectedReportYear || company.reportYear === selectedReportYear)) ?? companies[0];

  useEffect(() => {
    if (!selectedCompany) return;
    let active = true;
    analysisRepository.listEvidence(selectedCompany.companyId, "success", selectedCompany.reportYear).then((items) => active && setEvidence(items)).catch((reason: Error) => active && setDataError(reason.message));
    return () => { active = false; };
  }, [selectedCompany]);

  useEffect(() => {
    if (drawer !== "none") {
      if (previousDrawer.current === "none") lastFocused.current = document.activeElement as HTMLElement | null;
      setTimeout(() => closeButton.current?.focus(), 20);
    } else if (previousDrawer.current !== "none") {
      lastFocused.current?.focus();
    }
    previousDrawer.current = drawer;
  }, [drawer]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => showToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast, showToast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        openDrawer(drawer === "ai" ? "none" : "ai");
      } else if (event.key === "Escape") openDrawer("none");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, openDrawer]);

  const selectedEvidence = evidence.find((item) => item.id === selectedEvidenceId) ?? evidence[0];
  const externalEvidence = evidence.find((item) => item.type === "external");
  const selectedMetric = selectedCompany && (selectedEvidence?.metricCode ? getMetric(selectedCompany, selectedEvidence.metricCode) : [...selectedCompany.metrics].sort((a, b) => (b.riskValue ?? 0) - (a.riskValue ?? 0))[0]);
  const lastReview = reviews[0];
  const greenLensTasks = [
    { id: "report-check", label: "报告体检", detail: "检查披露与证据缺口", icon: FileScan },
    { id: "why-risk", label: "为什么风险高", detail: "解释指标与红旗来源", icon: ShieldAlert },
    { id: "metric", label: "指标解释", detail: "展开公式、方向与版本", icon: BrainCircuit },
    { id: "compare", label: "跨年与同行对比", detail: "对齐同口径历史信号", icon: GitCompareArrows },
    { id: "violation", label: "违规关联建议", detail: "列出需人工确认的事件", icon: ListChecks },
    { id: "card", label: "生成研究卡片", detail: "整理可追溯研究摘要", icon: TableProperties },
    { id: "quality", label: "数据质量检查", detail: "定位缺失、重复和异常", icon: Check },
  ];
  const activeTaskDefinition = greenLensTasks.find((task) => task.id === activeTask) ?? greenLensTasks[1];
  const resultLinks = [
    ...companies.filter((company) => `${company.companyName}${company.stockCode}`.toLowerCase().includes(query.toLowerCase())).map((company) => ({ label: company.companyName, detail: `${company.stockCode} · ${company.industry}`, href: `/companies/${company.companyId}?year=${company.reportYear}` })),
    ...[
      ["风险总览", "查看声明 × 事实矩阵", "/dashboard"],
      ["企业库", "搜索与建立对比组", "/companies"],
      ["报告检测", analysisRepositoryMode === "http" ? "运行后端检测任务" : "运行合成检测任务", "/reports"],
      ["复核中心", "处理人工判断队列", "/review"],
    ].filter(([label, detail]) => `${label}${detail}`.includes(query)).map(([label, detail, href]) => ({ label, detail, href })),
  ].slice(0, 7);

  function navigate(href: string) {
    openDrawer("none");
    router.push(href);
  }

  async function submitReview(event: FormEvent) {
    event.preventDefault();
    if (!selectedEvidence || !selectedCompany) {
      showToast("证据尚未载入，请稍后重试");
      return;
    }
    const id = `review-${selectedEvidence.id}`;
    const review = {
      id,
      targetId: selectedEvidence.id,
      companyId: selectedCompany.companyId,
      targetType: "evidence",
      originalDecision: selectedEvidence.status,
      humanDecision: decision as "confirm" | "reject" | "partial" | "insufficient",
      reasonCode: decision === "insufficient" ? "missing-baseline" : "human-verified",
      note,
      reviewedAt: new Date().toISOString(),
    } as const;
    try {
      const saved = await analysisRepository.saveReview(review);
      saveReview(saved);
    } catch (reason) {
      showToast(`复核保存失败：${reason instanceof Error ? reason.message : "数据接口未响应"}。请检查接口后重试。`);
    }
  }

  return (
    <>
      {drawer !== "none" && <button className="drawer-scrim" onClick={() => openDrawer("none")} aria-label="关闭浮层" />}
      <section className={`global-drawer greenlens-drawer ${drawer === "ai" ? "open" : ""}`} role="dialog" aria-modal="true" aria-label="绿镜 GreenLens Copilot">
        <DrawerHeader icon={<Sparkles size={18} />} title="绿镜 GreenLens Copilot" onClose={() => openDrawer("none")} closeRef={closeButton} />
        <div className="greenlens-live-status"><i/><span>实时分析上下文已就绪</span><code>REPOSITORY · V2</code></div>
        <div className="drawer-context"><span>{selectedCompany?.companyName ?? "正在载入"}</span><code>{selectedCompany?.reportYear ?? "--"}</code><span>{selectedEvidence?.title ?? "等待证据"}</span></div>
        <div className="drawer-scroll">
          <div className="greenlens-task-grid" aria-label="绿镜任务入口">{greenLensTasks.map((task) => {
            const Icon = task.icon;
            return <button key={task.id} className={activeTask === task.id ? "active" : ""} aria-pressed={activeTask === task.id} onClick={() => setActiveTask(task.id)}><Icon/><span><strong>{task.label}</strong><small>{task.detail}</small></span></button>;
          })}</div>
          <div className="greenlens-analysis-stage"><span>ACTIVE TASK</span><strong>{activeTaskDefinition.label}</strong><small>{activeTaskDefinition.detail}。结果使用当前 Dashboard 筛选与选中公司。</small></div>
          <p className="drawer-kicker">结论</p>
          <h2>{selectedMetric ? `${selectedMetric.code.replace("EAA_ESGSI", "E-AA-ESGSI")} 风险信号需要人工核验。` : "正在载入指标契约。"}</h2>
          <p>{selectedEvidence?.excerpt ?? dataError ?? "通过 Repository 获取公司、指标和证据数据。"} 该结果是待复核信号，不是对企业行为的最终判断。</p>
          <p className="drawer-kicker">指标影响</p>
          {selectedMetric && <dl className="analysis-contract-grid"><div><dt>原始值</dt><dd>{selectedMetric.rawValue == null ? "--" : selectedMetric.rawValue.toFixed(3)}</dd></div><div><dt>归一化值</dt><dd>{selectedMetric.normalizedValue == null ? "--" : `${Math.round(selectedMetric.normalizedValue * 100)}%`}</dd></div><div><dt>风险方向值</dt><dd>{selectedMetric.riskValue == null ? "--" : `${Math.round(selectedMetric.riskValue * 100)}%`}</dd></div><div><dt>分子 / 分母</dt><dd>{selectedMetric.numerator ?? "--"} / {selectedMetric.denominator ?? "--"}</dd></div><div><dt>关注阈值</dt><dd>{selectedMetric.threshold == null ? "--" : `${Math.round(selectedMetric.threshold * 100)}%`}</dd></div><div className="wide"><dt>公式 / 归一化版本</dt><dd>{selectedMetric.formulaVersion} · {selectedMetric.normalizationVersion}</dd></div><div><dt>计算状态</dt><dd>{selectedMetric.calculationStatus}</dd></div></dl>}
          <div className="citation-block">
            <span>证据引用</span>
            <button disabled={!selectedCompany || !selectedEvidence} onClick={() => selectedCompany && selectedEvidence && navigate(`/companies/${selectedCompany.companyId}?year=${selectedCompany.reportYear}&tab=evidence&evidence=${selectedEvidence.id}`)}>
              <strong>[1] {selectedEvidence?.page ? `第 ${selectedEvidence.page} 页报告证据` : "等待证据定位"}</strong><ChevronRight size={16} />
            </button>
            <button disabled={!selectedCompany || !externalEvidence} onClick={() => selectedCompany && externalEvidence && navigate(`/companies/${selectedCompany.companyId}?year=${selectedCompany.reportYear}&tab=facts&evidence=${externalEvidence.id}`)}>
              <strong>[2] 关联外部事实</strong><ChevronRight size={16} />
            </button>
          </div>
          <p className="drawer-kicker">不确定性</p>
          <p>{analysisRepositoryMode === "http" ? "证据原文由后端从 PDF 文本层提取，仅返回定位页的只读文本；主体匹配、事件相关性和证据覆盖仍需要人工确认。" : "当前为合成数据；主体、事件和证据仅用于演示复核流程。"}</p>
          <p className="drawer-kicker">建议核验动作</p>
          <ul className="plain-list"><li>核验目标的基准年与核算边界</li><li>确认外部事件是否属于同一经营主体</li><li>记录人工判断并保留原因</li></ul>
        </div>
        <div className="drawer-footer"><span className="greenlens-shortcut">Ctrl / ⌘ + J</span><button className="secondary-button" disabled={!selectedEvidence} onClick={() => openDrawer("review")}>发起复核</button><button className="primary-button" disabled={!selectedCompany || !selectedEvidence} onClick={() => selectedCompany && selectedEvidence && navigate(`/companies/${selectedCompany.companyId}?year=${selectedCompany.reportYear}&tab=evidence&evidence=${selectedEvidence.id}`)}>查看引用</button></div>
      </section>

      <section className={`global-drawer review-drawer ${drawer === "review" ? "open" : ""}`} role="dialog" aria-modal="true" aria-label="发起复核">
        <DrawerHeader icon={<Check size={18} />} title="发起复核" onClose={() => openDrawer("none")} closeRef={closeButton} />
        <form onSubmit={submitReview} className="drawer-form">
          <div className="review-source"><span>当前证据</span><strong>{selectedEvidence?.title ?? "证据尚未载入"}</strong><p>{selectedEvidence?.excerpt ?? dataError ?? "请等待 Repository 返回证据。"}</p></div>
          <fieldset><legend>人工决定</legend>{[
            ["confirm", "确认信号", "证据支持当前模型判断"],
            ["reject", "驳回信号", "证据与当前判断不一致"],
            ["partial", "部分相关", "仅部分证据与判断相关"],
            ["insufficient", "证据不足", "当前材料不能支持判断"],
          ].map(([value, label, detail]) => <label className={`decision-option ${decision === value ? "selected" : ""}`} key={value}><input type="radio" name="decision" value={value} checked={decision === value} onChange={(event) => setDecision(event.target.value)} /><span><strong>{label}</strong><small>{detail}</small></span></label>)}</fieldset>
          <label className="field-label"><span>复核说明 <small>选填</small></span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录判断依据，便于后续追溯" /></label>
          <div className="drawer-footer"><button type="button" className="secondary-button" onClick={() => openDrawer("none")}>取消</button><button className="primary-button" type="submit">保存复核</button></div>
        </form>
      </section>

      <section className={`global-drawer notification-drawer ${drawer === "notifications" ? "open" : ""}`} role="dialog" aria-modal="true" aria-label="通知中心">
        <DrawerHeader icon={<Bell size={18} />} title="通知中心" onClose={() => openDrawer("none")} closeRef={closeButton} />
        <div className="drawer-scroll notification-list">{notifications.map((item) => <div key={item.id} className="notification-item"><span className="status-dot" /><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.time}</small></div></div>)}</div>
      </section>

      <section className={`command-palette ${drawer === "command" ? "open" : ""}`} role="dialog" aria-modal="true" aria-label="全局搜索">
        <div className="command-input"><Search size={18} /><input autoFocus={drawer === "command"} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索公司、页面或动作" /><button ref={closeButton} className="icon-button" onClick={() => openDrawer("none")} aria-label="关闭搜索"><X /></button></div>
        <div className="command-results"><span className="command-label">搜索结果</span>{resultLinks.map((item) => <button key={item.href} onClick={() => navigate(item.href)}><Building2 size={17} /><span><strong>{item.label}</strong><small>{item.detail}</small></span><ChevronRight size={16} /></button>)}</div>
      </section>

      {toast && <div className="toast" role="status"><Check size={18} /><span>{toast}</span>{lastReview && toast === "已保存复核结果" && <button onClick={() => undoReview(lastReview.id)}><Undo2 size={15} />撤销</button>}<button className="icon-button" onClick={() => showToast(null)} aria-label="关闭提示"><X /></button></div>}
    </>
  );
}

function DrawerHeader({ icon, title, onClose, closeRef }: { icon: React.ReactNode; title: string; onClose: () => void; closeRef: React.RefObject<HTMLButtonElement | null> }) {
  return <header className="drawer-header"><span>{icon}<strong>{title}</strong></span><button ref={closeRef} className="icon-button" onClick={onClose} aria-label={`关闭${title}`} title="关闭"><X /></button></header>;
}
