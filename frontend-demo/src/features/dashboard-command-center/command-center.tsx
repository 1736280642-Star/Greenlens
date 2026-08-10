"use client";

import { AlertTriangle, Database, Download, Radar, RefreshCw, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnnualRiskTrend } from "./annual-risk-trend";
import { DashboardDetailDialog } from "./dashboard-detail-dialog";
import { IndustryRiskHeatmap } from "./industry-risk-heatmap";
import { KpiRail } from "./kpi-rail";
import { MetricTriad } from "./metric-triad";
import { PersistentRiskList } from "./persistent-risk-list";
import { RedFlagQuality } from "./red-flag-quality";
import { RiskBreakdownWaterfall } from "./risk-breakdown-waterfall";
import { RiskDistributionHexbin } from "./risk-distribution-hexbin";
import { SectorRiskPanel } from "./sector-risk-panel";
import { analysisRepository, type DemoScenario } from "@/repositories";
import { useDemoStore, defaultYear } from "@/stores/demo-store";
import { formatPercent, type DashboardCommandCenterData, type DashboardTriadCode, type SampleGroup } from "@/types";

const riskBandByLabel: Record<string, string | undefined> = {
  全部风险: undefined,
  高风险: "high",
  中风险: "medium",
  低风险: "low",
  暂不可评分: "unavailable",
};

type ExpandedPanel = "triad" | "constellation" | "watchlist" | "trend" | "heatmap" | "audit" | "waterfall";

const expandedPanelTitles: Record<ExpandedPanel, string> = {
  triad: "三方面构造指标",
  constellation: "风险分布概览",
  watchlist: "持续高风险公司",
  trend: "十年风险趋势",
  heatmap: "行业风险热力",
  audit: "红旗与数据质量",
  waterfall: "E-AA-ESGSI 构成",
};

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DashboardCommandCenter() {
  const router = useRouter();
  const params = useSearchParams();
  const scenario = (params.get("scenario") ?? "success") as DemoScenario;
  const { year, industry, risk, sampleGroup, selectedCompanyId, setFilters, selectCompany, toggleCompare, notify, showToast } = useDemoStore();
  const [data, setData] = useState<DashboardCommandCenterData | null>(null);
  const [fullConstellation, setFullConstellation] = useState<DashboardCommandCenterData | null>(null);
  const [selectedFactor, setSelectedFactor] = useState<DashboardTriadCode | null>(null);
  const [expandedPanel, setExpandedPanel] = useState<ExpandedPanel | null>(null);
  const expandedTrigger = useRef<HTMLButtonElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const trendData = (data?.annualTrend ?? []).filter((item) => item.year >= 2016);
  const availableYears = data?.scope.availableReportYears ?? [];

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => { if (active) { setLoading(true); setError(null); } });
    analysisRepository.getDashboardCommandCenter(scenario, {
      year,
      industry: industry === "全部行业" ? undefined : industry,
      riskBand: riskBandByLabel[risk],
      sampleGroup: sampleGroup === "all" ? undefined : sampleGroup,
      light: true,
    }).then((result) => {
      if (!active) return;
      setData(result);
      setFullConstellation(null);
      if (result.scope.reportYear !== year) setFilters({ year: result.scope.reportYear });
    })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [industry, risk, sampleGroup, scenario, setFilters, year]);

  useEffect(() => {
    if (expandedPanel !== "constellation" || fullConstellation) return;
    let active = true;
    analysisRepository.getDashboardCommandCenter(scenario, {
      year,
      industry: industry === "全部行业" ? undefined : industry,
      riskBand: riskBandByLabel[risk],
      sampleGroup: sampleGroup === "all" ? undefined : sampleGroup,
    }).then((result) => { if (active) setFullConstellation(result); })
      .catch(() => {});
    return () => { active = false; };
  }, [expandedPanel, fullConstellation, industry, risk, sampleGroup, scenario, year]);

  function exportSnapshot() {
    if (!data) return;
    const content = [
      `数据版本：${data.scope.dataVersion}。风险结果仅作为待复核信号。`,
      "",
      "GreenLens Dashboard Command Center",
      `Metric contract: metric-contract-v2`,
      `报告年度：${data.scope.reportYear}`,
      `当前样本：${data.kpis.sampleCount}`,
      `高风险：${data.kpis.highRiskCount}`,
      `三年持续高风险：${data.kpis.persistentHighRiskCount}`,
      `E-AA 中位数：${formatPercent(data.kpis.medianFinalIndex)}`,
      `证据不足：${data.kpis.insufficientEvidenceCount}`,
    ].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `greenlens-command-center-${new Date().toISOString().slice(0, 10)}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify("Dashboard 快照已导出", `导出内容使用 metric-contract-v2 和 ${data.scope.dataVersion}。`);
    showToast("Dashboard 快照已导出");
  }

  function handleCompanySelect(companyId: string, addToCompare = false) {
    const company = data?.riskNodes.find((item) => item.companyId === companyId);
    selectCompany(companyId, company?.reportYear ?? year);
    if (!addToCompare) return;
    const changed = toggleCompare(companyId);
    showToast(changed ? "已更新对比组" : "对比组最多保留 5 家公司");
  }

  function openExpandedPanel(panel: ExpandedPanel) {
    expandedTrigger.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    setExpandedPanel(panel);
  }

  function renderExpandedPanel() {
    if (!data || !expandedPanel) return null;
    const selectedNode = selectedCompanyId ? data.riskNodes.find((n) => n.companyId === selectedCompanyId) ?? data.persistentRisks.find((n) => n.companyId === selectedCompanyId) ?? null : null;
    if (expandedPanel === "triad") return <MetricTriad items={data.metricTriad} nodes={data.riskNodes} selectedCompany={selectedNode} selected={selectedFactor} onSelect={setSelectedFactor} expanded/>;
    if (expandedPanel === "constellation") return <RiskDistributionHexbin nodes={fullConstellation?.riskNodes ?? data.riskNodes} selectedFactor={selectedFactor} selectedCompanyId={selectedCompanyId} onSelect={handleCompanySelect} onOpen={(companyId) => router.push(`/companies/${companyId}?year=${year}`)} expanded/>;
    if (expandedPanel === "watchlist") return <PersistentRiskList items={data.persistentRisks} selectedCompanyId={selectedCompanyId} onSelect={(companyId) => handleCompanySelect(companyId)} onCompare={(companyId) => handleCompanySelect(companyId, true)} expanded/>;
    if (expandedPanel === "trend") return <AnnualRiskTrend data={trendData} expanded/>;
    if (expandedPanel === "heatmap") return <IndustryRiskHeatmap data={data.industryRisk} selectedFactor={selectedFactor} onSelectIndustry={(nextIndustry) => setFilters({ industry: nextIndustry })} expanded/>;
    if (expandedPanel === "audit") return <RedFlagQuality flags={data.redFlagDistribution} quality={data.quality} expanded/>;
    return <RiskBreakdownWaterfall cohort={data.medianBreakdown} selectedCompany={selectedNode} expanded/>;
  }

  if (loading) return <CommandCenterLoading />;
  if (error) return <CommandCenterState icon={<AlertTriangle/>} title="风险观测数据载入失败" detail={`成因：${error}。影响：当前无法生成 Dashboard 聚合视图。下一步：检查 Repository 或接口状态后重新载入。`} action="重新载入" onAction={() => location.reload()} />;
  if (!data || !data.riskNodes.length) return <CommandCenterState icon={<Radar/>} title="当前筛选下没有样本" detail="当前年度、行业、风险或样本口径没有可展示的公司-年份记录。" action="恢复默认视图" onAction={() => setFilters({ year: defaultYear, industry: "全部行业", risk: "全部风险", sampleGroup: "all" })} />;

  return <div className="command-center-page">
    <div className="command-center-atmosphere" aria-hidden="true"><span/><span/><span/></div>
    <header className="command-center-header command-center-filterbar" aria-label="Dashboard 控制栏">
      <span className="command-center-eyebrow"><Radar size={13}/>HOLOGRAPHIC EVIDENCE OBSERVATORY</span>
      <label><span>报告年</span><select value={year} onChange={(event) => setFilters({ year: Number(event.target.value) })}>{availableYears.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>行业</span><select value={industry} onChange={(event) => setFilters({ industry: event.target.value })}><option>全部行业</option>{[...new Set(data.industryRisk.map((item) => item.industry))].filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-CN")).map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>风险</span><select value={risk} onChange={(event) => setFilters({ risk: event.target.value })}><option>全部风险</option><option>高风险</option><option>中风险</option><option>低风险</option><option>暂不可评分</option></select></label>
      <label><span>样本口径</span><select value={sampleGroup} onChange={(event) => setFilters({ sampleGroup: event.target.value as "all" | SampleGroup })}><option value="all">全部样本</option><option value="main_n_ge_20">主分析 N≥20</option><option value="robustness_n_10_19">稳健性 N10–19</option><option value="low_n_lt_10">低句数 N&lt;10</option></select></label>
      <span className="command-center-contract" title={`${data.scope.dataVersion} · metric-contract-v2`}><Database size={13}/>metric-contract-v2</span>
      <div className="command-center-toolbar-actions">
        <span className={`command-center-data-state ${data.kpis.qualityAlertCount ? "warning" : "ready"}`}><i/>{data.kpis.qualityAlertCount ? `${data.kpis.qualityAlertCount} 项质量提醒` : "数据就绪"}</span>
        <button className="cc-secondary-button" onClick={exportSnapshot}><Download size={15}/>导出快照</button>
        <button className="cc-ai-button" onClick={() => { const query = new URLSearchParams({ assistant: "open", year: String(year) }); if (selectedCompanyId) query.set("companyId", selectedCompanyId); router.push(`/review?${query}`); }}><Sparkles size={16}/><span>唤醒绿镜</span></button>
      </div>
    </header>

    <KpiRail data={data}/>

    <div className="cc-primary-grid">
      <MetricTriad items={data.metricTriad} nodes={data.riskNodes} selectedCompany={selectedCompanyId ? data.riskNodes.find((n) => n.companyId === selectedCompanyId) ?? data.persistentRisks.find((n) => n.companyId === selectedCompanyId) ?? null : null} selected={selectedFactor} onSelect={setSelectedFactor} onExpand={() => openExpandedPanel("triad")}/>
      <RiskDistributionHexbin nodes={data.riskNodes} selectedFactor={selectedFactor} selectedCompanyId={selectedCompanyId} onSelect={handleCompanySelect} onOpen={(companyId) => router.push(`/companies/${companyId}?year=${year}`)} onExpand={() => openExpandedPanel("constellation")}/>
      <PersistentRiskList items={data.persistentRisks} selectedCompanyId={selectedCompanyId} onSelect={(companyId) => handleCompanySelect(companyId)} onCompare={(companyId) => handleCompanySelect(companyId, true)} onExpand={() => openExpandedPanel("watchlist")}/>
    </div>

    <div className="cc-bottom-grid">
      <AnnualRiskTrend data={trendData} onExpand={() => openExpandedPanel("trend")}/>
      <SectorRiskPanel
        industryRisk={data.industryRisk}
        selectedFactor={selectedFactor}
        onSelectIndustry={(nextIndustry) => setFilters({ industry: nextIndustry })}
        flags={data.redFlagDistribution}
        quality={data.quality}
        kpis={data.kpis}
        onExpandHeatmap={() => openExpandedPanel("heatmap")}
        onExpandAudit={() => openExpandedPanel("audit")}
      />
      <RiskBreakdownWaterfall
        cohort={data.medianBreakdown}
        selectedCompany={selectedCompanyId ? data.riskNodes.find((n) => n.companyId === selectedCompanyId) ?? data.persistentRisks.find((n) => n.companyId === selectedCompanyId) ?? null : null}
        onExpand={() => openExpandedPanel("waterfall")}
      />
    </div>
    <footer className="cc-system-status" role="contentinfo" aria-label="数据与系统状态">
      <span className="cc-status-dot" aria-hidden="true" />
      <span className="cc-status-update">数据更新：{formatTimestamp(data.scope.computedAt)}</span>
      <span className="cc-status-sep" aria-hidden="true">·</span>
      <span className="cc-status-source">数据来源：Holographic Evidence Observatory</span>
      <span className="cc-status-sep" aria-hidden="true">·</span>
      <span>风险仅为待复核信号</span>
    </footer>
    <DashboardDetailDialog open={expandedPanel != null} onOpenChange={(open) => { if (!open) setExpandedPanel(null); }} title={expandedPanel ? `${expandedPanelTitles[expandedPanel]}完整视图` : "模块完整视图"} description="查看当前 Dashboard 模块的完整数据与交互" returnFocusRef={expandedTrigger}>{renderExpandedPanel()}</DashboardDetailDialog>
  </div>;
}

function CommandCenterLoading() {
  return <div className="command-center-page cc-loading"><div className="cc-loading-header"/><div className="cc-kpi-rail">{Array.from({ length: 6 }, (_, index) => <span key={index}/>)}</div><div className="cc-primary-grid"><span/><span/><span/></div><div className="cc-bottom-grid"><span/><span/><span/></div></div>;
}

function CommandCenterState({ icon, title, detail, action, onAction }: { icon: React.ReactNode; title: string; detail: string; action: string; onAction: () => void }) {
  return <div className="command-center-state">{icon}<span>GREENLENS COMMAND CENTER</span><h2>{title}</h2><p>{detail}</p><button className="cc-ai-button" onClick={onAction}><RefreshCw size={15}/>{action}</button></div>;
}
