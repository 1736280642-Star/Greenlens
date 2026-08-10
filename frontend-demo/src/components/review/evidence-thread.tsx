import { AlertTriangle, Calculator, CheckCircle2, FileText, Link2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { AnalysisMetric, CompanyYearRecord, DashboardReviewTask, EvidenceItem, ReviewRecord } from "@/types";

interface Props {
  company: CompanyYearRecord;
  task: DashboardReviewTask;
  metric?: AnalysisMetric;
  evidence?: EvidenceItem;
  externalEvidence?: EvidenceItem;
  review?: ReviewRecord;
  selectedEvidenceId?: string | null;
  onSelectEvidence: (id: string) => void;
}

export function EvidenceThread({ company, task, metric, evidence, externalEvidence, review, selectedEvidenceId, onSelectEvidence }: Props) {
  const gap = getGap(company, task, evidence);
  return <section className="evidence-thread" aria-labelledby="evidence-thread-title">
    <header><div><span className="section-kicker">EVIDENCE THREAD</span><h3 id="evidence-thread-title">证据推理链</h3></div><small>模型信号 → 来源 → 人工判断</small></header>
    <ol>
      <ThreadNode tone="signal" icon={<ShieldAlert size={16}/>} label="模型触发" title={task.reason}><p>该结果是待复核风险信号，不是对企业行为的最终判断。</p></ThreadNode>
      <ThreadNode tone="metric" icon={<Calculator size={16}/>} label="指标计算" title={`${metricLabel(task.metricCode)} ${Math.round(task.metricValue * 100)}% · 关注阈值 ${Math.round(task.threshold * 100)}%`}>
        <dl><div><dt>分子 / 分母</dt><dd>{metric?.numerator ?? "--"} / {metric?.denominator ?? "--"}</dd></div><div><dt>公式版本</dt><dd>{metric?.formulaVersion ?? company.versions.score}</dd></div></dl>
      </ThreadNode>
      <ThreadNode tone={`source ${selectedEvidenceId === evidence?.id ? "active" : ""}`} icon={<FileText size={16}/>} label="报告原文" title={evidence?.title ?? "尚未返回可定位的报告原文"}>
        {evidence ? <><button className="thread-evidence-button" onClick={() => onSelectEvidence(evidence.id)}><span>引用 [1]</span><strong>{evidence.excerpt}</strong></button><Link href={`/companies/${company.companyId}?year=${company.reportYear}&tab=evidence&evidence=${evidence.id}`}>{evidence.sourceLabel} · {evidence.page ? `第 ${evidence.page} 页` : "尚未完成页码定位"}<Link2 size={12}/></Link></> : <p>当前任务只有证据ID，无法核对模型信号对应的原文上下文。</p>}
      </ThreadNode>
      {externalEvidence ? <ThreadNode tone={`external ${selectedEvidenceId === externalEvidence.id ? "active" : ""}`} icon={<Link2 size={16}/>} label="外部事实" title={externalEvidence.title}><button className="thread-evidence-button" onClick={() => onSelectEvidence(externalEvidence.id)}><span>引用 [2]</span><strong>{externalEvidence.excerpt}</strong></button></ThreadNode> : null}
      <ThreadNode tone={`gap ${gap.tone}`} icon={<AlertTriangle size={16}/>} label="证据缺口" title={gap.title}><p>{gap.detail}</p></ThreadNode>
      <ThreadNode tone={`decision ${review ? "complete" : "pending"}`} icon={<CheckCircle2 size={16}/>} label="人工判断" title={review ? decisionLabel(review.humanDecision) : "等待复核"}><p>{review?.note || "人工决定会连同原因、时间和证据引用一并保存。"}</p></ThreadNode>
    </ol>
  </section>;
}

function ThreadNode({ tone, icon, label, title, children }: { tone: string; icon: React.ReactNode; label: string; title: string; children: React.ReactNode }) {
  return <li className={`thread-node ${tone}`}><span className="thread-icon">{icon}</span><div><em>{label}</em><strong>{title}</strong>{children}</div></li>;
}

function getGap(company: CompanyYearRecord, task: DashboardReviewTask, evidence?: EvidenceItem) {
  if (company.evidenceLinkageStatus === "parse_failed") return { tone: "critical", title: "证据解析失败", detail: "PDF文本层没有成功解析，当前无法核对模型信号与报告原文。" };
  if (company.evidenceLinkageStatus === "unlinked" || !evidence) return { tone: "critical", title: "证据尚未关联", detail: "当前证据没有匹配到规范化的公司与报告年度。" };
  if (company.evidenceLinkageStatus === "low_coverage" || task.evidenceStatus === "insufficient") return { tone: "warning", title: "证据覆盖率不足", detail: `当前公司证据覆盖率为 ${company.evidenceCoverage}%，建议核对遗漏页与外部验证材料。` };
  return { tone: "clear", title: "未发现阻断性缺口", detail: "仍需人工确认主体、报告年度和事件相关性。" };
}

export function metricLabel(code: DashboardReviewTask["metricCode"]) { return code.replace("EAA_ESGSI", "E-AA-ESGSI"); }
function decisionLabel(value?: ReviewRecord["humanDecision"]) { return ({ confirm: "已确认信号", reject: "已驳回信号", partial: "部分相关", insufficient: "证据不足" } as const)[value ?? "insufficient"]; }
