"use client";

import { Maximize2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { CustomSeriesOption, EChartsOption } from "echarts";
import { CommandPanelHeading } from "./panel-heading";
import { RISK_COLORS, riskBandColor, riskFill } from "./risk-palette";
import { useEChart } from "./use-echart";
import type { DashboardConstellationNode, DashboardRiskNode, DashboardTriadCode, RiskBand } from "@/types";

type RiskPlotNode = DashboardRiskNode | DashboardConstellationNode;
type DatasetMode = "representative" | "full";

function nodeEsgsi(node: RiskPlotNode) {
  return "esgsi" in node ? node.esgsi : node.metricRiskValues.ESGSI;
}

type ViewMode = "hexbin" | "density" | "scatter";

type HexBin = {
  cx: number;
  cy: number;
  count: number;
  medianRisk: number;
  riskBand: RiskBand;
  members: RiskPlotNode[];
};

function riskBandFromValue(value: number): RiskBand {
  if (value >= .66) return "high";
  if (value >= .4) return "medium";
  return "low";
}

function densityOpacity(count: number): number {
  if (count >= 61) return 1;
  if (count >= 31) return .82;
  if (count >= 16) return .65;
  if (count >= 6) return .48;
  return .30;
}

function hexPath(radius: number) {
  let path = "";
  for (let index = 0; index < 6; index += 1) {
    const angle = Math.PI / 3 * index - Math.PI / 6;
    const x = radius + radius * Math.cos(angle);
    const y = radius + radius * Math.sin(angle);
    path += `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)} `;
  }
  return `${path}Z`;
}

function buildHexBins(nodes: RiskPlotNode[], cols: number, rows: number): HexBin[] {
  const dx = 1 / cols;
  const dy = 1 / rows;
  const grid = new Map<string, { cx: number; cy: number; members: RiskPlotNode[] }>();

  for (const node of nodes) {
    const x = nodeEsgsi(node);
    const y = node.eass;
    if (x == null || y == null) continue;
    const col = Math.min(cols - 1, Math.max(0, Math.floor(x / dx)));
    const rowOffset = col % 2 === 1 ? .5 : 0;
    const row = Math.min(rows - 1, Math.max(0, Math.floor(y / dy + rowOffset)));
    const key = `${col}:${row}`;
    const cx = (col + .5) * dx;
    const cy = Math.min(1, Math.max(0, (row + .5 - rowOffset) * dy));
    const current = grid.get(key) ?? { cx, cy, members: [] };
    current.members.push(node);
    grid.set(key, current);
  }

  return [...grid.values()].map(({ cx, cy, members }) => {
    const risks = members.map((member) => member.finalIndex).filter((value): value is number => value != null).sort((a, b) => a - b);
    const medianRisk = risks.length ? risks[Math.floor(risks.length / 2)] : 0;
    return { cx, cy, members, count: members.length, medianRisk, riskBand: riskBandFromValue(medianRisk) };
  });
}

const MODE_LABELS: Record<ViewMode, string> = { hexbin: "分箱", density: "密度", scatter: "散点" };

export function RiskDistributionHexbin({
  nodes,
  selectedFactor,
  selectedCompanyId,
  onSelect,
  onOpen,
  expanded = false,
  onExpand,
  datasetMode = "representative",
  onDatasetModeChange,
  datasetLoading = false,
  totalSampleCount,
}: {
  nodes: RiskPlotNode[];
  selectedFactor: DashboardTriadCode | null;
  selectedCompanyId: string | null;
  onSelect: (companyId: string, addToCompare: boolean) => void;
  onOpen: (companyId: string) => void;
  expanded?: boolean;
  onExpand?: () => void;
  datasetMode?: DatasetMode;
  onDatasetModeChange?: (mode: DatasetMode) => void;
  datasetLoading?: boolean;
  totalSampleCount?: number;
}) {
  const [mode, setMode] = useState<ViewMode>("hexbin");
  const plottable = useMemo(() => nodes.filter((node) => nodeEsgsi(node) != null && node.eass != null), [nodes]);
  const excludedCount = nodes.length - plottable.length;
  const cols = expanded ? 24 : 16;
  const rows = expanded ? 14 : 10;
  const bins = useMemo(() => buildHexBins(plottable, cols, rows), [cols, plottable, rows]);
  const maxCount = Math.max(1, ...bins.map((bin) => bin.count));

  const option = useMemo<EChartsOption>(() => {
    const commonGrid = { left: expanded ? 64 : 42, right: expanded ? 34 : 20, top: expanded ? 42 : 28, bottom: expanded ? 52 : 36 };
    const thresholdSeries = {
      name: "threshold",
      type: "scatter" as const,
      data: [],
      silent: true,
      markLine: {
        silent: true,
        symbol: "none",
        label: { show: false },
        lineStyle: { color: "rgba(245,184,58,.62)", type: "dashed" as const, width: 1.2 },
        data: [{ xAxis: .66 }, { yAxis: .66 }],
      },
      markArea: {
        silent: true,
        itemStyle: { color: "rgba(255,98,89,.025)" },
        data: [[{ xAxis: .66, yAxis: .66 }, { xAxis: 1, yAxis: 1 }]],
      },
    };

    const customSeries: CustomSeriesOption = {
      name: mode === "density" ? "样本密度" : "风险分箱",
      type: "custom" as const,
      renderItem: (params, api) => {
        const bin = bins[params.dataIndex];
        if (!bin) return { type: "group", children: [] };
        const point = api.coord([bin.cx, bin.cy]) as number[];
        const rawCell = api.size?.([1 / cols, 1 / rows]);
        const cell = Array.isArray(rawCell) ? rawCell : [28, 28];
        const cellWidth = Math.max(8, cell[0] * .98);
        const cellHeight = Math.max(8, cell[1] * .98);
        const density = bin.count / maxCount;
        const selected = bin.members.some((member) => member.companyId === selectedCompanyId);
        const fill = mode === "density" ? RISK_COLORS.selected : riskBandColor(bin.riskBand);
        const fillOpacity = densityOpacity(bin.count);
        return {
          type: "group",
          children: [
            {
              type: "path",
              shape: { pathData: hexPath(10), x: -cellWidth / 2, y: -cellHeight / 2, width: cellWidth, height: cellHeight },
              x: point[0],
              y: point[1],
              style: {
                fill: riskFill(fill, fillOpacity),
                opacity: 1,
                stroke: selected ? RISK_COLORS.selected : riskFill(fill, Math.max(.58, fillOpacity)),
                lineWidth: selected ? 2.2 : .65,
                shadowBlur: selected ? 14 : density > .72 ? 6 : 0,
                shadowColor: selected ? RISK_COLORS.selected : fill,
              },
            },
            {
              type: "text",
              x: point[0],
              y: point[1],
              style: {
                text: String(bin.count),
                fill: "#F4FFFE",
                font: `650 ${expanded ? 11 : 9}px Inter, sans-serif`,
                textAlign: "center",
                textVerticalAlign: "middle",
                opacity: mode === "hexbin" && (density > .34 || selected) ? .92 : 0,
              },
            },
          ],
        };
      },
      data: bins.map((bin, binIndex) => ({ value: [bin.cx, bin.cy], binIndex, sourceKind: "bin" })),
    };

    const scatterSeries = {
      name: "公司样本",
      type: "scatter" as const,
      data: plottable.map((node) => ({
        value: [nodeEsgsi(node) ?? 0, node.eass ?? 0],
        source: node,
        sourceKind: "node",
        symbolSize: node.companyId === selectedCompanyId ? 12 : 5,
        itemStyle: {
          color: riskBandColor(node.riskBand),
          opacity: node.companyId === selectedCompanyId ? 1 : .7,
          borderColor: node.companyId === selectedCompanyId ? RISK_COLORS.selected : "transparent",
          borderWidth: node.companyId === selectedCompanyId ? 2 : 0,
          shadowBlur: node.companyId === selectedCompanyId ? 12 : 0,
          shadowColor: RISK_COLORS.selected,
        },
      })),
    };

    return {
      animationDuration: plottable.length > 500 ? 0 : 360,
      grid: commonGrid,
      tooltip: {
        backgroundColor: "rgba(5,23,27,.97)",
        borderColor: "rgba(39,215,229,.3)",
        textStyle: { color: "#EAF5F3", fontSize: 12 },
        formatter: (params: unknown) => {
          const payload = (params as { data?: { sourceKind?: string; source?: RiskPlotNode; binIndex?: number } }).data;
          if (payload?.sourceKind === "node") {
            const node = payload.source as RiskPlotNode;
            return `<strong>${node.companyName}</strong><br/>ESI ${Math.round((nodeEsgsi(node) ?? 0) * 100)}% · EASS ${Math.round((node.eass ?? 0) * 100)}%<br/>EAA-ESI ${Math.round((node.finalIndex ?? 0) * 100)}%`;
          }
          const bin = payload?.binIndex == null ? undefined : bins[payload.binIndex];
          if (!bin) return "";
          return `<strong>${bin.count} 个样本</strong><br/>风险中位数 ${Math.round(bin.medianRisk * 100)}%<br/>颜色 = 风险等级 · 亮度 = 样本密度`;
        },
      },
      xAxis: {
        type: "value", min: 0, max: 1, name: "ESI / 修辞—内容差异", nameLocation: "middle", nameGap: expanded ? 34 : 26,
        nameTextStyle: { color: "#85A9A7", fontSize: expanded ? 12 : 11 },
        axisLine: { lineStyle: { color: "rgba(91,178,180,.34)" } },
        splitLine: { lineStyle: { color: "rgba(56,130,131,.09)" } },
        axisLabel: { color: "#85A9A7", fontSize: expanded ? 11 : 10, formatter: (value: number) => `${Math.round(value * 100)}` },
      },
      yAxis: {
        type: "value", min: 0, max: 1, name: "EASS 缺口 / 行动不足", nameLocation: "middle", nameGap: expanded ? 42 : 30,
        nameTextStyle: { color: "#85A9A7", fontSize: expanded ? 12 : 11 },
        axisLine: { lineStyle: { color: "rgba(91,178,180,.34)" } },
        splitLine: { lineStyle: { color: "rgba(56,130,131,.09)" } },
        axisLabel: { color: "#85A9A7", fontSize: expanded ? 11 : 10, formatter: (value: number) => `${Math.round(value * 100)}` },
      },
      graphic: [{
        type: "text",
        right: expanded ? 42 : 24,
        top: expanded ? 48 : 34,
        silent: true,
        style: { text: "HIGH RISK ZONE", fill: "rgba(255,117,110,.65)", font: `${expanded ? 11 : 9}px JetBrains Mono, monospace` },
      }],
      series: [mode === "scatter" ? scatterSeries : customSeries, thresholdSeries],
    };
  }, [bins, cols, expanded, maxCount, mode, plottable, rows, selectedCompanyId]);

  const ref = useEChart(option, {
    click: (params) => {
      const payload = (params as { data?: { sourceKind?: string; source?: RiskPlotNode; binIndex?: number } }).data;
      if (payload?.sourceKind === "node") return onSelect((payload.source as RiskPlotNode).companyId, false);
      const bin = payload?.binIndex == null ? undefined : bins[payload.binIndex];
      const target = bin?.members.toSorted((a, b) => (b.finalIndex ?? 0) - (a.finalIndex ?? 0))[0];
      if (target) onSelect(target.companyId, false);
    },
    dblclick: (params) => {
      const payload = (params as { data?: { sourceKind?: string; source?: RiskPlotNode; binIndex?: number } }).data;
      if (payload?.sourceKind === "node") return onOpen((payload.source as RiskPlotNode).companyId);
      const bin = payload?.binIndex == null ? undefined : bins[payload.binIndex];
      const target = bin?.members.toSorted((a, b) => (b.finalIndex ?? 0) - (a.finalIndex ?? 0))[0];
      if (target) onOpen(target.companyId);
    },
  });

  const factorHint = selectedFactor ? `聚焦：${selectedFactor === "RHETORIC_CONTENT" ? "ESI" : selectedFactor === "ACTION_SUBSTANCE" ? "EASS" : "IR / UPR"}` : undefined;

  return <section className={`cc-panel cc-hexbin-panel is-primary ${selectedCompanyId ? "has-company-selection" : ""} ${expanded ? "cc-panel-expanded" : ""}`}>
    <CommandPanelHeading
      eyebrow="RISK FIELD · HEXBIN"
      title="风险分布概览"
      detail={datasetLoading ? "正在加载全量 SQLite 投影…" : factorHint ?? `${datasetMode === "full" ? `全量 ${nodes.length}` : `代表 ${nodes.length}`} / ${totalSampleCount ?? nodes.length} 个样本${excludedCount ? ` · ${excludedCount} 项 ESI 缺失` : ""}`}
      action={<div className="cc-hexbin-mode" role="group" aria-label="风险分布视图模式">
        {onDatasetModeChange ? <span className="cc-constellation-scope" role="group" aria-label="风险星图样本范围">
          <button type="button" className={datasetMode === "representative" ? "active" : ""} aria-pressed={datasetMode === "representative"} onClick={() => onDatasetModeChange("representative")}>代表视图</button>
          <button type="button" className={datasetMode === "full" ? "active" : ""} aria-pressed={datasetMode === "full"} disabled={datasetLoading} onClick={() => onDatasetModeChange("full")}>{datasetLoading ? "加载中" : "全量视图"}</button>
        </span> : null}
        {(Object.keys(MODE_LABELS) as ViewMode[]).map((item) => <button type="button" key={item} className={mode === item ? "active" : ""} aria-pressed={mode === item} onClick={() => setMode(item)}>{MODE_LABELS[item]}</button>)}
        {onExpand && !expanded ? <button className="cc-expand-button" onClick={onExpand} aria-label="展开风险分布概览" title="展开风险分布概览"><Maximize2 /></button> : null}
      </div>}
    />
    <div className="cc-risk-stage cc-hexbin-stage" ref={ref} role="img" aria-label="ESI 与 EASS 行动缺口风险分布六边形分箱图；颜色表示风险等级，亮度表示样本密度" />
    <div className="cc-hexbin-legend" aria-label="风险分布图例">
      <span><i className="low" />低风险</span><span><i className="medium" />中风险</span><span><i className="high" />高风险</span>
      <small>颜色 = 风险等级 · 亮度 = 样本密度</small>
    </div>
  </section>;
}
