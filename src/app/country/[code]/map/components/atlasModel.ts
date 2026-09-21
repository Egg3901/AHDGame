import type { MapOfficeholder } from "@/lib/map/officeholderService";

export interface AtlasBar {
  id: string;
  label: string;
  value: number;
  color: string;
}

export function chamberBreakdown(holders: MapOfficeholder[], office: string): AtlasBar[] {
  const parties = new Map<string, AtlasBar>();
  for (const holder of holders) {
    if (holder.office !== office || holder.seats <= 0) continue;
    const row = parties.get(holder.party) ?? {
      id: holder.party,
      label: holder.partyName,
      value: 0,
      color: holder.color,
    };
    row.value += holder.seats;
    parties.set(holder.party, row);
  }
  return [...parties.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export const ATLAS_STORAGE_KEY = "ahd-us-atlas-v1";
export type AtlasView = "atlas" | "table" | "focus";
export function readAtlasPreferences(raw: string | null): {
  view: AtlasView;
  labels: boolean;
  charts: boolean;
} {
  const fallback = { view: "atlas" as const, labels: true, charts: true };
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return fallback;
    return {
      view: ["atlas", "table", "focus"].includes(value.view) ? value.view : "atlas",
      labels: typeof value.labels === "boolean" ? value.labels : true,
      charts: typeof value.charts === "boolean" ? value.charts : true,
    };
  } catch {
    return fallback;
  }
}
