import { hashToUint32 } from "@/lib/events/substrate/rng";

export { DEMOCRATIC_HEALTH_METRIC_IDS } from "@/lib/governanceStyle/score";
export { applyCivilLibertiesDelta } from "@/lib/politicalMetrics/civilLiberties";

export const HIGH_TENSION_EVENT_KINDS = new Set([
  "worldEvents.panicBuying",
  "worldEvents.bankRun",
  "worldEvents.civilDefenseFever",
  "worldEvents.warScareProtests",
]);

export const HIGH_TENSION_SHARED_LEDGER_KIND = "worldEvents.highTensionShared";
export const HIGH_TENSION_STAGGER_MIN_TURNS = 3;
export const HIGH_TENSION_STAGGER_MAX_TURNS = 6;

export function isHighTensionSocietyEvent(kind: string): boolean {
  return HIGH_TENSION_EVENT_KINDS.has(kind);
}

/**
 * One crisis lands every three to six turns before mitigation. Emergency
 * measures add at most four turns, keeping the sequence common while giving
 * governments a meaningful way to buy breathing room.
 */
export function highTensionSharedGapTurns(
  countryId: string,
  lastFiredTurn: number,
  mitigationPct: number
): number {
  const span = HIGH_TENSION_STAGGER_MAX_TURNS - HIGH_TENSION_STAGGER_MIN_TURNS + 1;
  const base =
    HIGH_TENSION_STAGGER_MIN_TURNS +
    (hashToUint32(`highTensionStagger:${countryId}:${lastFiredTurn}`) % span);
  const mitigationTurns = Math.min(4, Math.floor(Math.max(0, mitigationPct) / 10));
  return base + mitigationTurns;
}

export function isHighTensionSharedDue(
  currentTurn: number,
  countryId: string,
  lastFiredTurn: number | undefined,
  mitigationPct: number
): boolean {
  if (lastFiredTurn == null) return true;
  return (
    currentTurn >=
    lastFiredTurn + highTensionSharedGapTurns(countryId, lastFiredTurn, mitigationPct)
  );
}
