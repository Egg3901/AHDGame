import type { Db } from "mongodb";
import type { ElectionCandidate } from "@/lib/db/types";
import {
  buildFieldOfficeMultiplier,
  loadFieldOfficesForElection,
} from "@/lib/campaigns/fieldOffices/engine";
import { campaignStrengthLookupKey } from "@/lib/campaigns/suspendEndorseLifecycle";

/** `(electionCandidateId, stateId) → vote multiplier` from a race's field offices. */
export type PrimaryFieldOfficeLookup = (electionCandidateId: string, stateId: string) => number;

/**
 * Field offices in a presidential primary: a candidate's offices in a state
 * lift their vote there, exactly as in the general (presidentialElectionEngine).
 * Offices are keyed by the campaign's candidate (character or NPP id), so this
 * maps each election-candidate row to that key. Undefined when no candidate in
 * the race has an office, so callers skip the per-candidate work.
 */
export async function loadPrimaryFieldOffices(
  db: Db,
  election: { _id: { toString(): string }; countryId?: string | null },
  candidates: readonly Pick<ElectionCandidate, "_id" | "isNPP" | "nppId" | "characterId">[],
  currentTurn: number
): Promise<PrimaryFieldOfficeLookup | undefined> {
  const multiplier = buildFieldOfficeMultiplier(
    await loadFieldOfficesForElection(db, election._id),
    election.countryId ?? "US",
    currentTurn
  );
  if (!multiplier) return undefined;
  const keyById = new Map(candidates.map((c) => [c._id.toString(), campaignStrengthLookupKey(c)]));
  return (electionCandidateId, stateId) => {
    const key = keyById.get(electionCandidateId);
    return key ? multiplier(key, stateId) : 1;
  };
}
