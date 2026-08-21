"use client";

import * as echarts from "echarts";
import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getMetric, type CompanyYearRecord, type DashboardInsights, type MetricCode } from "@/types";

type DiagnosticMode = "risk" | "evidence" | "review";
interface RiskInsightsProps { companies: CompanyYearRecord[]; insights: DashboardInsights; selectedFactor: MetricCode | null; onSelectFactor: (factor: MetricCode | null) => void; onSelectIndustry: (industry: string) => void; }

const factorDefs: Array<{ code: MetricCode; label: string }> = [
  { code: "EASS", label: "EASS 缺口" }, { code: "IR", label: "IR" }, { code: "UPR", label: "UPR" }, { code: "ESGSI", label: "ESI" }, { code: "IMBALANCE", label: "ESG 失衡" },
];
const tooltip = { backgroundColor: "rgba(12,17,16,.97)", borderColor: "rgba(255,255,255,.16)", textStyle: { color: "#F4F7F5", fontSize: 16 } };

export function DashboardRiskInsights({ companies, insights, selectedFactor, onSelectFactor, onSelectIndustry }: RiskInsightsProps) {
  const incidenceRef = useRef<HTMLDivElement>(null); const heatmapRef = useRef<HTMLDivElement>(null); const diagnosticRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<DiagnosticMode>("risk");
  const incidence = useMemo(() => factorDefs.map((factor) => ({ ...factor, cases: companies.filter((company) => (getMetric(company, factor.code)?.riskValue ?? 0) >= .5).length })).sort((a,b) => b.cases-a.cases), [companies]);
  const industries = useMemo(() => [...new Set(companies.map((company) => company.industry))], [companies]);
  const heatmapData = useMemo(() => industries.flatMap((industry, industryIndex) => factorDefs.map((factor, factorIndex) => {
    const group = companies.filter((company) => company.industry === industry);
    return [factorIndex, industryIndex, Math.round(group.reduce((sum, company) => sum + (getMetric(company, factor.code)?.riskValue ?? 0), 0) / Math.max(1, group.length) * 100)];
  })), [companies, industries]);

  useEffect(() => {
    if (!incidenceRef.current) return; const chart = echarts.init(incidenceRef.current, undefined, { renderer: "canvas" });
    chart.setOption({ animationDuration: 260, aria: { enabled: true, decal: { show: false }, description: "核心指标高风险方向命中样本数。" }, grid: { left: 92, right: 28, top: 16, bottom: 30 }, tooltip: { ...tooltip, trigger: "axis" }, xAxis: { type: "value", axisLabel: { color: "#89958F", fontSize: 16 }, splitLine: { lineStyle: { color: "rgba(255,255,255,.05)" } } }, yAxis: { type: "category", inverse: true, data: incidence.map((item) => item.label), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#AEB8B3", fontSize: 16 } }, series: [{ type: "bar", barWidth: 7, data: incidence.map((item) => ({ value: item.cases, itemStyle: { color: selectedFactor === item.code ? "#F4D35E" : "#38E07B", borderRadius: [0,2,2,0] } })), markPoint: { symbol: "circle", symbolSize: 8, label: { show: false }, data: incidence.map((item,index) => ({ coord: [item.cases,index], itemStyle: { color: selectedFactor === item.code ? "#F4D35E" : "#38E07B" } })) } }] });
    chart.on("click", (params) => { const factor = incidence[params.dataIndex]; if (factor) onSelectFactor(selectedFactor === factor.code ? null : factor.code); });
    const resize = new ResizeObserver(() => chart.resize()); resize.observe(incidenceRef.current); return () => { resize.disconnect(); chart.dispose(); };
  }, [incidence, onSelectFactor, selectedFactor]);

  useEffect(() => {
    if (!heatmapRef.current) return; const chart = echarts.init(heatmapRef.current, undefined, { renderer: "canvas" });
    chart.setOption({ animationDuration: 260, aria: { enabled: true, decal: { show: false }, description: "行业与核心指标风险方向值热力图。" }, grid: { left: 94, right: 16, top: 12, bottom: 56 }, tooltip: { ...tooltip, formatter: (params: { value: number[] }) => `${industries[params.value[1]]}<br/>${factorDefs[params.value[0]].label} · ${params.value[2]}%` }, xAxis: { type: "category", data: factorDefs.map((factor) => factor.label), axisLine: { lineStyle: { color: "rgba(255,255,255,.1)" } }, axisTick: { show: false }, axisLabel: { color: "#89958F", fontSize: 16, interval: 0, rotate: 18, margin: 12 } }, yAxis: { type: "category", data: industries, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#AEB8B3", fontSize: 16 } }, visualMap: { min: 15, max: 85, show: false, inRange: { color: ["#17221E", "#1E6150", "#F4D35E", "#FF5C6C"] } }, series: [{ type: "heatmap", data: heatmapData, label: { show: true, color: "#F4F7F5", fontSize: 16 }, itemStyle: { borderColor: "#0C1110", borderWidth: 2 } }] });
    chart.on("click", (params) => { const cell=params.data as number[]; const factor=factorDefs[cell[0]]; const industry=industries[cell[1]]; if(factor&&industry){onSelectFactor(factor.code);onSelectIndustry(industry);} });
    const resize = new ResizeObserver(() => chart.resize()); resize.observe(heatmapRef.current); return () => { resize.disconnect(); chart.dispose(); };
  }, [heatmapData, industries, onSelectFactor, onSelectIndustry]);

  useEffect(() => {
    if (!diagnosticRef.current) return; const chart=echarts.init(diagnosticRef.current,undefined,{renderer:"canvas"});
    const base={animationDuration:240,aria:{enabled:true,decal:{show:false}},tooltip,grid:{left:64,right:18,top:18,bottom:34}};
    if(mode==="risk"){
      const bins=[0,20,40,60,80]; const scored=companies.filter((company)=>company.finalIndex!=null); const counts=bins.map((start)=>scored.filter((company)=>Math.round(company.finalIndex!*100)>=start&&Math.round(company.finalIndex!*100)<start+20).length);
      chart.setOption({...base,xAxis:{type:"category",data:bins.map((start)=>`${start}-${start+19}`),axisLabel:{color:"#89958F",fontSize:16},axisLine:{lineStyle:{color:"rgba(255,255,255,.1)"}}},yAxis:{type:"value",axisLabel:{color:"#89958F",fontSize:16},splitLine:{lineStyle:{color:"rgba(255,255,255,.05)"}}},series:[{type:"bar",data:counts,barMaxWidth:28,itemStyle:{color:"#FF9F43"},markArea:{silent:true,itemStyle:{color:"rgba(255,92,108,.05)"},data:[[{xAxis:"60-79"},{xAxis:"80-99"}]]}}]});
    }else if(mode==="evidence"){
      chart.setOption({...base,grid:{left:96,right:24,top:12,bottom:20},xAxis:{type:"value",max:100,axisLabel:{show:false},splitLine:{lineStyle:{color:"rgba(255,255,255,.05)"}}},yAxis:{type:"category",inverse:true,data:insights.evidenceCoverage.map((item)=>item.label),axisLabel:{color:"#AEB8B3",fontSize:16},axisLine:{show:false},axisTick:{show:false}},series:[{type:"bar",data:insights.evidenceCoverage.map((item)=>item.coverage),barWidth:9,itemStyle:{color:"#30D5E8"},markLine:{silent:true,symbol:"none",lineStyle:{color:"#F4D35E",type:"dashed"},data:[{xAxis:70}]}}]});
    }else{
      const data=[{name:"待复核",value:companies.filter(c=>c.reviewStatus==="pending").length,color:"#F4D35E"},{name:"部分",value:companies.filter(c=>c.reviewStatus==="partial").length,color:"#30D5E8"},{name:"已复核",value:companies.filter(c=>c.reviewStatus==="reviewed").length,color:"#38E07B"},{name:"争议",value:companies.filter(c=>c.reviewStatus==="disputed").length,color:"#E879F9"}];
      chart.setOption({...base,legend:{bottom:0,itemWidth:10,itemHeight:6,textStyle:{color:"#89958F",fontSize:16}},xAxis:{type:"value",max:companies.length,show:false},yAxis:{type:"category",data:["状态"],show:false},series:data.map(item=>({name:item.name,type:"bar",stack:"total",data:[item.value],barWidth:22,itemStyle:{color:item.color}}))});
    }
    const resize=new ResizeObserver(()=>chart.resize());resize.observe(diagnosticRef.current);return()=>{resize.disconnect();chart.dispose();};
  },[companies,insights.evidenceCoverage,mode]);

  return <section className="dashboard-band dense-band risk-insights-band" aria-labelledby="risk-insights-title">
    <header className="dashboard-band-heading"><div><span className="section-kicker">MODEL SIGNALS</span><h2 id="risk-insights-title">指标聚集与行业差异</h2></div>{selectedFactor?<button className="quiet-button" onClick={()=>onSelectFactor(null)}><RotateCcw size={13}/>清除指标筛选</button>:<span className="band-context">风险方向值 ≥ 50%</span>}</header>
    <div className="risk-insights-grid dense-insights-grid">
      <section className="insight-panel pareto-panel"><header><div><h3>指标命中频次</h3><p>水平棒棒糖 · 点击联动</p></div></header><div ref={incidenceRef} className="insight-chart compact-chart" role="img" aria-label="指标命中频次图"/><div className="pareto-factor-controls">{incidence.map(factor=><button key={factor.code} className={selectedFactor===factor.code?"active":""} onClick={()=>onSelectFactor(selectedFactor===factor.code?null:factor.code)} aria-label={`筛选${factor.label}`}>{factor.label}</button>)}</div></section>
      <section className="insight-panel heatmap-panel"><header><div><h3>行业 × 核心指标</h3><p>统一为风险方向值</p></div></header><div ref={heatmapRef} className="insight-chart compact-chart" role="img" aria-label="行业核心指标热力图"/></section>
      <section className="insight-panel diagnostic-panel"><header><div><h3>结构诊断</h3></div><div className="segmented" role="tablist">{([['risk','最终指数'],['evidence','计划要素'],['review','复核状态']] as const).map(([key,label])=><button key={key} role="tab" aria-selected={mode===key} className={mode===key?"active":""} onClick={()=>setMode(key)}>{label}</button>)}</div></header><div ref={diagnosticRef} className="diagnostic-chart compact-chart" role="img" aria-label="结构诊断图"/></section>
    </div>
  </section>;
}
