/**
 * Post-conversion bootstrap: records the marker the election engine
 * picks up to fire the first post-conversion snap election with the
 * legacy seat reservation applied to the former ruling party.
 *
 * For `parliamentaryRepublic` and `presidential` targets the marker
 * carries the same shape — the election engine branches on the new
 * `governmentType` (already flipped on countryState by the caller) to
 * decide whether to also schedule a presidential race.
 *
 * The election engine consumer reads `pendingPostConversionElection`
 * on the next election turn and clears the field. The marker itself
 * lives on countryState (not regimeEscalation) so the read path is the
 * same one the election engine already uses for `opsVoteMultipliers`.
 */
import type { Db } from "mongodb";
import type { CountryId, GovernmentType } from "@/lib/constants/countries";
import { getCountryState, updateCountryState } from "@/lib/countryState";

export interface ConversionBootstrapInputs {
  targetSystem: GovernmentType;
  legacyReservation: number;
  path: "voluntary" | "forced";
  /** Forced path only: vote-share penalty on the former ruling party. */
  forcedVoteSharePenalty?: number;
  /** Turn the snap election should kick off. */
  electionAtTurn: number;
}

/**
 * Write the post-conversion snap-election marker. Pure side-effect on
 * countryState; the election engine is the consumer. Reads the
 * current `rulingPartyId` so the legacy reservation has somewhere to
 * land — the conversion flip set this to null by the time the
 * election engine sees the marker, so the marker captures it ahead of
 * the flip.
 */
export async function bootstrapNewSystem(
  db: Db,
  countryId: CountryId,
  inputs: ConversionBootstrapInputs
): Promise<void> {
  const state = await getCountryState(db, countryId);
  const formerRulingPartyId = state.rulingPartyId;

  await updateCountryState(db, countryId, {
    pendingPostConversionElection: {
      atTurn: inputs.electionAtTurn,
      legacyReservation: inputs.legacyReservation,
      formerRulingPartyId,
      forcedVoteSharePenalty: inputs.forcedVoteSharePenalty,
      path: inputs.path,
    },
  });
}
