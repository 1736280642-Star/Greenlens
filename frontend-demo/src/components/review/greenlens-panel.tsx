"use client";

import { AlertTriangle, ChevronRight, GitCompareArrows, Lightbulb, SearchCheck, Sparkles, X } from "lucide-react";
import { useState } from "react";
import type { AnalysisMetric, CompanyYearRecord, DashboardReviewTask, EvidenceItem } from "@/types";
import { metricLabel } from "./evidence-thread";

type LensAction = "explain" | "counter" | "gaps" | "compare";
interface Props {
  open: boolean;
  company: CompanyYearRecord;
  task: DashboardReviewTask;
  metric?: AnalysisMetric;
  evidence?: EvidenceItem;
  externalEvidence?: EvidenceItem;
  previousCompany?: CompanyYearRecord;
  contextState: { tone: "loading" | "critical" | "warning" | "ready"; label: string };
  onClose: () => void;
  onCitation: (id: string) => void;
}

const actions = [
  { id: "explain" as const, label: "解释触发原因", icon: Lightbulb },
  { id: "counter" as const, label: "查找可能反证", icon: SearchCheck },
  { id: "gaps" as const, label: "列出证据缺口", icon: AlertTriangle },
  { id: "compare" as const, label: "与上年比较", icon: GitCompareArrows },
];

export function GreenLensPanel({ open, company, task, metric, evidence, externalEvidence, previousCompany, contextState, onClose, onCitation }: Props) {
  const [action, setAction] = useState<LensAction>("explain");
  const previousMetric = previousCompany?.metrics.find((item) => item.code === task.metricCode);
  return <aside className={`review-greenlens ${open ? "open" : ""}`} aria-label="绿镜复核助理" aria-hidden={!open}>
    <header><div><span className="greenlens-identity"><Sparkles size={15}/> GREENLENS</span><h3>绿镜 · 复核助理</h3></div><button className="icon-button" onClick={onClose} aria-label="收起绿镜"><X size={17}/></button></header>
    <div className="greenlens-context"><span>{company.companyName}</span><code>{company.reportYear}</code><span>{metricLabel(task.metricCode)}</span></div>
    <div className="greenlens-actions" aria-label="绿镜分析动作">{actions.map(({ id, label, icon: Icon }) => <button key={id} className={action === id ? "active" : ""} aria-pressed={action === id} onClick={() => setAction(id)}><Icon size={14}/><span>{label}</span></button>)}</div>
    <div className="greenlens-result" aria-live="polite">
      {action === "explain" ? <><LensLabel tone="fact">事实</LensLabel><h4>{task.reason}</h4><p>当前值为 <strong>{Math.round(task.metricValue * 100)}%</strong>，关注阈值为 <strong>{Math.round(task.threshold * 100)}%</strong>。{metric?.numerator != null && metric.denominator != null ? `计算使用 ${metric.numerator} / ${metric.denominator} 的分子分母。` : "当前接口未返回完整分子分母。"}</p>{evidence ? <Citation label={`[1] ${evidence.page ? `报告第 ${evidence.page} 页` : "报告证据"}`} onClick={() => onCitation(evidence.id)}/> : <Unavailable text="没有可定位的报告原文，不能把该解释视为已核实事实。"/>}</> : null}
      {action === "counter" ? <><LensLabel tone="inference">待核验</LensLabel><h4>可能削弱当前信号的材料</h4>{externalEvidence ? <><p>{externalEvidence.excerpt}</p><Citation label={`[2] ${externalEvidence.sourceLabel}`} onClick={() => onCitation(externalEvidence.id)}/></> : <Unavailable text="当前数据没有返回可作为反证的外部事实。这不代表反证不存在。"/>}</> : null}
      {action === "gaps" ? <><LensLabel tone="unknown">未知</LensLabel><h4>当前证据仍需人工确认</h4><ul><li>报告原文是否属于同一公司与报告年度</li><li>规划性声明是否包含负责人、预算和实施期限</li><li>外部事件是否属于同一经营主体</li><li>证据覆盖率 {company.evidenceCoverage}% 是否足以支持决定</li></ul></> : null}
      {action === "compare" ? <><LensLabel tone="inference">比较</LensLabel><h4>{previousCompany ? `${previousCompany.reportYear} → ${company.reportYear}` : "没有可比历史记录"}</h4>{previousCompany && previousMetric?.riskValue != null ? <p>{metricLabel(task.metricCode)}风险方向值由 <strong>{Math.round(previousMetric.riskValue * 100)}%</strong> 变为 <strong>{Math.round(task.metricValue * 100)}%</strong>，变化 <strong>{Math.round((task.metricValue - previousMetric.riskValue) * 100)}pp</strong>。比较只说明指标变化，不代表企业行为结论。</p> : <Unavailable text="当前Repository没有返回同口径上一年度指标，不能自动生成跨年判断。"/>}</> : null}
    </div>
    <footer className={`context-${contextState.tone}`}><span><i/>{contextState.label}</span><small>绿镜建议不替代人工判断</small></footer>
  </aside>;
}

function LensLabel({ tone, children }: { tone: string; children: React.ReactNode }) { return <span className={`lens-label ${tone}`}>{children}</span>; }
function Citation({ label, onClick }: { label: string; onClick: () => void }) { return <button className="lens-citation" onClick={onClick}><span>{label}</span><ChevronRight size={14}/></button>; }
function Unavailable({ text }: { text: string }) { return <div className="lens-unavailable"><AlertTriangle size={15}/><p>{text}</p></div>; }
