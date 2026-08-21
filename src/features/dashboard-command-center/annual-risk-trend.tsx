"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { CommandPanelHeading } from "./panel-heading";
import { ACCENT_COLORS, RISK_COLORS } from "./risk-palette";
import { useEChart } from "./use-echart";
import type { DashboardCommandCenterData, DashboardResearchView } from "@/types";

type Props = {
  view: DashboardResearchView;
  primaryData: DashboardCommandCenterData["annualTrend"];
  gsiData: DashboardCommandCenterData["gsiRobustness"];
  redFlagData: DashboardCommandCenterData["redFlagTrend"];
  expanded?: boolean;
  onExpand?: () => void;
};

const titleByView: Record<DashboardResearchView, string> = {
  primary: "十年 EAA-ESI 风险趋势",
  gsi: "十年 GSI 稳健性趋势",
  red_flags: "十年 Red flag 稳健性趋势",
};

export function AnnualRiskTrend({ view, primaryData, gsiData, redFlagData, expanded = false, onExpand }: Props) {
  const gsiTrend = useMemo(() => gsiData.metrics.find((item) => item.code === "GSI")?.history ?? [], [gsiData.metrics]);
  const selectedData = view === "primary" ? primaryData : view === "gsi" ? gsiTrend : redFlagData;
  const firstYear = selectedData[0]?.year;
  const lastYear = selectedData.at(-1)?.year;
  const option = useMemo<EChartsOption>(() => {
    const common = {
      animationDuration: 720,
      grid: { left: expanded ? 54 : 42, right: expanded ? 32 : 18, top: expanded ? 42 : 28, bottom: expanded ? 42 : 30 },
      tooltip: { trigger: "axis" as const, backgroundColor: "rgba(5,23,27,.96)", borderColor: "rgba(39,215,229,.25)", textStyle: { color: "#EAF5F3", fontSize: 12 }, valueFormatter: (value: unknown) => value == null ? "—" : `${Math.round(Number(value) * 100)}%` },
      legend: { top: 0, right: 8, itemWidth: 12, itemHeight: 3, textStyle: { color: "#85A9A7", fontSize: expanded ? 14 : 12 } },
      yAxis: { type: "value" as const, min: 0, max: 1, axisLabel: { color: "#85A9A7", fontSize: expanded ? 14 : 12, formatter: (value: number) => `${Math.round(value * 100)}%` }, splitLine: { lineStyle: { color: "rgba(56,130,131,.16)" } } },
    };
    if (view === "gsi") return {
      ...common,
      xAxis: axis(gsiTrend.map((item) => item.year), expanded),
      series: [
        line("GSI 中位数", gsiTrend.map((item) => item.medianValue), ACCENT_COLORS.cyan, 2.4, false, true),
        line("GSI 平均数", gsiTrend.map((item) => item.meanValue), "#E8B65A", 1.8, true),
        ...(expanded ? [line("P25", gsiTrend.map((item) => item.q1), "#526F76", 1, true), line("P75", gsiTrend.map((item) => item.q3), "#526F76", 1, true)] : []),
      ],
    };
    if (view === "red_flags") return {
      ...common,
      xAxis: axis(redFlagData.map((item) => item.year), expanded),
      series: [
        line("语言差距", redFlagData.map((item) => item.highEsgsiRate), RISK_COLORS.high, 2.1, false, true),
        line("行动实质", redFlagData.map((item) => item.lowEassRate), "#E8B65A", 1.8, false),
        line("模糊与验证", redFlagData.map((item) => item.ambiguityVerificationRate), ACCENT_COLORS.cyan, 1.8, true),
      ],
    };
    return {
      ...common,
      xAxis: axis(primaryData.map((item) => item.year), expanded),
      series: [
        line("EAA-ESI 中位数", primaryData.map((item) => item.medianFinalIndex), ACCENT_COLORS.cyan, 2.4, false, true),
        line("EAA-ESI 平均数", primaryData.map((item) => item.meanFinalIndex), "#E8B65A", 1.8, true),
        line("高风险比例", primaryData.map((item) => item.highRiskRate), RISK_COLORS.high, 1.8, false),
        ...(expanded ? [line("EASS 中位数", primaryData.map((item) => item.medianEass), "#6EA8C8", 1.3, true)] : []),
      ],
    };
  }, [expanded, gsiTrend, primaryData, redFlagData, view]);
  const ref = useEChart(option);
  const comparableCount = selectedData.length;
  const sampleCount = view === "primary" ? primaryData.at(-1)?.sampleCount : view === "gsi" ? gsiTrend.at(-1)?.sampleCount : redFlagData.at(-1)?.sampleCount;
  return <section className={`cc-panel cc-trend-panel ${expanded ? "cc-panel-expanded" : ""}`}>
    <CommandPanelHeading eyebrow={`TREND · ${firstYear && lastYear ? `${firstYear}–${lastYear}` : "暂无区间"}`} title={titleByView[view]} detail={expanded ? `离散年度 · 最新 N=${sampleCount ?? 0} · 不补齐缺失` : undefined} onExpand={expanded ? undefined : onExpand} expandLabel={`展开${titleByView[view]}`}/>
    {comparableCount >= 2 ? <div key="chart" className="cc-bottom-chart" ref={ref} role="img" aria-label={`${titleByView[view]}，同时展示中位数、平均数或预警比例`}/> : <div key="empty" className="cc-chart-empty"><strong>当前口径暂无可比历史数据</strong><span>{comparableCount === 1 ? `仅 ${firstYear} 年存在有效样本` : "切换指标体系或调整样本口径后重试"}</span></div>}
  </section>;
}

function axis(years: number[], expanded: boolean) {
  return { type: "category" as const, boundaryGap: false, data: years, axisLabel: { color: "#85A9A7", fontSize: expanded ? 14 : 12 }, axisLine: { lineStyle: { color: "rgba(56,130,131,.22)" } }, axisTick: { show: false } };
}

function line(name: string, data: Array<number | null>, color: string, width: number, dashed = false, area = false) {
  return {
    name,
    type: "line" as const,
    smooth: .25,
    showSymbol: true,
    symbolSize: name === "P25" || name === "P75" ? 0 : 4,
    connectNulls: false,
    data,
    lineStyle: { width, type: dashed ? "dashed" as const : "solid" as const, color, shadowBlur: area ? 6 : 0, shadowColor: area ? "rgba(39,215,229,.30)" : "transparent" },
    itemStyle: { color },
    ...(area ? { areaStyle: { color: "rgba(39,215,229,.07)" } } : {}),
  };
}
