import type { MapOverviewResponse } from "@/lib/map/overviewTypes";
import type { CorporationType } from "@/lib/constants/corporations";

export type LeanAxis = "economic" | "social" | "display";

export function interpolateGreen(t: number): string {
  const r = Math.round(220 - t * 160);
  const g = Math.round(240 - t * 80);
  const b = Math.round(200 - t * 160);
  return `rgb(${r},${g},${b})`;
}

export const NATION_COLORS: Record<string, string> = {
  ENG: "#4f7ac7",
  SCO: "#1a5fa8",
  WAL: "#2a7c3e",
  NIR: "#7a4ba8",
};

const SECTOR_MAP_COLORS: Record<CorporationType, string> = {
  financial: "#10b981",
  media: "#3b82f6",
  manufacturing: "#f97316",
  chemical_industries: "#22c55e",
  healthcare: "#f43f5e",
  retail: "#8b5cf6",
  automobiles: "#0ea5e9",
  technology: "#06b6d4",
  energy: "#eab308",
  agriculture: "#84cc16",
  real_estate: "#f59e0b",
  construction: "#fb923c",
  defense: "#64748b",
  telecommunications: "#6366f1",
  entertainment: "#ec4899",
  logistics: "#78716c",
  extraction: "#737373",
};

export function sectorSpecializationMapEntry(
  id: string,
  name: string,
  mapData: MapOverviewResponse | null
): { color: string; label: string; tooltip: string[] } {
  const spec = mapData?.sectorSpecializations?.[id];
  if (!spec) {
    return { color: "#334155", label: name, tooltip: [name, "No sector bonus seeded"] };
  }
  return {
    color: SECTOR_MAP_COLORS[spec.primary] ?? "#334155",
    label: spec.primaryLabel,
    tooltip: spec.tooltip ?? [
      name,
      `Primary: ${spec.primaryLabel} (+10pp)`,
      `Secondary: ${spec.secondaryLabel} (+5pp)`,
    ],
  };
}
