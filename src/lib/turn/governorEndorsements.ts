import type { Db, ObjectId } from "mongodb";
import type { GovernorEndorsement, ElectedOfficial } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getRegionalExecutiveOfficeKey } from "@/lib/constants/countries";
import { withdrawEndorsement } from "@/lib/governorOffice/endorsements/withdrawEndorsement";
import { preloadEndorsementTargets } from "./endorsements/preloadEndorsementTargets";

/**
 * Turn phase: auto-withdraw governor endorsements whose conditions no longer hold.
 *   - election no longer active → election_ended
 *   - candidate no longer active → candidate_inactive
 *   - governor no longer in office → governor_left_office
 *
 * Must run BEFORE processCampaignTurn so withdrawals are observed by the
 * endorsement-count aggregation there.
 *
 * Reads are batched up front (#575): elections, candidates and the regional
 * executives holding office all resolve before the loop, so the phase costs a
 * fixed handful of queries instead of three per endorsement.
 */
export async function processGovernorEndorsements(
  db: Db
): Promise<{ withdrawn: number; byReason: Record<string, number> }> {
  const active = await db
    .collection<GovernorEndorsement>("governorEndorsements")
    .find({ isActive: true })
    .toArray();
  let withdrawn = 0;
  const byReason: Record<string, number> = {};
  function tally(reason: NonNullable<GovernorEndorsement["withdrawnReason"]>) {
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    withdrawn++;
  }

  const [{ electionStatus, candidateStatus }, sittingRegionalExecutives] = await Promise.all([
    preloadEndorsementTargets(db, active),
    loadSittingRegionalExecutives(db, active),
  ]);

  for (const e of active) {
    if (!e._id) continue;
    if (electionStatus.get(e.electionId.toString()) !== "active") {
      await withdrawEndorsement(db, e._id, "election_ended");
      tally("election_ended");
      continue;
    }
    if (candidateStatus.get(e.candidateId.toString()) !== "active") {
      await withdrawEndorsement(db, e._id, "candidate_inactive");
      tally("candidate_inactive");
      continue;
    }
    if (
      !sittingRegionalExecutives.has(holderKey(e.countryId, e.stateId, e.endorsedByCharacterId))
    ) {
      await withdrawEndorsement(db, e._id, "governor_left_office");
      tally("governor_left_office");
    }
  }

  return { withdrawn, byReason };
}

function holderKey(countryId: CountryId, stateId: string, characterId: ObjectId): string {
  return `${countryId}:${stateId}:${characterId.toString()}`;
}

/**
 * The (country, state, character) triples that currently hold their country's
 * regional-executive office, for every endorsement in the batch.
 *
 * One query over an `$or` of per-country clauses, each narrowed to the states
 * actually referenced — so the result is bounded by the endorsements being
 * checked rather than by every governor in the world. Membership in the
 * returned set is equivalent to the per-endorsement `findOne` it replaces:
 * that query matched on exactly these four fields, so a miss meant no holder.
 */
async function loadSittingRegionalExecutives(
  db: Db,
  endorsements: ReadonlyArray<GovernorEndorsement>
): Promise<Set<string>> {
  const held = new Set<string>();
  if (endorsements.length === 0) return held;

  const statesByCountry = new Map<CountryId, Set<string>>();
  for (const e of endorsements) {
    let states = statesByCountry.get(e.countryId);
    if (!states) statesByCountry.set(e.countryId, (states = new Set()));
    states.add(e.stateId);
  }

  const clauses = [...statesByCountry].map(([countryId, states]) => ({
    countryId,
    officeType: getRegionalExecutiveOfficeKey(countryId),
    state: { $in: [...states] },
  }));

  const holders = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ $or: clauses }, { projection: { countryId: 1, state: 1, characterId: 1 } })
    .toArray();

  for (const h of holders) {
    if (!h.countryId || !h.state || !h.characterId) continue;
    held.add(holderKey(h.countryId, h.state, h.characterId));
  }
  return held;
}
