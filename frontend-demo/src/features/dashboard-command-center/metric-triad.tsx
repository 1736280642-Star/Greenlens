import { Activity, MessageSquareText, ShieldCheck } from "lucide-react";
import { CommandPanelHeading } from "./panel-heading";
import { ResearchViewSwitch } from "./research-view-switch";
import { formatPercent, type DashboardMetricTriad, type DashboardResearchView, type DashboardRiskNode, type DashboardTriadCode } from "@/types";

const icons = { RHETORIC_CONTENT: MessageSquareText, ACTION_SUBSTANCE: ShieldCheck, AMBIGUITY_VERIFICATION: Activity };
const metricCodes = { RHETORIC_CONTENT: "ESI", ACTION_SUBSTANCE: "EASS", AMBIGUITY_VERIFICATION: "IR · UPR" };

function MiniTrend({ values, expanded = false }: { values: Array<number | null>; expanded?: boolean }) {
  const available = values.map((value, index) => ({ value, index })).filter((item): item is { value: number; index: number } => item.value != null);
  if (available.length < 2) return <span className="cc-mini-trend empty"/>;
  const points = available.map((item) => `${item.index / Math.max(1, values.length - 1) * 96 + 2},${30 - item.value * 25}`).join(" ");
  const latest = available.at(-1)!;
  return <svg className={`cc-mini-trend ${expanded ? "expanded" : ""}`} viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
    <line className="baseline" x1="2" y1="30" x2="98" y2="30"/>
    <polyline points={points}/>
    <circle cx={latest.index / Math.max(1, values.length - 1) * 96 + 2} cy={30 - latest.value * 25} r={expanded ? 1.6 : 1.2}/>
  </svg>;
}

function getLatestDelta(item: DashboardMetricTriad) {
  const available = item.history.filter((point): point is { year: number; value: number } => point.value != null);
  if (available.length < 2) return null;
  return available.at(-1)!.value - available.at(-2)!.value;
}

function formatDelta(value: number | null) {
  if (value == null) return "—";
  const points = Math.round(value * 100);
  return `${points > 0 ? "+" : ""}${points}pp`;
}

function nodeValue(node: DashboardRiskNode, code: DashboardTriadCode) {
  if (code === "RHETORIC_CONTENT") return node.metricRiskValues.ESGSI;
  if (code === "ACTION_SUBSTANCE") return node.eass;
  const ir = node.metricRiskValues.IR;
  const upr = node.metricRiskValues.UPR;
  return ir == null || upr == null ? null : (ir + upr) / 2;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(value: number | null, values: number[]) {
  if (value == null || !values.length) return null;
  return Math.round(values.filter((item) => item <= value).length / values.length * 100);
}

export function MetricTriad({ items, nodes, selectedCompany, selected, onSelect, view, onViewChange, expanded = false, onExpand }: { items: DashboardMetricTriad[]; nodes: DashboardRiskNode[]; selectedCompany: DashboardRiskNode | null; selected: DashboardTriadCode | null; onSelect: (code: DashboardTriadCode | null) => void; view: DashboardResearchView; onViewChange: (view: DashboardResearchView) => void; expanded?: boolean; onExpand?: () => void }) {
  return <section className={`cc-panel cc-triad-panel ${selectedCompany ? "has-company-selection" : ""} ${expanded ? "cc-panel-expanded" : ""}`}>
    <CommandPanelHeading eyebrow="PRIMARY ANALYSIS" title="EAS / EAA-ESI 主分析" detail={expanded ? "行动实质、环境语义差距与验证完整性" : undefined} onExpand={expanded ? undefined : onExpand} expandLabel="展开主分析指标"/>
    <ResearchViewSwitch value={view} onChange={onViewChange}/>
    <div className="cc-triad-list">{items.map((item) => {
      const Icon = icons[item.code];
      const active = selected === item.code;
      const delta = getLatestDelta(item);
      const firstYear = item.history.find((point) => point.value != null)?.year;
      const lastYear = item.history.findLast((point) => point.value != null)?.year;
      const cohortValues = nodes.map((node) => nodeValue(node, item.code)).filter((value): value is number => value != null);
      const industryValues = selectedCompany
        ? nodes.filter((node) => node.industry === selectedCompany.industry).map((node) => nodeValue(node, item.code)).filter((value): value is number => value != null)
        : cohortValues;
      const currentValue = selectedCompany ? nodeValue(selectedCompany, item.code) : item.medianValue;
      const benchmark = median(industryValues);
      const currentPercentile = percentile(currentValue, cohortValues);
      return <button key={item.code} className={`cc-triad-card ${active ? "active" : ""}`} onClick={() => onSelect(active ? null : item.code)} aria-pressed={active}>
        <span className="cc-triad-icon"><Icon/></span>
        <span className="cc-triad-copy"><small className="cc-triad-code">{metricCodes[item.code]}</small><strong>{item.label}</strong>{expanded ? <span className="cc-triad-description">{item.description}</span> : null}</span>
        <span className="cc-triad-values" aria-label={`${selectedCompany ? "当前对象" : "样本中位数"} ${formatPercent(currentValue)}`}><small>{selectedCompany ? "当前对象" : "样本中位数"}</small><strong>{formatPercent(currentValue)}</strong></span>
        <span className="cc-triad-meta">
          <span><small>{selectedCompany ? "行业中位" : "关注率"}</small><strong>{selectedCompany ? formatPercent(benchmark) : formatPercent(item.attentionRate)}</strong></span>
          <span><small>{selectedCompany ? "当前分位" : "较上年"}</small><strong className={selectedCompany ? "neutral" : delta == null ? "neutral" : delta > 0 ? "up" : delta < 0 ? "down" : "neutral"}>{selectedCompany ? `${currentPercentile ?? "—"}%` : formatDelta(delta)}</strong></span>
          <span><small>{selectedCompany ? "对象" : "有效样本"}</small><strong>{selectedCompany ? selectedCompany.companyName : item.sampleCount}</strong></span>
        </span>
        <span className="cc-triad-benchmark" aria-label={`当前值 ${formatPercent(currentValue)}，基准 ${formatPercent(benchmark)}`}>
          <i className="range" style={{ left: `${Math.max(0, (item.q1 ?? 0) * 100)}%`, width: `${Math.max(2, ((item.q3 ?? 0) - (item.q1 ?? 0)) * 100)}%` }} />
          <i className="median" style={{ left: `${Math.max(0, Math.min(100, (benchmark ?? 0) * 100))}%` }} />
          <i className="current" style={{ left: `${Math.max(0, Math.min(100, (currentValue ?? 0) * 100))}%` }} />
        </span>
        <MiniTrend values={item.history.map((point) => point.value)} expanded={expanded}/>
        {expanded ? <span className="cc-triad-history">
          <small>年度中位数</small>
          <span>{item.history.map((point) => <span key={point.year}><small>{point.year}</small><strong>{formatPercent(point.value)}</strong></span>)}</span>
        </span> : null}
        {expanded ? <span className="cc-triad-distribution">
          <span><small>中间 50% 区间</small><strong>{formatPercent(item.q1)} — {formatPercent(item.q3)}</strong></span>
          <span><small>趋势覆盖</small><strong>{firstYear ?? "—"} — {lastYear ?? "—"}</strong></span>
        </span> : null}
      </button>;
    })}</div>
    {expanded ? <footer className="cc-triad-note">关注率表示风险方向值达到 0.5 的样本占比；EASS 原始值越高代表行动越实质，联动风险场时使用反向风险值。</footer> : null}
  </section>;
}
