import type { DashboardResearchView } from "@/types";

const views: Array<{ value: DashboardResearchView; label: string; shortLabel: string }> = [
  { value: "primary", label: "主分析 · EAS / EAA-ESI", shortLabel: "主分析" },
  { value: "gsi", label: "稳健性检验 · GSI", shortLabel: "GSI" },
  { value: "red_flags", label: "稳健性检验 · Red flag", shortLabel: "RED FLAG" },
];

export function ResearchViewSwitch({ value, onChange }: { value: DashboardResearchView; onChange: (value: DashboardResearchView) => void }) {
  return <div className="cc-research-view-switch" role="group" aria-label="指标体系">
    {views.map((view) => <button
      type="button"
      key={view.value}
      className={value === view.value ? "active" : ""}
      aria-pressed={value === view.value}
      aria-label={view.label}
      title={view.label}
      onClick={() => onChange(view.value)}
    >{view.shortLabel}</button>)}
  </div>;
}
