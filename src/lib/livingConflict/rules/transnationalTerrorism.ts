/**
 * Counterterrorism responses depend on accumulated warning and attribution.
 * National emergency powers and troop commitments persist until that government
 * reverses them; coalition choices never enlist a silent country.
 */
import type { CrisisDecisionOption, GlobalResponseOutcome } from "@/lib/db/types/crisis";
import type { LivingConflictState } from "../types";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";

export const TERRORISM_KEY = "transnational_terrorism";
export const TERRORISM_SPENDING_KEY = "counterterrorism";
export type TerrorismSignal = Pick<
  LivingConflictState,
  "hasOpened" | "status" | "phaseLevel" | "tracks" | "campaign"
>;
const clamp = (v = 0) => (Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0);

export function terrorismOptionRefusal(
  state: TerrorismSignal,
  option: CrisisDecisionOption
): string | null {
  if (
    (option.responseScores?.intervention ?? 0) > 0 &&
    (state.tracks?.attributionConfidence ?? 0) < 45
  )
    return "Military action requires attribution confidence of at least 45.";
  return null;
}

/** Select consequences from the current plot, never from an anniversary alone. */
export function terrorismOutcomeId(state: TerrorismSignal, scores: Record<string, number>): string {
  const t = state.tracks ?? {};
  if ((scores.intelligence ?? 0) >= 8 && (scores.policing ?? 0) >= 5) return "plot_disrupted";
  if ((scores.policing ?? 0) >= 7 && (scores.restraint ?? 0) >= 3) return "policing_campaign";
  if (
    (scores.intervention ?? 0) >= 7 &&
    (scores.alliance ?? 0) >= 4 &&
    (t.attributionConfidence ?? 0) >= 45
  )
    return "military_intervention";
  if ((scores.coercion ?? 0) >= 7) return "coercive_backlash";
  if ((scores.drawdown ?? 0) >= 4) return "drawdown";
  if ((t.plotReadiness ?? 0) >= 70) {
    return (t.intelligenceCoverage ?? 0) >= 40 || (t.threatCapability ?? 0) < 60
      ? "limited_attack"
      : "attack_breakthrough";
  }
  return "threat_persists";
}

/** Only the responding nation changes its standing legal authority. */
export function terrorismEmergencyPowers(previous: number, optionId: string): number {
  return clamp(
    previous +
      (optionId === "emergency_powers" || optionId === "security_sweep"
        ? 20
        : optionId === "restore_law"
          ? -25
          : 0)
  );
}

export function terrorismAnnualCost(
  state: TerrorismSignal | null,
  countryId: string,
  gdp: number
): number {
  if (!state?.hasOpened || state.status === "closed" || !(gdp > 0) || !Number.isFinite(gdp))
    return 0;
  const troops = clamp(state.campaign?.countryMemory[countryId]?.militaryCommitment);
  const powers = clamp(state.tracks?.[`emergencyPowers:${countryId}`]);
  return Math.round(gdp * ((0.01 * troops) / 100 + (0.002 * powers) / 100));
}

export function terrorismPoliticalEffects(
  state: TerrorismSignal | null,
  countryId: string
): Partial<Record<PoliticalMetricId, number>> {
  if (!state?.hasOpened || state.status === "closed") return {};
  const powers = clamp(state.tracks?.[`emergencyPowers:${countryId}`]);
  const troops = clamp(state.campaign?.countryMemory[countryId]?.militaryCommitment);
  if (!powers && !troops) return {};
  return {
    "order.dueProcess": (-8 * powers) / 100,
    "governance.participation": (-3 * powers) / 100,
    "order.safety": (((-3 * troops) / 100) * clamp(state.tracks?.insurgency)) / 100,
  };
}

/** Map attack severity to a real victim's effects; separate ally choices remain local. */
export function terrorismAttackOutcome(
  outcome: GlobalResponseOutcome,
  candidates: string[],
  scoresByCountry: Record<string, number>
): { outcome: GlobalResponseOutcome; target: string | null } {
  if (!["limited_attack", "attack_breakthrough"].includes(outcome.outcomeId))
    return { outcome, target: null };
  const target =
    [...candidates].sort(
      (a, b) => (scoresByCountry[a] ?? 0) - (scoresByCountry[b] ?? 0) || a.localeCompare(b)
    )[0] ?? null;
  return { outcome, target };
}
