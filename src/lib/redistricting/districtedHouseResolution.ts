import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { CongressionalDistrict } from "@/lib/db/types/congressionalDistrict";
import type { PoliticalParty } from "@/lib/db/types";
import { getPartyPool, type Pool } from "./pools";
import {
  computePartyBaselines,
  computePartySeatQuotas,
  assignPartiesToDistrictsByQuota,
  assignDistrictsToNominees,
} from "./districtedResolution";
import { buildNomineesByParty, buildSeatResult } from "./districtedSeatResult";
import { getMultiSeatMinShare } from "@/lib/turn/election/seatAllocation";

export interface DistrictedArgs {
  countryId: string;
  stateId: string;
  candidateVotes: Record<string, number>;
  candidateParty: Record<string, string>;
  candidateCharacterId: Record<string, string | null>;
  /** NPP holder id per candidate; set for isNPP candidates (id in `npps`).
   *  Mutually exclusive with candidateCharacterId for a given candidate. */
  candidateNppId?: Record<string, string | null>;
  primaryShares: Record<string, number> | null;
  districtBoosts?: Record<string, Record<string, number>>;
  now: Date;
  /**
   * Stamp the computed holders onto the `congressionalDistricts` docs.
   *
   * OFF by default, and only the turn resolver may turn it on. This function
   * doubles as the live "Projected Seats" projection in `enrichElection`, which
   * runs on every House race page view: with persistence unconditional, opening
   * a live race rewrote that state's sitting members from an in-progress tally.
   * The projection path also has no NPP id map, so it wrote `npps` ids into
   * `holderCharacterId` and every NPP-held seat rendered unheld (#2906 again).
   */
  persist?: boolean;
}

export interface SeatResult {
  isMultiSeat: boolean;
  authoritativeSeats: number;
  seatsEstimate: Record<string, number>;
  winners: [string, number][];
  losers: string[];
}

/**
 * Resolve a US House election per-district by shifting the statewide tally by
 * each district's square lean. Returns null when the state's congressionalDistricts
 * docs are absent (caller falls back to legacy allocateSeats). Pure unless
 * `persist` is set — see {@link DistrictedArgs.persist}.
 */
export async function districtedHouseResolution(
  db: Db,
  args: DistrictedArgs
): Promise<SeatResult | null> {
  const docs = (await db
    .collection<CongressionalDistrict>("congressionalDistricts")
    .find({ countryId: args.countryId, stateId: args.stateId } as Partial<CongressionalDistrict>)
    .toArray()) as CongressionalDistrict[];
  if (docs.length === 0) return null;

  // Build a party→pool lookup keyed by the identifier forms candidate.party may use.
  const parties = (await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: args.countryId } as Partial<PoliticalParty>)
    .toArray()) as PoliticalParty[];
  const poolByKey = new Map<string, Pool>();
  for (const p of parties) {
    const pool = getPartyPool({
      economicPosition: p.economicPosition,
      pool: (p as { pool?: Pool }).pool,
    });
    poolByKey.set(String(p.sequentialId), pool);
    poolByKey.set(String(p._id), pool);
    if (p.abbreviation) poolByKey.set(p.abbreviation.toLowerCase(), pool);
    if (p.name) poolByKey.set(p.name.toLowerCase(), pool);
  }
  const partyPool: Record<string, Pool> = {};
  for (const party of new Set(Object.values(args.candidateParty))) {
    partyPool[party] = poolByKey.get(String(party)) ?? poolByKey.get(party.toLowerCase()) ?? "grey";
  }

  const baselines = computePartyBaselines(args.candidateVotes, args.candidateParty);

  // Pass 1: proportional party seat quotas from the statewide vote, then place
  // each party's quota into the districts where it is strongest (lean + boost).
  // Quotas are proportional so a statewide plurality — or a lean-invariant
  // centrist party — can no longer sweep every district; gerrymandering shifts
  // WHICH districts each party holds, not HOW MANY. (ticket 926)
  const quotas = computePartySeatQuotas(baselines, docs.length, getMultiSeatMinShare("house"));
  const districtWinners = assignPartiesToDistrictsByQuota(
    docs.map((d) => ({ index: d.index, netLean: d.netLean })),
    baselines,
    partyPool,
    quotas,
    args.districtBoosts
  );

  // Pass 2: assign nominees to won districts by primary share.
  const nomineesByParty = buildNomineesByParty(
    args.candidateParty,
    args.candidateVotes,
    args.primaryShares
  );
  const assignment = assignDistrictsToNominees(districtWinners, nomineesByParty);

  // Stamp holders onto the district docs. Resolution only — see `persist`.
  const docByIndex = new Map(docs.map((d) => [d.index, d]));
  for (const [index, candidateId] of args.persist ? assignment : []) {
    const d = docByIndex.get(index);
    if (!d) continue;
    const nppIdRaw = args.candidateNppId?.[candidateId] ?? null;
    // NPP winners resolve against the `npps` collection, not `characters`, so
    // stamp holderNppId and leave holderCharacterId null (and vice versa).
    const charIdRaw = nppIdRaw ? null : (args.candidateCharacterId[candidateId] ?? null);
    await db.collection<CongressionalDistrict>("congressionalDistricts").updateOne(
      { _id: d._id },
      {
        $set: {
          holderCharacterId: charIdRaw ? new ObjectId(charIdRaw) : null,
          holderNppId: nppIdRaw ? new ObjectId(nppIdRaw) : null,
          holderParty: args.candidateParty[candidateId] ?? null,
          updatedAt: args.now,
        },
      }
    );
  }

  return buildSeatResult(assignment, Object.keys(args.candidateVotes), docs.length);
}
