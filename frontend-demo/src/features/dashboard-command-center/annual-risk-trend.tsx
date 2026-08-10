"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { CommandPanelHeading } from "./panel-heading";
import { ACCENT_COLORS, RISK_COLORS } from "./risk-palette";
import { useEChart } from "./use-echart";
import type { DashboardAnnualTrendPoint } from "@/types";

export function AnnualRiskTrend({ data, expanded = false, onExpand }: { data: DashboardAnnualTrendPoint[]; expanded?: boolean; onExpand?: () => void }) {
  const firstYear = data[0]?.year;
  const lastYear = data.at(-1)?.year;
  const comparablePoints = data.filter((item) => item.medianFinalIndex != null || item.highRiskRate != null || item.medianEass != null);
  const option = useMemo<EChartsOption>(() => ({
    animationDuration: 720,
    grid: { left: expanded ? 54 : 42, right: expanded ? 32 : 18, top: expanded ? 42 : 28, bottom: expanded ? 42 : 30 },
    tooltip: { trigger: "axis", backgroundColor: "rgba(5,23,27,.96)", borderColor: "rgba(39,215,229,.25)", textStyle: { color: "#EAF5F3", fontSize: 12 }, valueFormatter: (value) => value == null ? "—" : `${Math.round(Number(value) * 100)}%` },
    legend: { top: 0, right: 8, itemWidth: 12, itemHeight: 3, textStyle: { color: "#85A9A7", fontSize: expanded ? 14 : 13 } },
    xAxis: { type: "category", boundaryGap: false, data: data.map((item) => item.year), axisLabel: { color: "#85A9A7", fontSize: expanded ? 14 : 13 }, axisLine: { lineStyle: { color: "rgba(56,130,131,.22)" } }, axisTick: { show: false } },
    yAxis: { type: "value", min: 0, max: 1, axisLabel: { color: "#85A9A7", fontSize: expanded ? 14 : 13, formatter: (value: number) => `${Math.round(value * 100)}%` }, splitLine: { lineStyle: { color: "rgba(56,130,131,.16)" } } },
    series: [
      { name: "E-AA 中位数", type: "line", smooth: .25, showSymbol: true, symbolSize: 5, connectNulls: false, data: data.map((item) => item.medianFinalIndex), lineStyle: { width: 2.4, color: ACCENT_COLORS.cyan, shadowBlur: 6, shadowColor: "rgba(39,215,229,.30)" }, itemStyle: { color: ACCENT_COLORS.cyan }, areaStyle: { color: "rgba(39,215,229,.08)" } },
      { name: "高风险比例", type: "line", smooth: .25, showSymbol: true, symbolSize: 4, connectNulls: false, data: data.map((item) => item.highRiskRate), lineStyle: { width: 1.8, color: RISK_COLORS.high }, itemStyle: { color: RISK_COLORS.high } },
      { name: "EASS 中位数", type: "line", smooth: .25, showSymbol: true, symbolSize: 4, connectNulls: false, data: data.map((item) => item.medianEass), lineStyle: { width: 1.4, type: "dashed", color: "#6EA8C8" }, itemStyle: { color: "#6EA8C8" } },
    ],
  }), [data, expanded]);
  const ref = useEChart(option);
  return <section className={`cc-panel cc-trend-panel ${expanded ? "cc-panel-expanded" : ""}`}><CommandPanelHeading eyebrow={`TREND · ${firstYear && lastYear ? `${firstYear}–${lastYear}` : "2016–2024"}`} title="十年风险趋势" detail={expanded ? "离散年度 · 不补齐缺失" : undefined} onExpand={expanded ? undefined : onExpand} expandLabel="展开十年风险趋势"/>{comparablePoints.length >= 2 ? <div className="cc-bottom-chart" ref={ref} role="img" aria-label="十年 E-AA、高风险比例与 EASS 趋势图"/> : <div className="cc-chart-empty"><strong>当前筛选暂无可比历史数据</strong><span>{comparablePoints.length === 1 ? `仅 ${comparablePoints[0].year} 年存在有效样本` : "调整报告年或样本口径后重试"}</span></div>}</section>;
}
