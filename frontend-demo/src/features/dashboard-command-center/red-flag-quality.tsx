import { AlertOctagon, DatabaseZap } from "lucide-react";
import { CommandPanelHeading } from "./panel-heading";
import { ACCENT_COLORS } from "./risk-palette";
import type { DashboardCommandCenterData, RedFlagCode } from "@/types";

const flagLabels: Record<RedFlagCode, string> = { HIGH_ESGSI: "ESGSI ↑", LOW_EASS: "EASS ↓", HIGH_IR: "IR ↑", HIGH_UPR: "UPR ↑" };

/** Derived flag rows (design spec §13): evidence-insufficiency and volatility
 * are not enum red flags but are derived from cohort signals so the dashboard
 * shows the full six-row flag list the spec requires. */
type DerivedFlag = { code: string; label: string; count: number };

function deriveExtraFlags(flags: DashboardCommandCenterData["redFlagDistribution"], quality: DashboardCommandCenterData["quality"], kpis: DashboardCommandCenterData["kpis"] | undefined): DerivedFlag[] {
  const insufficientEvidence = kpis?.insufficientEvidenceCount ?? quality.at(-1)?.selectedNLt10 ?? 0;
  // Volatility: proxy from year-target-not-found + duplicate groups (data freshness signals).
  const latest = quality.at(-1);
  const volatility = latest ? latest.titleTargetYearNotFound + latest.duplicateGroups : 0;
  return [
    { code: "INSUFFICIENT_EVIDENCE", label: "证据不足", count: insufficientEvidence },
    { code: "VOLATILITY", label: "异常波动", count: volatility },
  ];
}

export function RedFlagQuality({ flags, quality, kpis, expanded = false, onExpand, embedded = false }: {
  flags: DashboardCommandCenterData["redFlagDistribution"];
  quality: DashboardCommandCenterData["quality"];
  kpis?: DashboardCommandCenterData["kpis"];
  expanded?: boolean;
  onExpand?: () => void;
  embedded?: boolean;
}) {
  const latest = quality.at(-1);
  const extraFlags = deriveExtraFlags(flags, quality, kpis);
  const riskFlags = flags.map((item) => ({ label: flagLabels[item.code], count: item.count }));
  const qualityFlags = extraFlags.map((item) => ({ label: item.label, count: item.count }));
  const maxRiskFlag = Math.max(1, ...riskFlags.map((item) => item.count));
  const maxQualityFlag = Math.max(1, ...qualityFlags.map((item) => item.count));
  const qualityItems = latest ? [
    ["低句数", latest.selectedNLt10],
    ["重复报告", latest.duplicateGroups],
    ["年份异常", latest.titleTargetYearNotFound],
    ["代码恢复", latest.codeRecoveredFromCompany],
  ] as const : [];

  const body = (
    <div className="cc-audit-content">
      <div className="cc-audit-group">
        <span><AlertOctagon />风险红旗</span>
        {riskFlags.map((item) => (
          <div className="cc-audit-bar risk" key={item.label}>
            <label>{item.label}</label>
            <i><b style={{ width: `${item.count / maxRiskFlag * 100}%`, background: ACCENT_COLORS.coral }} /></i>
            <strong>{item.count}</strong>
          </div>
        ))}
      </div>
      <div className="cc-audit-group quality">
        <span><DatabaseZap />数据质量</span>
        {qualityFlags.map((item) => (
          <div className="cc-audit-bar quality" key={item.label}>
            <label>{item.label}</label>
            <i><b style={{ width: `${item.count / maxQualityFlag * 100}%` }} /></i>
            <strong>{item.count}</strong>
          </div>
        ))}
      </div>
      {!embedded && (
        <>
          <div className="cc-audit-divider" />
          <div className="cc-audit-group quality-detail"><span><DatabaseZap />质量明细 · {latest?.year ?? "—"}</span><div className="cc-quality-grid">{qualityItems.map(([label, value]) => <div key={label}><strong>{value}</strong><small>{label}</small></div>)}</div></div>
        </>
      )}
    </div>
  );

  if (embedded) {
    return <div className="cc-audit-embedded">{body}</div>;
  }
  return <section className={`cc-panel cc-audit-panel ${expanded ? "cc-panel-expanded" : ""}`}><CommandPanelHeading eyebrow="AUDIT" title="红旗与数据质量" detail={expanded ? "风险信号与数据质量分开计算" : undefined} onExpand={expanded ? undefined : onExpand} expandLabel="展开红旗与数据质量" />{body}</section>;
}
