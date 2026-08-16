/**
 * Pull banned / unrecognised-party candidates out of live OPS races.
 *
 * Player-created parties in a one-party state are born `regimeStatus: "banned"`
 * and the filing gates (enter route, NPP auto-entry) already refuse them. Two
 * holes still let them appear on the ballot:
 *
 *   1. Slate filing and auto-reelection skipped the OPS gates (fixed at those
 *      call sites). Candidates already filed stay `status: "active"` until
 *      something withdraws them.
 *   2. Parties banned at creation never run `processBanPartyEffects`, so there
 *      is no one-shot cleanup of in-flight candidacies.
 *
 * This sweep runs each turn before primary resolution / vote accumulation so
 * a banned-party NPP cannot keep collecting votes (ticket #1119: MSPSU on the
 * KAZ republic Supreme Soviet). Independents are treated the same as banned.
 */
import type { Db } from "mongodb";
import type { Election, ElectionCandidate, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryState } from "@/lib/countryState";
import {
  canFieldExecutiveCandidate,
  canFieldLegislativeCandidate,
} from "@/lib/turn/onePartyConstraints";
import { removeWithdrawnCandidateFromTally } from "@/lib/electionEngine/tallyCleaner";

export async function withdrawOpsIneligibleCandidacies(
  db: Db,
  now: Date
): Promise<{ withdrawn: number }> {
  const liveElections = await db
    .collection<Election>("elections")
    .find({ status: { $in: ["upcoming", "active", "completed"] } })
    .toArray();
  if (liveElections.length === 0) return { withdrawn: 0 };

  const electionById = new Map(
    liveElections.map((election) => [election._id.toString(), election])
  );
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({
      electionId: { $in: liveElections.map((election) => election._id) },
      status: "active",
    })
    .toArray();
  if (candidates.length === 0) return { withdrawn: 0 };

  const countryIds = [
    ...new Set(liveElections.map((election) => (election.countryId ?? "US") as CountryId)),
  ];
  const opsConfigByCountry = new Map<CountryId, { governmentType: "onePartyState" }>();
  for (const countryId of countryIds) {
    const runtime = await getCountryState(db, countryId);
    if (runtime.governmentType === "onePartyState") {
      opsConfigByCountry.set(countryId, { governmentType: "onePartyState" });
    }
  }
  if (opsConfigByCountry.size === 0) return { withdrawn: 0 };

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: { $in: [...opsConfigByCountry.keys()] } })
    .toArray();
  const partyByKey = new Map<string, Pick<PoliticalParty, "regimeStatus">>();
  for (const party of parties) {
    partyByKey.set(`${party.countryId ?? "US"}:${String(party.sequentialId)}`, party);
  }

  const toWithdraw: ElectionCandidate[] = [];
  for (const candidate of candidates) {
    const election = electionById.get(candidate.electionId.toString());
    if (!election) continue;
    const countryId = (election.countryId ?? candidate.countryId ?? "US") as CountryId;
    const config = opsConfigByCountry.get(countryId);
    if (!config) continue;

    const partyKey = `${countryId}:${candidate.party ?? ""}`;
    const party =
      candidate.party && candidate.party !== "independent"
        ? (partyByKey.get(partyKey) ?? null)
        : null;
    if (
      canFieldLegislativeCandidate(config, party) &&
      canFieldExecutiveCandidate(config, party, election.electionType)
    ) {
      continue;
    }
    toWithdraw.push(candidate);
  }

  if (toWithdraw.length === 0) return { withdrawn: 0 };

  const result = await db
    .collection<ElectionCandidate>("electionCandidates")
    .updateMany(
      { _id: { $in: toWithdraw.map((candidate) => candidate._id) } },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );

  for (const candidate of toWithdraw) {
    await removeWithdrawnCandidateFromTally(db, candidate.electionId, candidate._id.toString());
  }

  return { withdrawn: result.modifiedCount };
}
