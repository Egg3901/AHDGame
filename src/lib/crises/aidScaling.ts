import type { CrisisEffect } from "@/lib/db/types/crisis";
import { AID_MAX_PCT_GDP, AID_SENDER_APPROVAL_CAP } from "@/lib/constants/crises";

/** Recovery magnitudes at a full-cap pledge (partial reversal of disaster damage). */
const RECOVERY_INFRA_DAMAGE_AT_CAP = -0.04; // reduce infrastructure.damage (repair)
const RECOVERY_UNEMPLOYMENT_AT_CAP = -0.015; // reduce economy.unemployment (rebuilding jobs)

function effect(
  targetType: CrisisEffect["targetType"],
  metricCategory: string | null,
  metricField: string | null,
  value: number,
  label: string
): CrisisEffect {
  return {
    effectType: "flat",
    targetType,
    metricCategory,
    metricField,
    sectorType: null,
    strategyId: null,
    value,
    label,
  };
}

/**
 * Scale a slider pledge into its treasury cost and effects. The benefit scales
 * linearly with `pctGdp / AID_MAX_PCT_GDP`: recovery to the crisis scope
 * (partial reversal of infrastructure damage + unemployment the disaster
 * inflicted) and a diplomatic approval bump to the sender (capped at
 * AID_SENDER_APPROVAL_CAP). Pure — the caller persists `recoveryEffects` /
 * `senderEffects` for exact reversal on a failed vote.
 */
export function computeAidOutcome(
  pctGdp: number,
  senderGdp: number
): { amountLocal: number; recoveryEffects: CrisisEffect[]; senderEffects: CrisisEffect[] } {
  const clampedPct = Math.max(0, Math.min(AID_MAX_PCT_GDP, pctGdp));
  const amountLocal = Math.round(clampedPct * senderGdp);
  if (clampedPct <= 0 || amountLocal <= 0) {
    return { amountLocal: 0, recoveryEffects: [], senderEffects: [] };
  }
  const scale = clampedPct / AID_MAX_PCT_GDP; // 0..1

  const recoveryEffects: CrisisEffect[] = [
    effect(
      "metric",
      "infrastructure",
      "damage",
      RECOVERY_INFRA_DAMAGE_AT_CAP * scale,
      "Aid-funded reconstruction"
    ),
    effect(
      "metric",
      "economy",
      "unemployment",
      RECOVERY_UNEMPLOYMENT_AT_CAP * scale,
      "Aid-funded rehiring"
    ),
  ];
  const senderEffects: CrisisEffect[] = [
    effect(
      "approval",
      "government",
      "overall",
      AID_SENDER_APPROVAL_CAP * scale,
      "International goodwill"
    ),
  ];
  return { amountLocal, recoveryEffects, senderEffects };
}
