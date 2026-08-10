"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { CommandPanelHeading } from "./panel-heading";
import { HEATMAP_RAMP } from "./risk-palette";
import { useEChart } from "./use-echart";
import type { DashboardIndustryRiskCell, DashboardTriadCode } from "@/types";

const metricCodes = ["ESGSI", "EASS", "IR", "UPR", "EAA_ESGSI"] as const;
const labels: Record<(typeof metricCodes)[number], string> = { ESGSI: "ESGSI", EASS: "EASS缺口", IR: "IR", UPR: "UPR", EAA_ESGSI: "E-AA" };
const heatmapColors = [...HEATMAP_RAMP];

export function IndustryRiskHeatmap({ data, selectedFactor, onSelectIndustry, expanded = false, onExpand, embedded = false }: { data: DashboardIndustryRiskCell[]; selectedFactor: DashboardTriadCode | null; onSelectIndustry: (industry: string) => void; expanded?: boolean; onExpand?: () => void; embedded?: boolean }) {
  const industries = useMemo(() => [...new Set(data.map((item) => item.industry))], [data]);
  const option = useMemo<EChartsOption>(() => ({
    animationDurationUpdate: 320,
    grid: { left: expanded ? 92 : 68, right: expanded ? 30 : 12, top: expanded ? 24 : 14, bottom: expanded ? 48 : 30 },
    tooltip: {
      position: "top", backgroundColor: "rgba(5,23,27,.96)", borderColor: "rgba(39,215,229,.25)", textStyle: { color: "#EAF5F3", fontSize: 12 },
      formatter: (params: unknown) => {
        const item = (params as { data?: { source?: DashboardIndustryRiskCell } }).data?.source;
        return item ? `${item.industry} · ${labels[item.metricCode]}<br/>中位风险方向值 ${item.medianRiskValue == null ? "—" : `${Math.round(item.medianRiskValue * 100)}%`}<br/>四分位 ${item.q1 == null ? "—" : Math.round(item.q1 * 100)}–${item.q3 == null ? "—" : Math.round(item.q3 * 100)}% · N=${item.sampleCount}` : "";
      },
    },
    xAxis: { type: "category", data: metricCodes.map((code) => labels[code]), axisLabel: { color: "#85A9A7", fontSize: expanded ? 14 : 13 }, axisLine: { lineStyle: { color: "rgba(56,130,131,.22)" } }, axisTick: { show: false } },
    yAxis: { type: "category", data: industries, axisLabel: { color: "#85A9A7", fontSize: expanded ? 14 : 13, width: expanded ? 86 : 68, overflow: "truncate" }, axisLine: { show: false }, axisTick: { show: false } },
    visualMap: { show: false, min: 0, max: 1, inRange: { color: heatmapColors } },
    series: [{ type: "heatmap", data: data.map((item) => ({ value: [metricCodes.indexOf(item.metricCode), industries.indexOf(item.industry), item.medianRiskValue], source: item, itemStyle: { borderColor: "rgba(0,0,0,.18)", borderWidth: 1.5, opacity: selectedFactor == null || (selectedFactor === "RHETORIC_CONTENT" && item.metricCode === "ESGSI") || (selectedFactor === "ACTION_SUBSTANCE" && item.metricCode === "EASS") || (selectedFactor === "AMBIGUITY_VERIFICATION" && (item.metricCode === "IR" || item.metricCode === "UPR")) ? 1 : .34 } })), emphasis: { itemStyle: { borderColor: "#EAF5F3", borderWidth: 2, shadowBlur: 12, shadowColor: "rgba(39,215,229,.28)" } } }],
  }), [data, expanded, industries, selectedFactor]);
  const ref = useEChart(option, { click: (params) => { const item = (params as { data?: { source?: DashboardIndustryRiskCell } }).data?.source; if (item) onSelectIndustry(item.industry); } });
  if (embedded) {
    return <div className="cc-bottom-chart cc-heatmap-embedded" ref={ref} role="img" aria-label="行业与五类风险指标热力图"/>;
  }
  return <section className={`cc-panel cc-heatmap-panel ${expanded ? "cc-panel-expanded" : ""}`}><CommandPanelHeading eyebrow="SECTOR" title="行业风险热力" detail={expanded ? `${industries.length} 个行业 · 风险方向统一` : undefined} onExpand={expanded ? undefined : onExpand} expandLabel="展开行业风险热力"/><div className="cc-bottom-chart" ref={ref} role="img" aria-label="行业与五类风险指标热力图"/></section>;
}
