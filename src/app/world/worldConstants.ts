import { CDN_GEO } from "@/lib/images/cdnUrls";

export const WORLD_GEO_URL = CDN_GEO.worldCountries;

export const SVG_W = 800;
export const SVG_H = 460;
export const TRANSLATE: [number, number] = [SVG_W / 2, SVG_H / 2];
export const ORTHO_SCALE = 190;
/** Compact globe for the marketing landing page (same projection stack as /world, smaller viewBox). */
export const LANDING_SVG_W = 640;
export const LANDING_SVG_H = 368;
export const LANDING_TRANSLATE: [number, number] = [LANDING_SVG_W / 2, LANDING_SVG_H / 2];
export const LANDING_ORTHO_SCALE = 152;
export const ANIM_DURATION = 1200;

export const MAP_COLORS = {
  active: "var(--success-muted)",
  beta: "var(--warning-muted)",
  planned: "var(--primary-dark)",
  /** Registered but not playable: browsable read-only. */
  econOnly: "rgba(59, 130, 246, 0.5)",
  default: "var(--card-elevated)",
  hover: "var(--primary)",
  stroke: "var(--card-border)",
  strokeActive: "var(--foreground)",
  tierFullAutonomous: "rgba(56, 189, 248, 0.78)",
  tierSphereMacro: "rgba(251, 191, 36, 0.78)",
  tierHistoricalPresence: "rgba(148, 163, 184, 0.68)",
  tierUnclassified: "rgba(239, 68, 68, 0.48)",
} as const;

export function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
