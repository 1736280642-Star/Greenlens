import { FlagTriangleRight, ScanSearch, ShieldAlert } from "lucide-react";
import { CommandPanelHeading } from "./panel-heading";
import { ResearchViewSwitch } from "./research-view-switch";
import { formatPercent, type DashboardCommandCenterData, type DashboardResearchView, type DashboardRiskNode, type RedFlagCode } from "@/types";

const definitions: Array<{
  code: string;
  label: string;
  description: string;
  icon: typeof FlagTriangleRight;
  flags: RedFlagCode[];
  history: (point: DashboardCommandCenterData["redFlagTrend"][number]) => number | null;
}> = [
  { code: "HIGH ESI", label: "语言差距预警", description: "积极环境语言与实质信息差距超过当前模型阈值。", icon: FlagTriangleRight, flags: ["HIGH_ESGSI"], history: (point) => point.highEsgsiRate },
  { code: "LOW EASS", label: "行动实质预警", description: "环境行动获得已实施证据支撑的程度低于当前阈值。", icon: ShieldAlert, flags: ["LOW_EASS"], history: (point) => point.lowEassRate },
  { code: "IR / UPR", label: "模糊与验证预警", description: "模糊声明或未验证计划至少触发一项预警。", icon: ScanSearch, flags: ["HIGH_IR", "HIGH_UPR"], history: (point) => point.ambiguityVerificationRate },
];

export function RedFlagRobustnessPanel({
  nodes,
  trend,
  selectedCompany,
  view,
  onViewChange,
  expanded = false,
  onExpand,
}: {
  nodes: DashboardRiskNode[];
  trend: DashboardCommandCenterData["redFlagTrend"];
  selectedCompany: DashboardRiskNode | null;
  view: DashboardResearchView;
  onViewChange: (view: DashboardResearchView) => void;
  expanded?: boolean;
  onExpand?: () => void;
}) {
  return <section className={`cc-panel cc-triad-panel cc-robustness-panel ${selectedCompany ? "has-company-selection" : ""} ${expanded ? "cc-panel-expanded" : ""}`}>
    <CommandPanelHeading eyebrow="ROBUSTNESS · 2/2" title="Red flag 稳健性检验" detail={expanded ? "同一主模型 · 阈值触发结果" : undefined} onExpand={expanded ? undefined : onExpand} expandLabel="展开 Red flag 稳健性检验"/>
    <ResearchViewSwitch value={view} onChange={onViewChange}/>
    <div className="cc-triad-list">{definitions.map((item) => {
      const count = nodes.filter((node) => item.flags.some((flag) => node.redFlags.includes(flag))).length;
      const cohortRate = nodes.length ? count / nodes.length : null;
      const selectedTriggered = selectedCompany ? item.flags.some((flag) => selectedCompany.redFlags.includes(flag)) : null;
      const Icon = item.icon;
      return <article key={item.code} className={`cc-triad-card cc-triad-static ${selectedTriggered ? "active" : ""}`}>
        <span className="cc-triad-icon"><Icon/></span>
        <span className="cc-triad-copy"><small className="cc-triad-code">{item.code}</small><strong>{item.label}</strong>{expanded ? <span className="cc-triad-description">{item.description}</span> : null}</span>
        <span className="cc-triad-values"><small>{selectedCompany ? "当前对象" : "样本触发率"}</small><strong>{selectedCompany ? selectedTriggered ? "触发" : "未触发" : formatPercent(cohortRate)}</strong></span>
        <span className="cc-triad-meta">
          <span><small>触发样本</small><strong>{count}</strong></span>
          <span><small>样本占比</small><strong>{formatPercent(cohortRate)}</strong></span>
          <span><small>当前对象</small><strong>{selectedCompany?.companyName ?? "全部样本"}</strong></span>
        </span>
        <span className="cc-triad-benchmark" aria-label={`触发率 ${formatPercent(cohortRate)}`}><i className="range red-flag-rate" style={{ left: 0, width: `${Math.max(2, (cohortRate ?? 0) * 100)}%` }}/><i className="median" style={{ left: `${Math.max(0, Math.min(100, (cohortRate ?? 0) * 100))}%` }}/></span>
        <MiniTrend values={trend.map(item.history)} expanded={expanded}/>
        {expanded ? <span className="cc-triad-history"><small>年度触发率</small><span>{trend.map((point) => <span key={point.year}><small>{point.year} · N={point.sampleCount}</small><strong>{formatPercent(item.history(point))}</strong></span>)}</span></span> : null}
        {expanded ? <span className="cc-triad-distribution"><span><small>判定边界</small><strong>版本化阈值</strong></span><span><small>用途</small><strong>稳健性复核</strong></span></span> : null}
      </article>;
    })}</div>
    {expanded ? <footer className="cc-triad-note">Red flag 与主指标来自同一套 EAS / EAA-ESI 模型，只用于检验结论是否受到阈值触发规则支持。</footer> : null}
  </section>;
}

function MiniTrend({ values, expanded }: { values: Array<number | null>; expanded: boolean }) {
  const available = values.map((value, index) => ({ value, index })).filter((item): item is { value: number; index: number } => item.value != null);
  if (available.length < 2) return <span className="cc-mini-trend empty"/>;
  const points = available.map((item) => `${item.index / Math.max(1, values.length - 1) * 96 + 2},${30 - item.value * 25}`).join(" ");
  const latest = available.at(-1)!;
  return <svg className={`cc-mini-trend ${expanded ? "expanded" : ""}`} viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true"><line className="baseline" x1="2" y1="30" x2="98" y2="30"/><polyline points={points}/><circle cx={latest.index / Math.max(1, values.length - 1) * 96 + 2} cy={30 - latest.value * 25} r={expanded ? 1.6 : 1.2}/></svg>;
}
