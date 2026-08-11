/**
 * Presentation helpers for the State Ownership Concentration Index (SOCI). Pure;
 * turns a raw 0–100 value into a player-facing tier/label/danger-zone status
 * (the danger-zone flag derives from SOCI_DANGER_ZONE, the same knee the
 * escalation multiplier uses).
 */
import { SOCI_DANGER_ZONE } from "./constants";
import { clampConcentration } from "./concentration";

export type ConcentrationTier = "none" | "low" | "elevated" | "high";

export interface ConcentrationStatus {
  tier: ConcentrationTier;
  label: string;
  inDangerZone: boolean;
  note: string;
}

export function concentrationStatus(soci: number): ConcentrationStatus {
  const s = clampConcentration(soci);
  const inDangerZone = s > SOCI_DANGER_ZONE;
  let tier: ConcentrationTier;
  if (s <= 0) tier = "none";
  else if (!inDangerZone) tier = "low";
  else if (s < 65) tier = "elevated";
  else tier = "high";

  const label =
    tier === "none" ? "None" : tier === "low" ? "Low" : tier === "elevated" ? "Elevated" : "High";
  const note = inDangerZone
    ? `Past the ${SOCI_DANGER_ZONE}% danger zone — each further taking costs more confidence, approval, and SOE efficiency.`
    : `Below the ${SOCI_DANGER_ZONE}% danger zone — nationalization carries its base cost, no escalation yet.`;
  return { tier, label, inDangerZone, note };
}
