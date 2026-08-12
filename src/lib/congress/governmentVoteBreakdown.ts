import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Character, ElectedOfficial, NPP, PoliticalParty } from "@/lib/db/types";
import { buildVotesByParty, type VoteByParty } from "@/lib/congress/billVoting";

export type { VoteByParty };

/**
 * Resolve lower-chamber voter keys (character ObjectId strings and `npp_${id}`)
 * to party slugs and seat weights. Used for PM appointment, no-confidence, and
 * US leadership elections.
 */
export async function buildVoterPartyAndWeightMaps(
  db: Db,
  countryId: CountryId,
  // A single chamber officeType, or several for joint-sitting votes (RU
  // head-of-state appointment spans both Supreme Soviet chambers).
  lowerChamberKey: string | string[],
  voteKeys: string[]
): Promise<{ voterPartyMap: Map<string, string>; weightMap: Map<string, number> }> {
  const voterPartyMap = new Map<string, string>();
  const weightMap = new Map<string, number>();

  if (voteKeys.length === 0) {
    return { voterPartyMap, weightMap };
  }

  const charIdStrs = voteKeys.filter((k) => ObjectId.isValid(k));
  const nppIdStrs = voteKeys
    .filter((k) => k.startsWith("npp_"))
    .map((k) => k.slice(4))
    .filter((id) => ObjectId.isValid(id));

  const charOids = charIdStrs.map((id) => new ObjectId(id));
  const nppOids = nppIdStrs.map((id) => new ObjectId(id));

  const [characters, npps] = await Promise.all([
    charOids.length > 0
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: charOids } })
          .project({ _id: 1, party: 1 })
          .toArray()
      : [],
    nppOids.length > 0
      ? db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppOids } })
          .project({ _id: 1, party: 1 })
          .toArray()
      : [],
  ]);

  for (const c of characters) {
    voterPartyMap.set(c._id.toString(), c.party ?? "independent");
  }
  for (const n of npps) {
    voterPartyMap.set(`npp_${n._id.toString()}`, n.party ?? "independent");
  }

  const orClauses: object[] = [];
  if (charOids.length > 0) {
    orClauses.push({ characterId: { $in: charOids } });
  }
  if (nppOids.length > 0) {
    orClauses.push({ nppId: { $in: nppOids }, isNPP: true });
  }

  const officials =
    orClauses.length > 0
      ? await db
          .collection<ElectedOfficial>("electedOfficials")
          .find({
            countryId,
            officeType: Array.isArray(lowerChamberKey) ? { $in: lowerChamberKey } : lowerChamberKey,
            $or: orClauses,
          })
          .project({ characterId: 1, nppId: 1, isNPP: 1, seatsHeld: 1 })
          .toArray()
      : [];

  for (const o of officials) {
    const w = o.seatsHeld ?? 1;
    if (o.characterId) {
      weightMap.set(o.characterId.toString(), w);
    }
    if (o.nppId && o.isNPP) {
      weightMap.set(`npp_${o.nppId.toString()}`, w);
    }
  }

  return { voterPartyMap, weightMap };
}

export interface ParliamentaryGovernmentTally {
  votesFor: number;
  votesAgainst: number;
  voteByParty: VoteByParty[];
}

/**
 * Single source of truth for a PM-appointment / no-confidence tally. Recomputes
 * the seat-weighted aye/nay totals AND the per-party breakdown from the same
 * scoped votes map, so the headline number and the breakdown can never diverge.
 *
 * A vote-map key absent from `weightMap` holds no current seat in the country's
 * lower chamber (a de-seated member or a cross-country leak) and is excluded —
 * this caps any total at the chamber's current seat count.
 */
export async function computeParliamentaryGovernmentTally(
  db: Db,
  countryId: CountryId,
  // Single chamber officeType, or several for joint-sitting votes (RU HoS).
  lowerChamberKey: string | string[],
  votes: Record<string, "aye" | "nay"> | undefined
): Promise<ParliamentaryGovernmentTally> {
  if (!votes || Object.keys(votes).length === 0) {
    return { votesFor: 0, votesAgainst: 0, voteByParty: [] };
  }

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId })
    .toArray();
  const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));

  const keys = Object.keys(votes);
  const { voterPartyMap, weightMap } = await buildVoterPartyAndWeightMaps(
    db,
    countryId,
    lowerChamberKey,
    keys
  );

  const asBillVotes: Record<string, "for" | "against" | "abstain"> = {};
  for (const [k, v] of Object.entries(votes)) {
    if (!weightMap.has(k)) continue; // stale / cross-country voter — excluded
    asBillVotes[k] = v === "aye" ? "for" : "against";
  }

  const voteByParty = buildVotesByParty(asBillVotes, voterPartyMap, partyMap, weightMap);
  let votesFor = 0;
  let votesAgainst = 0;
  for (const p of voteByParty) {
    votesFor += p.for;
    votesAgainst += p.against;
  }
  return { votesFor, votesAgainst, voteByParty };
}

export interface CabinetNominationTally {
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  houseVotesFor?: number;
  houseVotesAgainst?: number;
  houseVotesAbstain?: number;
}

/**
 * Seat-weighted cabinet-nomination tally (US Senate advice & consent). Votes
 * use "for" | "against" | "abstain". Keys with no current senate seat in the
 * given country are excluded, so the total can never exceed the chamber size
 * and cross-country / de-seated NPP keys carry no weight.
 *
 * For VP nominations, also computes House tally if houseVotes are provided.
 */
export async function computeCabinetNominationTally(
  db: Db,
  countryId: CountryId,
  votes: Record<string, "for" | "against" | "abstain"> | undefined,
  houseVotes?: Record<string, "for" | "against" | "abstain"> | undefined
): Promise<CabinetNominationTally> {
  if (!votes || Object.keys(votes).length === 0) {
    return { votesFor: 0, votesAgainst: 0, votesAbstain: 0 };
  }
  const keys = Object.keys(votes);
  const { weightMap } = await buildVoterPartyAndWeightMaps(db, countryId, "senate", keys);
  let votesFor = 0;
  let votesAgainst = 0;
  let votesAbstain = 0;
  for (const [k, v] of Object.entries(votes)) {
    const w = weightMap.get(k);
    if (w == null) continue; // stale / cross-country voter — excluded
    if (v === "for") votesFor += w;
    else if (v === "against") votesAgainst += w;
    else votesAbstain += w;
  }

  // House tally for VP nominations
  let houseVotesFor: number | undefined;
  let houseVotesAgainst: number | undefined;
  let houseVotesAbstain: number | undefined;
  if (houseVotes && Object.keys(houseVotes).length > 0) {
    const houseKeys = Object.keys(houseVotes);
    const { weightMap: houseWeightMap } = await buildVoterPartyAndWeightMaps(
      db,
      countryId,
      "house",
      houseKeys
    );
    houseVotesFor = 0;
    houseVotesAgainst = 0;
    houseVotesAbstain = 0;
    for (const [k, v] of Object.entries(houseVotes)) {
      const w = houseWeightMap.get(k);
      if (w == null) continue;
      if (v === "for") houseVotesFor += w;
      else if (v === "against") houseVotesAgainst += w;
      else houseVotesAbstain += w;
    }
  }

  return {
    votesFor,
    votesAgainst,
    votesAbstain,
    houseVotesFor,
    houseVotesAgainst,
    houseVotesAbstain,
  };
}

/**
 * Single source of truth for a US House / Senate leadership election tally
 * (Speaker, Majority/Minority Leader, etc.). Tallies are **seat-weighted** via
 * `seatsHeld` so multi-seat members (redistricting / aggregated NPP blocs)
 * contribute their full chamber weight — matching bill votes and the "N seats ·
 * plurality wins" leadership UI.
 *
 * Votes are scoped to current chamber seat-holders: a key absent from the seat
 * map is a de-seated or cross-country voter and is excluded.
 */
export async function computeCongressLeadershipTally(
  db: Db,
  officeType: "house" | "senate",
  votes: Record<string, "for" | "against"> | undefined
): Promise<ParliamentaryGovernmentTally> {
  if (!votes || Object.keys(votes).length === 0) {
    return { votesFor: 0, votesAgainst: 0, voteByParty: [] };
  }

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: "US" })
    .toArray();
  const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));

  const keys = Object.keys(votes);
  const { voterPartyMap, weightMap } = await buildVoterPartyAndWeightMaps(
    db,
    "US",
    officeType,
    keys
  );

  const scopedVotes: Record<string, "for" | "against" | "abstain"> = {};
  for (const [k, v] of Object.entries(votes)) {
    if (!weightMap.has(k)) continue; // stale / cross-country voter — excluded
    scopedVotes[k] = v;
  }

  const voteByParty = buildVotesByParty(scopedVotes, voterPartyMap, partyMap, weightMap);
  let votesFor = 0;
  let votesAgainst = 0;
  for (const p of voteByParty) {
    votesFor += p.for;
    votesAgainst += p.against;
  }
  return { votesFor, votesAgainst, voteByParty };
}
