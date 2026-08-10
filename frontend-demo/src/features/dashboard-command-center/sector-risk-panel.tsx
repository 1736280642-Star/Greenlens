"use client";

import { CommandPanelHeading } from "./panel-heading";
import { IndustryRiskHeatmap } from "./industry-risk-heatmap";
import { RedFlagQuality } from "./red-flag-quality";
import type { DashboardCommandCenterData, DashboardTriadCode } from "@/types";

/**
 * Combined Sector Risk panel (design spec §13): Sector Heatmap on the left
 * (~65%) and Red Flag statistics on the right (~35%), sharing a single
 * panel frame. Replaces the previous layout where heatmap and red flags
 * were two independent panels in the bottom row.
 */
export function SectorRiskPanel({
  industryRisk,
  selectedFactor,
  onSelectIndustry,
  flags,
  quality,
  kpis,
  onExpandHeatmap,
  onExpandAudit,
}: {
  industryRisk: DashboardCommandCenterData["industryRisk"];
  selectedFactor: DashboardTriadCode | null;
  onSelectIndustry: (industry: string) => void;
  flags: DashboardCommandCenterData["redFlagDistribution"];
  quality: DashboardCommandCenterData["quality"];
  kpis: DashboardCommandCenterData["kpis"];
  onExpandHeatmap: () => void;
  onExpandAudit: () => void;
}) {
  return (
    <section className="cc-panel cc-sector-panel">
      <CommandPanelHeading eyebrow="SECTOR × FLAGS" title="行业风险热力 + 红旗统计" />
      <div className="cc-sector-body">
        <div className="cc-sector-heatmap">
          <IndustryRiskHeatmap
            data={industryRisk}
            selectedFactor={selectedFactor}
            onSelectIndustry={onSelectIndustry}
            onExpand={onExpandHeatmap}
            embedded
          />
        </div>
        <div className="cc-sector-flags">
          <RedFlagQuality
            flags={flags}
            quality={quality}
            kpis={kpis}
            onExpand={onExpandAudit}
            embedded
          />
        </div>
      </div>
    </section>
  );
}
