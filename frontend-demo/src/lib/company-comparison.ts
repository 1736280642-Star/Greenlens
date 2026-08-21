import { getMetric, type CompanyYearRecord } from "@/types";

export type ActionComposition = {
  implemented: number;
  planning: number;
  indeterminate: number;
  total: number | null;
  basis: "evidence" | "model" | "unavailable";
};

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Score workbooks can contain EASS/IR before report evidence is linked.
 * EASS = implemented + alpha * planning and IR = indeterminate, so the
 * normalized composition can be recovered without inventing evidence counts.
 */
export function deriveActionComposition(company: CompanyYearRecord): ActionComposition {
  const actions = company.environmentalActions;
  if (actions.totalStatements > 0) {
    return {
      implemented: actions.implemented / actions.totalStatements,
      planning: actions.planning / actions.totalStatements,
      indeterminate: actions.indeterminate / actions.totalStatements,
      total: actions.totalStatements,
      basis: "evidence",
    };
  }

  const eass = getMetric(company, "EASS")?.rawValue;
  const ir = getMetric(company, "IR")?.rawValue;
  const alpha = company.scoringParameters.planningAlpha;
  if (eass == null || ir == null || alpha >= 1) {
    return { implemented: 0, planning: 0, indeterminate: 0, total: null, basis: "unavailable" };
  }

  const planning = (1 - ir - eass) / (1 - alpha);
  const implemented = 1 - ir - planning;
  const parts = [implemented, planning, ir];
  if (parts.some((value) => value < -0.015 || value > 1.015)) {
    return { implemented: 0, planning: 0, indeterminate: 0, total: null, basis: "unavailable" };
  }

  const normalized = parts.map(clamp);
  const total = normalized.reduce((sum, value) => sum + value, 0);
  if (!total) {
    return { implemented: 0, planning: 0, indeterminate: 0, total: null, basis: "unavailable" };
  }
  return {
    implemented: normalized[0] / total,
    planning: normalized[1] / total,
    indeterminate: normalized[2] / total,
    total: null,
    basis: "model",
  };
}
