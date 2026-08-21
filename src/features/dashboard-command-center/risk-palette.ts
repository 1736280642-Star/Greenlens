/**
 * Unified risk palette for the CyberRisk Terminal dashboard.
 *
 * Per design spec §3: risk colors MUST NOT vary per chart. Every Hexbin cell,
 * Watchlist indicator, heatmap cell, red flag, trend line and waterfall bar
 * resolves risk semantics through this single source of truth.
 *
 * Tokens mirror the `--cc-risk-*` CSS variables so the DOM (React) layer and
 * the Canvas (ECharts) layer stay in lockstep.
 */

import type { RiskBand } from "@/types";

export const RISK_COLORS = {
  low: "#35CBA6",
  medium: "#F1B94B",
  high: "#FF6259",
  unavailable: "#50666B",
  selected: "#27D7E5",
} as const;

export const RISK_COLORS_ARRAY: readonly string[] = [
  RISK_COLORS.low,
  RISK_COLORS.medium,
  RISK_COLORS.high,
  RISK_COLORS.unavailable,
];

/** Hex with ~28% alpha for fills (cell backgrounds, area fills). */
export function riskFill(color: string, alpha = 0.28): string {
  // Accept #RRGGBB only; fall back to the color itself otherwise.
  if (color.length === 7 && color.startsWith("#")) {
    return `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
  }
  return color;
}

export function riskBandColor(band: RiskBand): string {
  switch (band) {
    case "high": return RISK_COLORS.high;
    case "medium": return RISK_COLORS.medium;
    case "low": return RISK_COLORS.low;
    case "unavailable": return RISK_COLORS.unavailable;
  }
}

/**
 * Five-step risk ramp (Deep Cyan → Aqua → Amber → Orange → Coral),
 * per design spec §13. Returns discrete stops suitable for ECharts `visualMap`
 * `inRange.color`.
 */
export const HEATMAP_RAMP: readonly string[] = [
  "#237E89", // Deep cyan (lowest risk)
  "#32BEAA", // Aqua
  "#F1BC48", // Amber
  "#EE8C45", // Orange
  "#F45F59", // Coral (highest risk)
];

/** Functional accent colors (non-risk) per design spec §3. */
export const ACCENT_COLORS = {
  cyan: "#27D7E5",
  aqua: "#35CBA6",
  blue: "#3C91F2",
  brand: "#38D996",
  amber: "#F1B94B",
  coral: "#FF6259",
  violet: "#9A7AF5",
} as const;
