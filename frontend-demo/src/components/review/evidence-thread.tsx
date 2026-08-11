import { AlertTriangle, Calculator, CheckCircle2, FileSearch, FileText, Link2, ShieldAlert } from "lucide-react";
import type { AnalysisMetric, CompanyYearRecord, DashboardReviewTask, EvidenceItem, EvidencePageReference, ReviewRecord } from "@/types";

interface Props {
  company: CompanyYearRecord;
  task: DashboardReviewTask;
  metric?: AnalysisMetric;
  evidence?: EvidenceItem;
  externalEvidence?: EvidenceItem;
  review?: ReviewRecord;
  selectedEvidenceId?: string | null;
  pageReference: EvidencePageReference | null;
  pageLoading: boolean;
  pageError: string | null;
  onSelectEvidence: (id: string) => void;
}

export function EvidenceThread({ company, task, metric, evidence, externalEvidence, review, selectedEvidenceId, pageReference, pageLoading, pageError, onSelectEvidence }: Props) {
  const gap = getGap(company, task, evidence);
  return <section className="evidence-thread" aria-labelledby="evidence-thread-title">
    <header><div><span className="section-kicker">EVIDENCE SPINE</span><h3 id="evidence-thread-title">证据推理链</h3></div><small>触发 → 计算 → 原文 → 外部事实 → 缺口 → 人工结论</small></header>
    <ol>
      <ThreadNode tone="signal compact" icon={<ShieldAlert size={17}/>} label="01 · 模型触发" title={task.reason}><p>这是待复核风险信号，不是对企业行为的最终判断。</p></ThreadNode>
      <ThreadNode tone="metric compact" icon={<Calculator size={17}/>} label="02 · 指标计算" title={`${metricLabel(task.metricCode)} ${Math.round(task.metricValue * 100)}% · 关注阈值 ${Math.round(task.threshold * 100)}%`}>
        <dl><div><dt>分子 / 分母</dt><dd>{metric?.numerator ?? "--"} / {metric?.denominator ?? "--"}</dd></div><div><dt>公式版本</dt><dd>{metric?.formulaVersion ?? company.versions.score}</dd></div></dl>
      </ThreadNode>
      <ThreadNode tone={`source evidence-focus ${selectedEvidenceId === evidence?.id ? "active" : ""}`} icon={<FileText size={17}/>} label="03 · 报告原文" title={evidence?.title ?? "尚未返回可定位的报告原文"} evidenceId={evidence?.id}>
        {evidence ? <div className="source-evidence-layout">
          <button className="thread-evidence-button" onClick={() => onSelectEvidence(evidence.id)}><span>引用 [1]</span><strong>{evidence.excerpt}</strong><small>{evidence.sourceLabel} · {evidence.page ? `第 ${evidence.page} 页` : "尚未完成页码定位"}</small></button>
          <div className={`source-reader ${pageLoading ? "loading" : ""}`} aria-live="polite">
            <header><span><FileSearch size={15}/>原文页文本</span>{pageReference ? <code>{pageReference.page} / {pageReference.pageCount}</code> : null}</header>
            {pageLoading ? <p>正在从只读文档存储读取对应页文本…</p> : pageError ? <p className="source-reader-error">读取失败：{pageError}。当前摘录仍可用于定位。</p> : pageReference ? <><p>{pageReference.text}</p><small>{pageReference.sourceLabel} · 报告年度 {pageReference.reportYear}</small></> : <p>当前证据没有可读取的页文本。请检查页码定位或解析状态。</p>}
          </div>
        </div> : <p>当前任务只有证据 ID，无法核对模型信号对应的原文上下文。</p>}
      </ThreadNode>
      <ThreadNode tone={`external ${selectedEvidenceId === externalEvidence?.id ? "active" : ""}`} icon={<Link2 size={17}/>} label="04 · 外部事实" title={externalEvidence?.title ?? "未接入可核验的外部事实"} evidenceId={externalEvidence?.id}>
        {externalEvidence ? <button className="thread-evidence-button" onClick={() => onSelectEvidence(externalEvidence.id)}><span>引用 [2]</span><strong>{externalEvidence.excerpt}</strong><small>{externalEvidence.sourceLabel}</small></button> : <p>缺失本身也是复核信息：当前结论不能假设不存在反证。</p>}
      </ThreadNode>
      <ThreadNode tone={`gap ${gap.tone}`} icon={<AlertTriangle size={17}/>} label="05 · 证据缺口" title={gap.title}><p>{gap.detail}</p></ThreadNode>
      <ThreadNode tone={`decision ${review ? "complete" : "pending"}`} icon={<CheckCircle2 size={17}/>} label="06 · 人工结论" title={review ? decisionLabel(review.humanDecision) : "等待明确选择"}><p>{review?.note || "系统不会预选结论。决定、原因、备注、证据引用与时间会一并保存。"}</p></ThreadNode>
    </ol>
  </section>;
}

function ThreadNode({ tone, icon, label, title, children, evidenceId }: { tone: string; icon: React.ReactNode; label: string; title: string; children: React.ReactNode; evidenceId?: string }) {
  return <li className={`thread-node ${tone}`} data-evidence-id={evidenceId}><span className="thread-icon">{icon}</span><div><em>{label}</em><strong>{title}</strong>{children}</div></li>;
}

function getGap(company: CompanyYearRecord, task: DashboardReviewTask, evidence?: EvidenceItem) {
  if (company.evidenceLinkageStatus === "parse_failed") return { tone: "critical", title: "证据解析失败", detail: "PDF 文本层没有成功解析，当前无法核对模型信号与报告原文。" };
  if (company.evidenceLinkageStatus === "unlinked" || !evidence) return { tone: "critical", title: "证据尚未关联", detail: "当前证据没有匹配到规范化的公司与报告年度。" };
  if (company.evidenceLinkageStatus === "low_coverage" || task.evidenceStatus === "insufficient") return { tone: "warning", title: "证据覆盖率不足", detail: `当前公司证据覆盖率为 ${company.evidenceCoverage}%，建议核对遗漏页与外部验证材料。` };
  return { tone: "clear", title: "未发现阻断性缺口", detail: "仍需人工确认主体、报告年度和事件相关性。" };
}

export function metricLabel(code: DashboardReviewTask["metricCode"]) { return code.replace("EAA_ESGSI", "E-AA-ESGSI"); }
function decisionLabel(value?: ReviewRecord["humanDecision"]) { return value ? ({ confirm: "已确认信号", reject: "已驳回信号", partial: "部分相关", insufficient: "证据不足" } as const)[value] : "等待明确选择"; }
