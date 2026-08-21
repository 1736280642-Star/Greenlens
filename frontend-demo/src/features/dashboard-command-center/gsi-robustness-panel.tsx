import { Gauge, ScanSearch, Scale } from "lucide-react";
import { CommandPanelHeading } from "./panel-heading";
import { ResearchViewSwitch } from "./research-view-switch";
import { formatPercent, type DashboardCommandCenterData, type DashboardGsiMetricCode, type DashboardResearchView, type DashboardRiskNode } from "@/types";

const metricMeta: Record<DashboardGsiMetricCode, { code: string; icon: typeof Gauge }> = {
  GSI: { code: "GSI", icon: Gauge },
  COVERAGE_PENALTY: { code: "COVERAGE", icon: ScanSearch },
  IMBALANCE: { code: "IMBALANCE", icon: Scale },
};

function MiniTrend({ values, expanded }: { values: Array<number | null>; expanded: boolean }) {
  const available = values.map((value, index) => ({ value, index })).filter((item): item is { value: number; index: number } => item.value != null);
  if (available.length < 2) return <span className="cc-mini-trend empty"/>;
  const min = Math.min(...available.map((item) => item.value));
  const max = Math.max(...available.map((item) => item.value));
  const range = max - min || 1;
  const points = available.map((item) => `${item.index / Math.max(1, values.length - 1) * 96 + 2},${30 - (item.value - min) / range * 25}`).join(" ");
  const latest = available.at(-1)!;
  return <svg className={`cc-mini-trend ${expanded ? "expanded" : ""}`} viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
    <line className="baseline" x1="2" y1="30" x2="98" y2="30"/>
    <polyline points={points}/>
    <circle cx={latest.index / Math.max(1, values.length - 1) * 96 + 2} cy={30 - (latest.value - min) / range * 25} r={expanded ? 1.6 : 1.2}/>
  </svg>;
}

function selectedValue(node: DashboardRiskNode | null, code: DashboardGsiMetricCode) {
  if (!node?.gsi) return null;
  if (code === "GSI") return node.gsi.gsiFinal;
  if (code === "COVERAGE_PENALTY") return node.gsi.coveragePenalty;
  return node.gsi.imbalance;
}

export function GsiRobustnessPanel({
  data,
  selectedCompany,
  view,
  onViewChange,
  expanded = false,
  onExpand,
}: {
  data: DashboardCommandCenterData["gsiRobustness"];
  selectedCompany: DashboardRiskNode | null;
  view: DashboardResearchView;
  onViewChange: (view: DashboardResearchView) => void;
  expanded?: boolean;
  onExpand?: () => void;
}) {
  return <section className={`cc-panel cc-triad-panel cc-robustness-panel ${selectedCompany ? "has-company-selection" : ""} ${expanded ? "cc-panel-expanded" : ""}`}>
    <CommandPanelHeading eyebrow="ROBUSTNESS · 1/2" title="GSI 稳健性检验" detail={expanded ? "全 ESG 文本口径 · 不替代环境主分析" : undefined} onExpand={expanded ? undefined : onExpand} expandLabel="展开 GSI 稳健性检验"/>
    <ResearchViewSwitch value={view} onChange={onViewChange}/>
    {data.available ? <div className="cc-triad-list">{data.metrics.map((item) => {
      const Icon = metricMeta[item.code].icon;
      const currentValue = selectedCompany ? selectedValue(selectedCompany, item.code) : item.medianValue;
      return <article key={item.code} className="cc-triad-card cc-triad-static">
        <span className="cc-triad-icon"><Icon/></span>
        <span className="cc-triad-copy"><small className="cc-triad-code">{metricMeta[item.code].code}</small><strong>{item.label}</strong>{expanded ? <span className="cc-triad-description">{item.description}</span> : null}</span>
        <span className="cc-triad-values"><small>{selectedCompany ? "当前对象" : "样本中位数"}</small><strong>{formatPercent(currentValue)}</strong></span>
        <span className="cc-triad-meta">
          <span><small>样本均值</small><strong>{formatPercent(item.meanValue)}</strong></span>
          <span><small>有效样本</small><strong>{item.sampleCount}</strong></span>
          <span><small>重复组</small><strong>{data.duplicateGroupCount}</strong></span>
        </span>
        <span className="cc-triad-benchmark" aria-label={`中间百分之五十区间 ${formatPercent(item.q1)} 至 ${formatPercent(item.q3)}`}>
          <i className="range" style={{ left: `${Math.max(0, (item.q1 ?? 0) * 100)}%`, width: `${Math.max(2, ((item.q3 ?? 0) - (item.q1 ?? 0)) * 100)}%` }}/>
          <i className="median" style={{ left: `${Math.max(0, Math.min(100, (item.medianValue ?? 0) * 100))}%` }}/>
          <i className="current" style={{ left: `${Math.max(0, Math.min(100, (currentValue ?? 0) * 100))}%` }}/>
        </span>
        <MiniTrend values={item.history.map((point) => point.medianValue)} expanded={expanded}/>
        {expanded ? <span className="cc-triad-history"><small>年度中位数 / 均值</small><span>{item.history.map((point) => <span key={point.year}><small>{point.year} · N={point.sampleCount}</small><strong>{formatPercent(point.medianValue)} / {formatPercent(point.meanValue)}</strong></span>)}</span></span> : null}
        {expanded ? <span className="cc-triad-distribution"><span><small>中间 50% 区间</small><strong>{formatPercent(item.q1)} – {formatPercent(item.q3)}</strong></span><span><small>数据版本</small><strong>{data.dataVersion ?? "—"}</strong></span></span> : null}
      </article>;
    })}</div> : <div className="cc-robustness-empty"><strong>当前筛选没有可匹配的 GSI 公司年度记录</strong><span>主分析结果保持可用；导入或检查 GSI 公司代码、年份和去重记录后重试。</span></div>}
    {expanded ? <footer className="cc-triad-note">GSI 同时使用 E/S/G 词典覆盖与披露失衡，只作为稳健性证据；高值是待复核信号，不构成企业漂绿认定。</footer> : null}
  </section>;
}
