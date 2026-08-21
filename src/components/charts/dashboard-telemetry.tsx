"use client";

import * as echarts from "echarts";
import { useEffect, useMemo, useRef } from "react";
import { formatMetricPercent, getMetric, type CompanyYearRecord, type MetricCode } from "@/types";
import { useDemoStore } from "@/stores/demo-store";

const riskBands = [
  { key: "high", label: "高风险", color: "#FF5C6C" }, { key: "medium", label: "中风险", color: "#FF9F43" }, { key: "low", label: "低风险", color: "#5B8CFF" },
  { key: "unavailable", label: "暂不可评分", color: "#7F8C86" },
] as const;
const metricSet: Array<{ code: MetricCode; label: string }> = [
  { code: "EASS", label: "EASS 缺口" }, { code: "IR", label: "IR" }, { code: "UPR", label: "UPR" }, { code: "ESGSI", label: "ESI" }, { code: "IMBALANCE", label: "失衡" },
];

export function DashboardTelemetry({ companies }: { companies: CompanyYearRecord[] }) {
  const riskChart = useRef<HTMLDivElement>(null);
  const metricChart = useRef<HTMLDivElement>(null);
  const { selectedCompanyId, setFilters } = useDemoStore();
  const selected = companies.find((company) => company.companyId === selectedCompanyId) ?? companies[0];
  const riskData = useMemo(() => riskBands.map((band) => ({ ...band, value: companies.filter((company) => company.riskBand === band.key).length })).filter((item) => item.key !== "unavailable" || item.value > 0), [companies]);
  const selectedValues = metricSet.map(({ code }) => { const value = getMetric(selected, code)?.riskValue; return value == null ? null : Math.round(value * 100); });
  const averages = metricSet.map(({ code }) => { const values = companies.map((company) => getMetric(company, code)?.riskValue).filter((value): value is number => value != null); return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) : null; });

  useEffect(() => {
    if (!riskChart.current) return;
    const chart = echarts.init(riskChart.current, undefined, { renderer: "canvas" });
    chart.setOption({
      animationDuration: 260, aria: { enabled: true, decal: { show: false }, description: "按低中高风险展示样本占比。" },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "rgba(12,17,16,.97)", borderColor: "rgba(255,255,255,.16)", textStyle: { color: "#F4F7F5", fontSize: 16 } },
      grid: { left: 4, right: 4, top: 8, bottom: 4 }, xAxis: { type: "value", max: companies.length, show: false }, yAxis: { type: "category", data: ["样本"], show: false },
      series: riskData.map((item) => ({ name: item.label, type: "bar", stack: "risk", data: [item.value], barWidth: 16, itemStyle: { color: item.color } })),
    });
    const resize = new ResizeObserver(() => chart.resize()); resize.observe(riskChart.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, [companies.length, riskData]);

  useEffect(() => {
    if (!metricChart.current) return;
    const chart = echarts.init(metricChart.current, undefined, { renderer: "canvas" });
    chart.setOption({
      animationDurationUpdate: 260, aria: { enabled: true, decal: { show: false }, description: `${selected.companyName}核心指标风险方向值与样本均值对比。` },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "rgba(12,17,16,.97)", borderColor: "rgba(255,255,255,.16)", textStyle: { color: "#F4F7F5", fontSize: 16 } },
      grid: { left: 84, right: 12, top: 22, bottom: 18 }, legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 4, textStyle: { color: "#89958F", fontSize: 16 } },
      xAxis: { type: "value", max: 100, axisLabel: { show: false }, splitLine: { lineStyle: { color: "rgba(255,255,255,.05)" } } },
      yAxis: { type: "category", inverse: true, data: metricSet.map((item) => item.label), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#AEB8B3", fontSize: 16 } },
      series: [
        { name: "选中", type: "bar", data: selectedValues, barWidth: 7, itemStyle: { color: "#F4D35E" } },
        { name: "均值", type: "scatter", data: averages.map((value, index) => [value, index]), symbol: "rect", symbolSize: [3, 13], itemStyle: { color: "#30D5E8" } },
      ],
    });
    const resize = new ResizeObserver(() => chart.resize()); resize.observe(metricChart.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, [averages, selected, selectedValues]);

  const actions = selected.environmentalActions;
  return <section className="panel dashboard-telemetry" aria-label="紧凑样本遥测">
    <header className="panel-header"><div><h3>样本遥测</h3><p>分布、行动构成与核心指标</p></div><code>CONTRACT-V1</code></header>
    <div className="telemetry-body compact-telemetry">
      <section className="telemetry-block risk-mix"><div className="telemetry-block-title"><span>风险分布</span><small>{companies.length} 个公司-年份</small></div><div ref={riskChart} className="telemetry-risk-bar" role="img" aria-label="风险等级水平堆叠条"/><div className="telemetry-legend compact">{riskData.map((item) => <button key={item.key} onClick={() => setFilters({ risk: item.label })}><i style={{ background: item.color }}/><span>{item.label}</span><code>{item.value}</code></button>)}</div></section>
      <section className="telemetry-block action-mix"><div className="telemetry-block-title"><span>{selected.companyName} · 行动构成</span><small>{actions.totalStatements} 条</small></div><div className="action-stack" role="img" aria-label="环境行动分类占比">{[["implemented", actions.implemented, "#38E07B"],["planning", actions.planning, "#5B8CFF"],["indeterminate", actions.indeterminate, "#F4D35E"]].map(([key,value,color]) => <i key={key as string} style={{ width: `${actions.totalStatements ? Number(value) / actions.totalStatements * 100 : 0}%`, background: color as string }}/>)}</div><div className="action-legend"><span>已实施 <code>{actions.implemented}</code></span><span>计划 <code>{actions.planning}</code></span><span>模糊 <code>{actions.indeterminate}</code></span><span>EASS <code>{formatMetricPercent(selected,"EASS")}</code></span></div></section>
      <section className="telemetry-block metric-bullets"><div className="telemetry-block-title"><span>指标风险方向值</span><small>黄：选中 · 青：均值</small></div><div ref={metricChart} className="telemetry-metric-chart" role="img" aria-label="核心指标 Bullet 图"/></section>
    </div>
  </section>;
}
