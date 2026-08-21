"use client";

import * as echarts from "echarts";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatMetricPercent, formatPercent, getMetric, metricPercent, type CompanyYearRecord } from "@/types";
import { useDemoStore } from "@/stores/demo-store";

const riskColors = { high: "#FF5C6C", medium: "#FF9F43", low: "#5B8CFF", unavailable: "#7F8C86" };

export function SubstanceSeverityMatrix({ companies }: { companies: CompanyYearRecord[] }) {
  const element = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { selectedCompanyId, selectCompany } = useDemoStore();
  const [showTable, setShowTable] = useState(false);
  const chartCompanies = useMemo(() => companies.filter((company) => getMetric(company, "EASS")?.normalizedValue != null && company.finalIndex != null), [companies]);
  const selected = chartCompanies.find((company) => company.companyId === selectedCompanyId);
  const data = useMemo(() => {
    const activeSelectedId = chartCompanies.some((company) => company.companyId === selectedCompanyId) ? selectedCompanyId : null;
    return chartCompanies.map((company) => ({
      name: company.companyName,
      companyId: company.companyId,
      reportYear: company.reportYear,
      value: [metricPercent(company, "EASS")!, Math.round(company.finalIndex! * 100), Math.max(8, Math.min(20, company.environmentalActions.totalStatements / 3))],
      itemStyle: {
        color: riskColors[company.riskBand], opacity: !activeSelectedId || activeSelectedId === company.companyId ? 1 : .24,
        borderColor: activeSelectedId === company.companyId ? "#F4F7F5" : riskColors[company.riskBand], borderWidth: activeSelectedId === company.companyId ? 2 : 1,
      },
    }));
  }, [chartCompanies, selectedCompanyId]);

  useEffect(() => {
    if (!element.current) return;
    const chart = echarts.init(element.current, undefined, { renderer: "canvas" });
    chart.setOption({
      animationDurationUpdate: 260,
      aria: { enabled: true, decal: { show: false }, description: "环境行动实质性与行动调整后漂绿指数象限图。左上区域为优先复核区。" },
      textStyle: { fontFamily: "Inter, Noto Sans SC, sans-serif", color: "#A7B0AC", fontSize: 16 },
      grid: { left: 68, right: 22, top: 30, bottom: 62 },
      tooltip: {
        trigger: "item", backgroundColor: "rgba(12,17,16,.97)", borderColor: "rgba(255,255,255,.16)", textStyle: { color: "#F4F7F5", fontSize: 16 },
        formatter: (params: { data: { name: string; value: number[]; companyId: string } }) => {
          const company = companies.find((item) => item.companyId === params.data.companyId);
          const upr = company ? metricPercent(company, "UPR") : null;
          return `<b>${params.data.name}</b><br/>EASS：${params.data.value[0]}%<br/>EAA-ESI：${params.data.value[1]}%<br/>UPR：${upr == null ? "--" : `${upr}%`}<br/>环境声明：${company?.environmentalActions.totalStatements ?? 0} 条`;
        },
      },
      xAxis: { type: "value", min: 0, max: 100, name: "EASS 行动实质性 →", nameLocation: "middle", nameGap: 40, nameTextStyle: { fontSize: 16 }, axisLabel: { color: "#89958F", fontSize: 16, formatter: "{value}%" }, splitLine: { lineStyle: { color: "rgba(255,255,255,.05)" } } },
      yAxis: { type: "value", min: 0, max: 100, name: "EAA-ESI ↑", nameGap: 42, nameTextStyle: { fontSize: 16 }, axisLabel: { color: "#89958F", fontSize: 16, formatter: "{value}%" }, splitLine: { lineStyle: { color: "rgba(255,255,255,.05)" } } },
      series: [{
        type: "scatter", data, symbolSize: (value: number[]) => value[2], emphasis: { scale: false },
        markArea: { silent: true, itemStyle: { color: "rgba(255,92,108,.045)", borderColor: "rgba(255,92,108,.38)", borderWidth: 1 }, label: { show: true, color: "#FF9F43", fontSize: 16 }, data: [[{ name: "低实质 · 高风险", xAxis: 0, yAxis: 66 }, { xAxis: 50, yAxis: 100 }]] },
        markLine: { silent: true, symbol: "none", lineStyle: { color: "rgba(244,211,94,.35)", type: "dashed" }, data: [{ xAxis: 50 }, { yAxis: 66 }] },
      }],
    });
    chart.on("click", (params) => { const point = params.data as { companyId: string; reportYear: number }; selectCompany(point.companyId, point.reportYear); });
    chart.on("dblclick", (params) => { const point = params.data as { companyId: string; reportYear: number }; router.push(`/companies/${point.companyId}?year=${point.reportYear}`); });
    const resize = new ResizeObserver(() => chart.resize()); resize.observe(element.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, [companies, data, router, selectCompany]);

  function moveSelection(direction: number) {
    if (!chartCompanies.length) return;
    const current = chartCompanies.findIndex((company) => company.companyId === selectedCompanyId);
    const next = current < 0 ? (direction > 0 ? 0 : chartCompanies.length - 1) : (current + direction + chartCompanies.length) % chartCompanies.length;
    selectCompany(chartCompanies[next].companyId, chartCompanies[next].reportYear);
  }

  return <div className="chart-wrap substance-matrix">
    <div ref={element} className="chart-canvas" role="img" tabIndex={0} aria-label="EASS 与 EAA-ESI 象限图。按方向键切换公司。" onKeyDown={(event) => {
      if (["ArrowRight", "ArrowUp"].includes(event.key)) moveSelection(1);
      if (["ArrowLeft", "ArrowDown"].includes(event.key)) moveSelection(-1);
      if (event.key === "Escape") selectCompany(null);
      if (event.key === "Enter" && selected) router.push(`/companies/${selected.companyId}?year=${selected.reportYear}`);
    }} />
    {selected && <button className="selected-summary" onClick={() => router.push(`/companies/${selected.companyId}?year=${selected.reportYear}`)}><strong>{selected.companyName}</strong><span>最终指数 {formatPercent(selected.finalIndex)} · EASS {formatMetricPercent(selected, "EASS")}</span></button>}
    <button className="text-button chart-table-toggle" onClick={() => setShowTable(!showTable)}>{showTable ? "隐藏数据表" : "查看数据表"}</button>
    {showTable && <div className="chart-data-table"><table><thead><tr><th>公司</th><th>EASS</th><th>EAA-ESI</th><th>UPR</th></tr></thead><tbody>{companies.map((company) => <tr key={company.companyId}><td>{company.companyName}</td><td>{formatMetricPercent(company, "EASS")}</td><td>{formatPercent(company.finalIndex)}</td><td>{formatMetricPercent(company, "UPR")}</td></tr>)}</tbody></table></div>}
  </div>;
}

export const ClaimFactMatrix = SubstanceSeverityMatrix;
