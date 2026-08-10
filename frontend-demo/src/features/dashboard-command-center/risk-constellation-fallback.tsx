"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { CommandPanelHeading } from "./panel-heading";
import { useEChart } from "./use-echart";
import { formatPercent, type DashboardRiskNode, type DashboardTriadCode, type RiskBand } from "@/types";

const riskColors: Record<RiskBand, string> = {
  high: "#ff6b5e",
  medium: "#f4b740",
  low: "#4d8aa8",
  unavailable: "#6c7881",
};

const factorLabels: Record<DashboardTriadCode, string> = {
  RHETORIC_CONTENT: "修辞—内容差异",
  ACTION_SUBSTANCE: "行动实质",
  AMBIGUITY_VERIFICATION: "模糊与未验证",
};

interface ScatterDatum {
  value: [number, number, number];
  companyId: string;
  companyName: string;
  stockCode: string;
  industry: string;
  riskBand: RiskBand;
  evidenceCoverage: number;
  history: DashboardRiskNode["history"];
  persistentHighRiskYears: number;
  focusRisk: number | null;
  itemStyle: { color: string; opacity: number; borderColor: string; borderWidth: number; shadowBlur: number; shadowColor: string };
}

function factorRisk(node: DashboardRiskNode, selectedFactor: DashboardTriadCode | null) {
  if (selectedFactor === "RHETORIC_CONTENT") return node.metricRiskValues.ESGSI;
  if (selectedFactor === "ACTION_SUBSTANCE") return node.metricRiskValues.EASS;
  if (selectedFactor === "AMBIGUITY_VERIFICATION") {
    const values = [node.metricRiskValues.IR, node.metricRiskValues.UPR].filter((value): value is number => value != null);
    return values.length === 2 ? (values[0] + values[1]) / 2 : null;
  }
  return node.finalIndex;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

export function RiskConstellationFallback({
  nodes,
  selectedFactor,
  selectedCompanyId,
  onSelect,
  compact = false,
  embedded = false,
}: {
  nodes: DashboardRiskNode[];
  selectedFactor: DashboardTriadCode | null;
  selectedCompanyId: string | null;
  onSelect: (companyId: string, addToCompare: boolean) => void;
  compact?: boolean;
  embedded?: boolean;
}) {
  const data = useMemo<ScatterDatum[]>(() => nodes.flatMap((node) => {
    if (node.eass == null || node.finalIndex == null) return [];
    const focusRisk = factorRisk(node, selectedFactor);
    const selected = selectedCompanyId === node.companyId;
    const dimmed = selectedCompanyId != null && !selected;
    const baseColor = riskColors[node.riskBand];
    return [{
      value: [node.eass, node.finalIndex, Math.max(8, Math.min(34, 7 + Math.log2(node.environmentalSentenceCount + 1) * 4))],
      companyId: node.companyId,
      companyName: node.companyName,
      stockCode: node.stockCode,
      industry: node.industry,
      riskBand: node.riskBand,
      evidenceCoverage: node.evidenceCoverage,
      history: node.history,
      persistentHighRiskYears: node.persistentHighRiskYears,
      focusRisk,
      itemStyle: {
        color: baseColor,
        opacity: dimmed ? .18 : focusRisk != null && selectedFactor && focusRisk < .5 ? .36 : Math.max(.46, node.evidenceCoverage / 100),
        borderColor: selected ? "#e8fbed" : baseColor,
        borderWidth: selected ? 2 : node.redFlags.length ? 1 : 0,
        shadowBlur: selected || node.riskBand === "high" ? 18 : 8,
        shadowColor: baseColor,
      },
    }];
  }), [nodes, selectedCompanyId, selectedFactor]);

  const option = useMemo<EChartsOption>(() => ({
    animationDurationUpdate: 320,
    grid: { left: compact ? 36 : 48, right: 18, top: 22, bottom: compact ? 46 : 42 },
    xAxis: {
      type: "value", min: 0, max: 1, name: "EASS  行动实质 →", nameLocation: "middle", nameGap: compact ? 30 : 31,
      nameTextStyle: { color: "#9bb2a2", fontSize: 13 }, axisLabel: { color: "#91aa99", fontSize: 13, formatter: (value: number) => `${Math.round(value * 100)}%` },
      axisLine: { lineStyle: { color: "rgba(79,168,107,.2)" } }, splitLine: { lineStyle: { color: "rgba(79,168,107,.08)" } },
    },
    yAxis: {
      type: "value", min: 0, max: 1, name: "E-AA 风险信号", nameGap: compact ? 30 : 38,
      nameTextStyle: { color: "#9bb2a2", fontSize: 13 }, axisLabel: { color: "#91aa99", fontSize: 13, formatter: (value: number) => `${Math.round(value * 100)}%` },
      axisLine: { lineStyle: { color: "rgba(79,168,107,.2)" } }, splitLine: { lineStyle: { color: "rgba(79,168,107,.08)" } },
    },
    tooltip: {
      trigger: "item", confine: true, backgroundColor: "rgba(4,18,9,.96)", borderColor: "rgba(59,220,131,.35)", textStyle: { color: "#e5f3e9", fontSize: 12 },
      formatter: (params: unknown) => {
        const datum = (params as { data?: ScatterDatum }).data;
        if (!datum) return "";
        const sequence = datum.history?.length
          ? datum.history.map((point) => `${point.year}:${point.riskBand === "high" ? "高" : point.riskBand === "medium" ? "中" : point.riskBand === "low" ? "低" : "—"}`).join(" · ")
          : datum.persistentHighRiskYears ? `近三年持续高风险 ${datum.persistentHighRiskYears} 年` : "暂无跨年序列";
        return `<div class="cc-chart-tooltip"><strong>${escapeHtml(datum.companyName)}</strong><span>${escapeHtml(datum.stockCode)} · ${escapeHtml(datum.industry)}</span><dl><dt>EASS</dt><dd>${formatPercent(datum.value[0])}</dd><dt>E-AA</dt><dd>${formatPercent(datum.value[1])}</dd><dt>证据完整度</dt><dd>${Math.round(datum.evidenceCoverage)}%</dd></dl><small>${escapeHtml(sequence || "暂无跨年序列")}</small></div>`;
      },
    },
    series: [{
      type: "scatter", data, symbolSize: (value: unknown) => (value as number[])[2],
      emphasis: { scale: 1.15, focus: "self" },
      markArea: { silent: true, itemStyle: { color: "rgba(255,107,94,.035)" }, data: [[{ xAxis: 0, yAxis: .66 }, { xAxis: .45, yAxis: 1 }]] },
    }],
  }), [compact, data]);

  const chartRef = useEChart(option, {
    click: (params) => {
      const event = params as { data?: ScatterDatum; event?: { event?: MouseEvent } };
      if (event.data?.companyId) onSelect(event.data.companyId, Boolean(event.event?.event?.shiftKey));
    },
  });

  const chart = <div className={`cc-risk-fallback-chart ${compact ? "compact" : ""}`} ref={chartRef} role="img" aria-label="漂绿风险二维矩阵，横轴为行动实质 EASS，纵轴为 E-AA 风险信号"/>;
  if (embedded) return chart;
  return <section className="cc-panel cc-constellation-panel"><CommandPanelHeading eyebrow="RISK FIELD · FLAT" title="漂绿风险星图" detail={`${nodes.length} 个公司节点${selectedFactor ? ` · 聚焦${factorLabels[selectedFactor]}` : ""}`}/>{chart}</section>;
}
