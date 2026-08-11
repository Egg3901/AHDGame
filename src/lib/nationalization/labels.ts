// Human-readable display labels for nationalization enum/code fields. Shared by
// every NatCorp UI surface so codes like "seizure" / "executive" / "npc" never
// render raw. Pure data — safe to import from client components.
import type { CompensationTier, NationalizationPath } from "./constants";

/** Compensation tier → display label. */
export const TIER_LABEL: Record<CompensationTier, string> = {
  fair: "Fair value",
  discounted: "Discounted",
  seizure: "Seizure",
};

/** Nationalization path (how the taking was authorized) → display label. */
export const PATH_LABEL: Record<NationalizationPath, string> = {
  executive: "Executive",
  legislative: "Legislative",
  supermajority: "Supermajority",
};

/** Register entry kind → display label. */
export const TAKING_KIND_LABEL: Record<
  "nationalize_whole" | "nationalize_sector" | "privatize_ipo" | "privatize_auction",
  string
> = {
  nationalize_whole: "Nationalized — whole corp",
  nationalize_sector: "Nationalized — sector",
  privatize_ipo: "Privatized — IPO",
  privatize_auction: "Privatized — auction",
};

/** A ledger kind is a privatization (divestiture) rather than a taking. */
export function isPrivatizationKind(kind: string): boolean {
  return kind === "privatize_ipo" || kind === "privatize_auction";
}

/** Owner kind → display label. */
export const OWNER_LABEL: Record<"player" | "npc", string> = {
  player: "Player",
  npc: "NPC",
};

/** Eligibility-trigger code → display label. */
export const TRIGGER_LABEL: Record<string, string> = {
  npc: "NPC-owned",
  unowned: "Unowned",
  distress: "Financial distress",
  monopoly: "Monopoly",
  strategic: "Strategic sector",
  supermajority: "Supermajority",
};

/** Map a list of trigger codes to a readable, comma-joined string ("—" if none). */
export function triggerLabels(triggers: string[]): string {
  if (!triggers || triggers.length === 0) return "—";
  return triggers.map((t) => TRIGGER_LABEL[t] ?? t).join(", ");
}

/**
 * Readable eligibility reasons beyond bare ownership — the `npc`/`unowned`
 * triggers just restate ownerKind, so they are dropped to avoid "NPC · NPC".
 * Returns "" when nothing meaningful remains.
 */
export function eligibilityReasons(triggers: string[]): string {
  return triggers
    .filter((t) => t !== "npc" && t !== "unowned")
    .map((t) => TRIGGER_LABEL[t] ?? t)
    .join(", ");
}
