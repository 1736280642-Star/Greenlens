"use client";

import { useRef, useState } from "react";
import { DashboardDetailDialog } from "./dashboard-detail-dialog";
import type { DashboardCommandCenterData } from "@/types";
import { formatPercent } from "@/types";

type DeltaDirection = "up" | "down" | "flat" | null;

interface KpiDefinition {
  label: string;
  value: string;
  context: string;
  note: string;
  definition: string;
  tone: string;
  trend: Array<number | null>;
  delta: { delta: number | null; direction: DeltaDirection };
  deltaFormat: "count" | "rate";
  chart: "area" | "bars";
}

function lastDelta(values: Array<number | null>) {
  const available = values.filter((value): value is number => value != null);
  if (available.length < 2) return { delta: null, direction: null as DeltaDirection };
  const delta = available[available.length - 1] - available[available.length - 2];
  return { delta, direction: delta > 0 ? ("up" as const) : delta < 0 ? ("down" as const) : ("flat" as const) };
}

function formatDelta(delta: number | null, kind: "count" | "rate") {
  if (delta == null) return null;
  if (kind === "rate") return `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp`;
  return `${delta > 0 ? "+" : ""}${delta.toLocaleString()}`;
}

function Sparkline({ values }: { values: Array<number | null> }) {
  const available = values.map((value, index) => ({ value, index })).filter((item): item is { value: number; index: number } => item.value != null);
  if (available.length < 2) return <span className="cc-kpi-detail-trend-empty"/>;
  const min = Math.min(...available.map((item) => item.value));
  const max = Math.max(...available.map((item) => item.value));
  const range = max - min || 1;
  const points = available.map((item) => `${item.index / Math.max(1, values.length - 1) * 88 + 2},${28 - (item.value - min) / range * 21}`).join(" ");
  return <svg className="cc-kpi-detail-trend" viewBox="0 0 92 32" aria-hidden="true"><polyline points={points}/><polyline className="glow" points={points}/></svg>;
}

function AreaChart({ values }: { values: Array<number | null> }) {
  const available = values.map((value, index) => ({ value, index })).filter((item): item is { value: number; index: number } => item.value != null);
  if (available.length < 2) return <span className="cc-kpi-chart empty" aria-hidden="true"/>;
  const min = Math.min(...available.map((item) => item.value));
  const max = Math.max(...available.map((item) => item.value));
  const range = max - min || 1;
  const width = Math.max(1, values.length - 1);
  const points = available.map((item) => {
    const x = (item.index / width) * 100;
    const y = 28 - ((item.value - min) / range) * 24;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const [lastX, lastY] = points[points.length - 1].split(",").map(Number);
  return (
    <span className="cc-kpi-chart" aria-hidden="true">
      <svg viewBox="0 0 100 28" preserveAspectRatio="none">
        <path className="cc-kpi-area" d={`M0,28 L${points.join(" L")} L100,28 Z`}/>
        <polyline className="cc-kpi-line" points={points.join(" ")}/>
      </svg>
      <i className="cc-kpi-dot" style={{ left: `${lastX}%`, top: `${(lastY / 28) * 100}%` }}/>
    </span>
  );
}

function BarsChart({ values }: { values: Array<number | null> }) {
  const available = values.map((value, index) => ({ value, index })).filter((item): item is { value: number; index: number } => item.value != null);
  if (available.length < 2) return <span className="cc-kpi-chart empty" aria-hidden="true"/>;
  const min = Math.min(...available.map((item) => item.value));
  const max = Math.max(...available.map((item) => item.value));
  const range = max - min || 1;
  const width = Math.max(1, values.length - 1);
  const step = 92 / width;
  const barWidth = Math.max(2, step * 0.4);
  const lastIndex = available[available.length - 1].index;
  return (
    <span className="cc-kpi-chart" aria-hidden="true">
      <svg viewBox="0 0 100 28" preserveAspectRatio="none">
        {available.map((item) => {
          const height = 3 + ((item.value - min) / range) * 22;
          return <rect key={item.index} x={4 + item.index * step} y={28 - height} width={barWidth} height={height} rx={1.5} className={item.index === lastIndex ? "last" : ""}/>;
        })}
      </svg>
    </span>
  );
}

function DeltaBadge({ item }: { item: KpiDefinition }) {
  const text = formatDelta(item.delta.delta, item.deltaFormat);
  if (text == null || item.delta.direction == null) {
    return <span className="cc-kpi-delta flat" title="较上年变化">较上年 —</span>;
  }
  const arrow = item.delta.direction === "up" ? "▲" : item.delta.direction === "down" ? "▼" : "–";
  const upIsPositive = item.label === "当前样本";
  const className = item.delta.direction === "flat"
    ? "flat"
    : (item.delta.direction === "up") === upIsPositive ? "good" : "bad";
  return <span className={`cc-kpi-delta ${className}`} title="较上年变化">{arrow} {text}</span>;
}

export function KpiRail({ data }: { data: DashboardCommandCenterData }) {
  const [selected, setSelected] = useState<KpiDefinition | null>(null);
  const selectedTrigger = useRef<HTMLButtonElement | null>(null);
  const finalTrend = data.annualTrend.map((item) => item.medianFinalIndex);
  const highTrend = data.annualTrend.map((item) => item.highRiskRate);
  const qualityTrend = data.quality.map((item) => item.qualityFlaggedRows + item.duplicateGroups + item.titleTargetYearNotFound);
  const sampleTrend = data.quality.map((item) => item.uniqueCompanyYears);
  const latestHighRiskRate = highTrend.filter((value): value is number => value != null).at(-1) ?? null;
  const currentQuality = data.quality.find((item) => item.year === data.scope.reportYear) ?? data.quality.at(-1);
  const definitions: KpiDefinition[] = [
    {
      label: "当前样本",
      value: data.kpis.sampleCount.toLocaleString(),
      context: sampleTrend.length ? `覆盖 ${data.quality[0]?.year}–${data.quality.at(-1)?.year}` : "暂无年度序列",
      note: "公司-年份",
      definition: "当前筛选条件下进入分析口径的有效公司-年份记录数。",
      tone: "cyan",
      trend: sampleTrend,
      delta: lastDelta(sampleTrend),
      deltaFormat: "count",
      chart: "bars",
    },
    {
      label: "高风险",
      value: data.kpis.highRiskCount.toLocaleString(),
      context: `占样本 ${formatPercent(data.kpis.sampleCount ? data.kpis.highRiskCount / data.kpis.sampleCount : null)}`,
      note: "版本化分类",
      definition: "依据当前版本化风险阈值进入高风险带、需要优先复核的样本数。",
      tone: "coral",
      trend: highTrend,
      delta: lastDelta(highTrend),
      deltaFormat: "rate",
      chart: "area",
    },
    {
      label: "三年持续高风险",
      value: data.kpis.persistentHighRiskCount.toLocaleString(),
      context: `占高风险 ${formatPercent(data.kpis.highRiskCount ? data.kpis.persistentHighRiskCount / data.kpis.highRiskCount : null)}`,
      note: "连续三年",
      definition: "最近三个可用报告年度均处于高风险带的公司数，用于识别持续性待复核信号。",
      tone: "amber",
      trend: highTrend.slice(-3),
      delta: lastDelta(highTrend.slice(-3)),
      deltaFormat: "rate",
      chart: "area",
    },
    {
      label: "EAA-ESI 中位数",
      value: formatPercent(data.kpis.medianFinalIndex),
      context: `高风险率 ${formatPercent(latestHighRiskRate)}`,
      note: "当前样本",
      definition: "当前样本 EAA-ESI 最终风险方向指数的中位数，不代表事实概率或确定性判断。",
      tone: "blue",
      trend: finalTrend,
      delta: lastDelta(finalTrend),
      deltaFormat: "rate",
      chart: "area",
    },
    {
      label: "质量提醒",
      value: data.kpis.qualityAlertCount.toLocaleString(),
      context: currentQuality ? `重复 ${currentQuality.duplicateGroups} 组 · 异常 ${currentQuality.titleTargetYearNotFound}` : "暂无年度记录",
      note: "重复与异常",
      definition: "存在重复报告、年份异常或其他数据质量标记的记录数，与风险结果分开计算。",
      tone: "amber",
      trend: qualityTrend,
      delta: lastDelta(qualityTrend),
      deltaFormat: "count",
      chart: "bars",
    },
  ];
  return <>
    <section className="cc-kpi-rail" aria-label="核心观测指标">{definitions.map((item) => <button type="button" className={`cc-kpi tone-${item.tone}`} key={item.label} onClick={(event) => { selectedTrigger.current = event.currentTarget; setSelected(item); }} aria-label={`查看${item.label}详情`}>
      <span className="cc-kpi-top"><span className="cc-kpi-label">{item.label}</span><span className="cc-kpi-context">{item.context}</span></span>
      <span className="cc-kpi-main"><strong>{item.value}</strong><DeltaBadge item={item}/></span>
      {item.chart === "area" ? <AreaChart values={item.trend}/> : <BarsChart values={item.trend}/>}
    </button>)}</section>
    <DashboardDetailDialog open={selected != null} onOpenChange={(open) => { if (!open) setSelected(null); }} title={selected ? `${selected.label}详情` : "指标详情"} description="查看指标定义、统计口径与历史趋势" returnFocusRef={selectedTrigger}>
      {selected ? <section className={`cc-kpi-detail tone-${selected.tone}`}>
        <header><span>OBSERVATION METRIC</span><h3>{selected.label}</h3></header>
        <div className="cc-kpi-detail-value"><strong>{selected.value}</strong><span>{selected.note}</span></div>
        <div className="cc-kpi-detail-chart"><Sparkline values={selected.trend}/><span>历史可用年度趋势</span></div>
        <dl>
          <div><dt>指标定义</dt><dd>{selected.definition}</dd></div>
          <div><dt>当前口径</dt><dd>{data.scope.reportYear} 报告年度 · 当前筛选样本</dd></div>
          <div><dt>数据版本</dt><dd>{data.scope.dataVersion}</dd></div>
        </dl>
        <footer>风险指标仅用于发现待复核信号，最终判断由研究人员完成。</footer>
      </section> : null}
    </DashboardDetailDialog>
  </>;
}
