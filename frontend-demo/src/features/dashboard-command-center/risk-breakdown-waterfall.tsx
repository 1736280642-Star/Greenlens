"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { CommandPanelHeading } from "./panel-heading";
import { useEChart } from "./use-echart";
import { ACCENT_COLORS, RISK_COLORS } from "./risk-palette";
import type { DashboardCohortBreakdown, DashboardRiskNode } from "@/types";

type WaterfallStep = {
  label: string;
  /** Signed delta in pp (percentage points). Positive = adds to risk, negative = subtracts. */
  delta: number;
  /** Cumulative running total after this step (only for non-base steps). */
  running?: number;
  kind: "base" | "penalty" | "evidence" | "calibration" | "final";
};

function buildSteps(target: { baseEsgsi: number | null; actionPenalty: number | null; indeterminatePenalty: number | null; planningPenalty: number | null; evidenceAdjustment: number | null; final: number | null }): WaterfallStep[] {
  const displayValue = (value: number) => Math.round(value * 100) / 100;
  const base = displayValue(target.baseEsgsi ?? 0);
  const action = displayValue(target.actionPenalty ?? 0);
  const indeterminate = displayValue(target.indeterminatePenalty ?? 0);
  const planning = displayValue(target.planningPenalty ?? 0);
  const evidence = displayValue(target.evidenceAdjustment ?? 0);
  const final = displayValue(target.final ?? base + action + indeterminate + planning + evidence);
  let running = base;
  const steps: WaterfallStep[] = [{ label: "基础 ESGSI", delta: base, kind: "base", running: base }];
  for (const [label, delta, kind] of [
    ["行动实质罚项", action, "penalty"],
    ["模糊声明罚项", indeterminate, "penalty"],
    ["未验证规划罚项", planning, "penalty"],
    ["证据调整", evidence, "evidence"],
  ] as const) {
    running += delta;
    steps.push({ label, delta, kind, running });
  }
  const reconciliation = displayValue(final - running);
  if (Math.abs(reconciliation) >= .0005) {
    running += reconciliation;
    steps.push({ label: "归一化校准", delta: reconciliation, kind: "calibration", running });
  }
  steps.push({ label: "最终 E-AA", delta: final, kind: "final", running: final });
  return steps;
}

function pct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function pp(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value * 100)}pp`;
}

function finalRiskColor(value: number): string {
  if (value < .35) return RISK_COLORS.low;
  if (value < .65) return RISK_COLORS.medium;
  return RISK_COLORS.high;
}

export function RiskBreakdownWaterfall({
  cohort,
  selectedCompany,
  expanded = false,
  onExpand,
}: {
  cohort: DashboardCohortBreakdown;
  selectedCompany: DashboardRiskNode | null;
  expanded?: boolean;
  onExpand?: () => void;
}) {
  const useCompany = selectedCompany != null && selectedCompany.indexBreakdown.baseEsgsiNormalized != null;
  const target = useMemo(() => useCompany
    ? {
      baseEsgsi: selectedCompany!.indexBreakdown.baseEsgsiNormalized,
      actionPenalty: selectedCompany!.indexBreakdown.actionPenalty.contribution,
      indeterminatePenalty: selectedCompany!.indexBreakdown.indeterminatePenalty.contribution,
      planningPenalty: selectedCompany!.indexBreakdown.planningPenalty.contribution,
      evidenceAdjustment: selectedCompany!.indexBreakdown.evidenceAdjustment.contribution,
      final: selectedCompany!.finalIndex,
    }
    : cohort, [cohort, selectedCompany, useCompany]);
  const objectLabel = useCompany ? `当前对象 · ${selectedCompany!.companyName}` : "全部样本中位数";

  const steps = useMemo(() => buildSteps(target), [target]);
  const option = useMemo<EChartsOption>(() => {
    const labels = steps.map((s) => s.label);
    // Stacked-bar waterfall: each step uses a transparent placeholder + visible segment.
    const placeholder: (number | null)[] = [];
    const positive: (number | null)[] = [];
    const negative: (number | null)[] = [];
    const totals: (number | null)[] = [];
    let floor = 0;
    for (const step of steps) {
      if (step.kind === "base" || step.kind === "final") {
        placeholder.push(0);
        positive.push(Math.max(0, step.delta));
        negative.push(null);
        floor = step.delta;
      } else {
        const delta = step.delta;
        if (delta >= 0) {
          placeholder.push(floor);
          positive.push(delta);
          negative.push(null);
        } else {
          placeholder.push(floor + delta);
          positive.push(null);
          negative.push(Math.abs(delta));
        }
        floor += delta;
      }
      totals.push(step.running ?? step.delta);
    }
    const runningValues = steps.map((step) => step.running ?? step.delta);
    const domainMin = Math.min(0, ...runningValues, ...steps.map((step) => step.kind === "final" ? 0 : (step.running ?? 0) - step.delta));
    const domainMax = Math.max(.2, ...runningValues, ...steps.map((step) => Math.abs(step.delta)));
    const yMin = Math.floor((domainMin - .04) * 10) / 10;
    const yMax = Math.ceil((domainMax + .08) * 10) / 10;
    const finalColor = finalRiskColor(steps.at(-1)?.delta ?? 0);
    return {
      animationDuration: 420,
      grid: { left: expanded ? 56 : 44, right: expanded ? 36 : 22, top: expanded ? 40 : 26, bottom: expanded ? 56 : 38 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(5,23,27,.96)",
        borderColor: "rgba(39,215,229,.25)",
        textStyle: { color: "#EAF5F3", fontSize: 12 },
        formatter: (params: unknown) => {
          const list = params as Array<{ dataIndex: number; seriesName: string; value: number }>;
          const idx = list[0]?.dataIndex;
          if (idx == null || idx < 0 || idx >= steps.length) return "";
          const step = steps[idx];
          if (step.kind === "base" || step.kind === "final") return `${step.label}<br/><strong>${pct(step.delta)}</strong>`;
          return `${step.label}<br/>${pp(step.delta)} → 累计 <strong>${pct(step.running)}</strong>`;
        },
      },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: "#85A9A7", fontSize: expanded ? 12 : 10, interval: 0, rotate: expanded ? 0 : 12 },
        axisLine: { lineStyle: { color: "rgba(56,130,131,.16)" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        min: yMin,
        max: yMax,
        axisLabel: { color: "#85A9A7", fontSize: expanded ? 12 : 10, formatter: (v: number) => `${Math.round(v * 100)}%` },
        splitLine: { lineStyle: { color: "rgba(56,130,131,.10)" } },
      },
      series: [
        {
          name: "placeholder",
          type: "bar",
          stack: "waterfall",
          itemStyle: { color: "transparent" },
          barWidth: expanded ? 56 : 42,
          data: placeholder,
          silent: true,
        },
        {
          name: "positive",
          type: "bar",
          stack: "waterfall",
          barWidth: expanded ? 56 : 42,
          itemStyle: {
            borderRadius: 2,
            color: (params: { dataIndex: number }) => {
              const step = steps[params.dataIndex];
              if (step?.kind === "base") {
                return { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: ACCENT_COLORS.cyan }, { offset: 1, color: "#0B6B75" }] };
              }
              if (step?.kind === "penalty") return ACCENT_COLORS.coral;
              if (step?.kind === "calibration") return ACCENT_COLORS.blue;
              if (step?.kind === "evidence") return step.delta >= 0 ? ACCENT_COLORS.coral : ACCENT_COLORS.aqua;
              return finalColor;
            },
          },
          label: {
            show: true,
            position: "top",
            color: "#ECF8F6",
            fontSize: expanded ? 14 : 12,
            fontWeight: 600,
            fontFamily: "Inter, JetBrains Mono, monospace",
            formatter: (params: { dataIndex: number }) => {
              const step = steps[params.dataIndex];
              if (step.kind === "final") return `{final|${pct(step.delta)}}`;
              if (step.kind === "base") return pct(step.delta);
              return pp(step.delta);
            },
            rich: { final: { color: finalColor, fontSize: expanded ? 18 : 15, fontWeight: 750, textShadowBlur: 8, textShadowColor: finalColor } },
          },
          data: positive,
        },
        {
          name: "negative",
          type: "bar",
          stack: "waterfall",
          barWidth: expanded ? 56 : 42,
          itemStyle: {
            borderRadius: 2,
            color: (params: { dataIndex: number }) => {
              const step = steps[params.dataIndex];
              if (step?.kind === "calibration") return ACCENT_COLORS.blue;
              if (step?.kind === "evidence" || step?.delta < 0) return ACCENT_COLORS.aqua;
              return ACCENT_COLORS.coral;
            },
          },
          label: {
            show: true,
            position: "bottom",
            color: "#ECF8F6",
            fontSize: expanded ? 14 : 12,
            fontWeight: 600,
            fontFamily: "Inter, JetBrains Mono, monospace",
            formatter: (params: { dataIndex: number }) => {
              const step = steps[params.dataIndex];
              return pp(step.delta);
            },
          },
          data: negative,
        },
        {
          name: "累计路径",
          type: "line",
          step: "end",
          symbol: "none",
          silent: true,
          z: 1,
          data: totals,
          lineStyle: { color: "rgba(118,150,156,.60)", width: 1, type: "dashed" },
        },
      ],
    };
  }, [steps, expanded]);

  const ref = useEChart(option);
  return (
    <section className={`cc-panel cc-waterfall-panel ${useCompany ? "is-selected" : ""} ${expanded ? "cc-panel-expanded" : ""}`}>
      <CommandPanelHeading eyebrow="WHY THIS RISK?" title="E-AA-ESGSI 构成" action={<span className={`cc-company-chip ${useCompany ? "selected" : ""}`}>{useCompany ? `COMPANY · ${selectedCompany!.companyName}` : "COHORT · 样本中位"}</span>} onExpand={expanded ? undefined : onExpand} expandLabel="展开 E-AA-ESGSI 构成" />
      <div className="cc-bottom-chart cc-waterfall-chart" ref={ref} role="img" aria-label={`${objectLabel} 的 E-AA-ESGSI 瀑布图`} />
    </section>
  );
}
