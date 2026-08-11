/**
 * Thin write-adapters for the Phase-5 liberalization reform actions.
 *
 * Each helper isolates one side-effect on countryState (vote-multiplier
 * tier-down, honest-by-election flag) so the reform action handlers in
 * `reformActions.ts` stay declarative. Party-status writes
 * (`legalizeBannedParty`) already live in `partyEffectAdapters.ts` and
 * are re-exported here so callers only need one import.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { DEFAULT_OPS_VOTE_MULTIPLIERS, type OpsVoteMultipliers } from "@/lib/constants/countries";
import { getCountryState, updateCountryState } from "@/lib/countryState";

export { legalizeBannedParty } from "./partyEffectAdapters";

/**
 * Ladder of ruling-party multipliers, from the strongest (default OPS
 * weighting) down to fully equal weight. Each successful invocation of
 * `setRulingPartyVoteMultiplierTier(db, countryId, "down")` advances
 * one step toward `RULING_MULTIPLIER_FLOOR`.
 *
 * The ladder values are anchored to `DEFAULT_OPS_VOTE_MULTIPLIERS.ruling`
 * so a future tuning pass that changes the default automatically reseats
 * the top of the ladder. Sorted descending; the floor is the last entry.
 */
export const RULING_MULTIPLIER_LADDER = [
  DEFAULT_OPS_VOTE_MULTIPLIERS.ruling, // 3.0
  2.0,
  1.5,
  1.0,
] as const;

export const RULING_MULTIPLIER_FLOOR = RULING_MULTIPLIER_LADDER.at(-1)!;

/**
 * Step the ruling-party vote multiplier one rung down the ladder.
 * Throws when the country is already at the floor — the reform-action
 * handler is responsible for gating availability via the cooldown +
 * floor check, so reaching this with no headroom is a programmer
 * error.
 *
 * Leaves `approved`, `independent`, and `banned` multipliers untouched
 * — the reform is specifically about loosening ruling-party privilege,
 * not about granting banned parties a vote.
 */
export async function setRulingPartyVoteMultiplierTier(
  db: Db,
  countryId: CountryId,
  direction: "down"
): Promise<OpsVoteMultipliers> {
  if (direction !== "down") {
    throw new Error(`setRulingPartyVoteMultiplierTier: unsupported direction "${direction}"`);
  }
  const state = await getCountryState(db, countryId);
  const current = state.opsVoteMultipliers ?? { ...DEFAULT_OPS_VOTE_MULTIPLIERS };
  const next = nextLadderStepDown(current.ruling);
  if (next === null) {
    throw new Error(
      `setRulingPartyVoteMultiplierTier: ${countryId} ruling multiplier already at floor (${current.ruling})`
    );
  }
  const updated: OpsVoteMultipliers = { ...current, ruling: next };
  await updateCountryState(db, countryId, { opsVoteMultipliers: updated });
  return updated;
}

/**
 * Write the one-shot honest-by-election flag. The election engine
 * reads and clears it on the next election fired in this country —
 * see `electionEngine/candidateEnrichment.ts` for the consumer.
 */
export async function scheduleHonestByElection(
  db: Db,
  countryId: CountryId,
  opts: { atMultiplier: number }
): Promise<void> {
  await updateCountryState(db, countryId, {
    pendingHonestByElection: { atMultiplier: opts.atMultiplier },
  });
}

function nextLadderStepDown(currentRuling: number): number | null {
  // Find the highest ladder entry strictly less than the current value.
  for (const step of RULING_MULTIPLIER_LADDER) {
    if (step < currentRuling) return step;
  }
  return null;
}
