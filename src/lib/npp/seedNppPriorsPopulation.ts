/**
 * Founding-phase NPP population seeder - makes the pre-iteration "priors"
 * candidate pool independent of `historicalSeats.ts`.
 *
 * The problem this exists to fix
 * -------------------------------
 * `seedHistoricalOfficials(db, preset, "priors")` (seedHistorical.ts) creates
 * candidate NPPs by walking the AUTHORED `HistoricalSeat[]` roster
 * (`historicalSeats.ts`) for the active preset. That roster only covers a
 * handful of countries per era - under 1953-default: US, RU (Supreme Soviet),
 * CN, DD, and the Warsaw Pact six. `historicalSeats.ts` says outright (near
 * line 3161) that "the other democracies (UK/FR/IT/ES/SE/TR/DE/JP/BR/IE)
 * start with vacant legislatures - per-state 1953 results are a separate
 * task." Those countries' founding elections therefore spawn with NO
 * candidate pool at all: measured live, UK had 11 NPPs (all organic,
 * post-bootstrap) covering only 2 of its 6 seeded parties, and
 * AT/DE/FI/FR/GR/IT/SE/TR had exactly 1 NPP each against 5-33 live elections.
 * A founding election with no candidates cannot seat a chamber.
 *
 * The fix
 * -------
 * Run AFTER the founding election spawn sweep (`spawnFoundingElections`), so
 * every country's cycle-0 `elections` docs already exist with their real
 * `totalSeats`. Those docs - not `historicalSeats.ts` - are the "size of the
 * country's actual contestable legislature" signal: they are generated from
 * each country's own seat config/region data
 * (`COUNTRY_ELECTION_PHASES` → the country's `ensure*Elections` spawners,
 * which size chambers from `states.houseDistricts` / `stateSenateSeats` /
 * the `seats` collection's `totalSeats`), so this needs no per-country
 * lookup table of its own.
 *
 * For every (country, region) with a cycle-0 election, this seeds a
 * candidate-NPP population sized to that region's cycle-0 RACE count (one
 * candidate per race, NOT per seat - see the sizing comment in the body), split
 * across every party SEEDED PRESENT in that region (via `statePartyOrg`,
 * reusing the exact zero-state weighting `backfillMissingSeats.ts` already
 * validates: organization × registration share, or organization alone) -
 * with an explicit floor of at least one NPP per present party, so a
 * 2.5%-polling minor party (UK's SNP/Plaid/Sinn Féin/Alliance) is never
 * zeroed out the way pure proportional rounding would zero it. Regions with
 * no seeded `statePartyOrg` data at all fall back to an even split across
 * every seeded default party for that country (mirrors `backfillChamber`'s
 * fallback).
 *
 * This is additive and idempotent: it computes its own per-(country, state,
 * party) shortfall against NPPs that already exist (whether seeded here,
 * by `seedHistoricalOfficials`, by an econ-tier/UK roster call, or organically),
 * and only tops up the gap. It NEVER creates `electedOfficials` - every NPP it
 * creates is an unseated candidate, `currentOffice: null`, exactly like the
 * rest of the "priors" contract. Excludes national single-seat executive
 * races (president, premier, chairmanOfPresidium, ...) by construction: those
 * pass the country code itself as `state`, which never matches a real
 * `states` row, so they never enter the per-region target map - those offices
 * are seated through government formation / on-demand challenger generation,
 * not a seeded legislative bench.
 */

import { ObjectId, type Db } from "mongodb";
import { generateUniqueNPPName } from "./nameGenerator";
import { selectPoliticianImage, weightedRandomEthnicity } from "./generator";
import { NPP_ECONOMY_DEFAULTS } from "./economyDefaults";
import { generateDefaultPersonality } from "./seedHistorical";
import type { Counter, Election, NPP, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  computeZeroStateRegionWeights,
  allocateSeatsByWeights,
} from "@/lib/sim/backfillMissingSeats";

export interface SeedNppPriorsPopulationResult {
  nppsCreated: number;
  byCountry: Record<string, number>;
}

/**
 * Allocate `target` candidate NPPs across every party present in `weights`
 * (partyId → weight, weight <= 0 entries treated as absent), guaranteeing
 * every present party gets AT LEAST ONE seat.
 *
 * `allocateSeatsByWeights` alone does not guarantee this: its floor+remainder
 * split can legitimately zero out a low-weight party even when
 * `target >= presentParties.length` (e.g. weights [100, 1, 1, 1, 1] over 5
 * seats floors to [4, 0, 0, 0, 0] before the single remainder seat is
 * handed out). Bumping `target` up to `presentParties.length` first, then
 * transferring one seat from the largest holder to any still-zero party,
 * fixes that without disturbing the proportional shape for the dominant
 * party's remaining seats.
 */
export function allocatePriorsSeats(
  target: number,
  weights: Map<string, number>
): Map<string, number> {
  const present = [...weights.entries()].filter(([, w]) => w > 0);
  if (present.length === 0) return new Map();

  const effectiveTarget = Math.max(target, present.length);
  const allocation = allocateSeatsByWeights(effectiveTarget, new Map(present));

  for (const [partyId] of present) {
    if ((allocation.get(partyId) ?? 0) > 0) continue;
    const donor = [...allocation.entries()]
      .filter(([id, count]) => id !== partyId && count > 1)
      .sort((a, b) => b[1] - a[1])[0];
    if (donor) {
      allocation.set(donor[0], donor[1] - 1);
      allocation.set(partyId, 1);
    } else {
      // Defensive: effectiveTarget >= present.length should always leave a
      // donor, but never drop a present party's floor if it somehow doesn't.
      allocation.set(partyId, 1);
    }
  }
  return allocation;
}

/**
 * The dominant ("major") parties in a region, by seeded weight. Data-driven
 * (top-N by org × registration) rather than a per-country slug table, so it
 * tracks the actual seeded strength for the era — e.g. Labour + the Unionists
 * in 1953 Scotland, not the modern SNP. Ties and sparse (even-split fallback)
 * regions resolve by the parties' natural order, which is sequentialId — the
 * historically-major parties are seeded first.
 */
export function topMajorPartyIds(weights: Map<string, number>, count = 2): Set<string> {
  return new Set(
    [...weights.entries()]
      .filter(([, w]) => w > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([id]) => id)
  );
}

/**
 * Base proportional allocation, then raise each major party to FULL race
 * coverage (`target` candidates) so the two dominant parties can field a
 * candidate in (almost) every race. Without this, `target` is split across
 * every present party and each major gets only a proportional slice — a
 * founding chamber then opens with no major able to actually win a majority of
 * seats. Additive: minor parties keep their proportional-with-floor slice.
 */
export function allocatePriorsSeatsWithMajorFloor(
  target: number,
  weights: Map<string, number>,
  majorIds: Set<string>
): Map<string, number> {
  const allocation = allocatePriorsSeats(target, weights);
  for (const id of majorIds) {
    if ((weights.get(id) ?? 0) <= 0) continue;
    if ((allocation.get(id) ?? 0) < target) allocation.set(id, target);
  }
  return allocation;
}

/** Minimal statePartyOrg row shape for the zero-state weighting helper. */
type OrgRow = {
  countryId: CountryId;
  stateId: string;
  partyId: string;
  organization?: number;
  registration?: number;
  registrationShare?: number;
  hasPresence?: boolean;
};

/**
 * Reserve `count` sequential NPP ids in ONE atomic increment instead of one
 * round-trip per NPP - this seeder can create hundreds to low-thousands of
 * NPPs in a single bootstrap.
 */
async function reserveNppSequentialIdBlock(db: Db, count: number): Promise<number> {
  if (count <= 0) return 0;
  const counter = await db
    .collection<Counter>("counters")
    .findOneAndUpdate(
      { _id: "npp" },
      { $inc: { seq: count } },
      { upsert: true, returnDocument: "after" }
    );
  if (!counter?.seq) {
    throw new Error("Failed to reserve npp sequential id block");
  }
  return counter.seq - count + 1;
}

export async function seedNppPriorsPopulation(
  db: Db,
  log: (msg: string) => void = () => {}
): Promise<SeedNppPriorsPopulationResult> {
  const now = new Date();

  // Real sub-national regions only - excludes national executive races that
  // pass a country code as `state`.
  const stateDocs = await db
    .collection<{ _id: string; countryId: CountryId }>("states")
    .find({}, { projection: { _id: 1, countryId: 1 } })
    .toArray();
  const validRegionKeys = new Set(stateDocs.map((s) => `${s.countryId}:${s._id}`));
  if (validRegionKeys.size === 0) {
    return { nppsCreated: 0, byCountry: {} };
  }

  // Cycle-0 founding elections are the seat-count truth: they're generated
  // from each country's own region/config data by `spawnFoundingElections`,
  // which must have already run when this is called.
  const elections = await db
    .collection<Pick<Election, "countryId" | "state" | "cycle">>("elections")
    .find({ cycle: 0 }, { projection: { countryId: 1, state: 1 } })
    .toArray();

  // Target is one candidate per RACE, not per SEAT. This game models a
  // multi-seat chamber as a handful of officeholders each holding many seats
  // via `electedOfficials.seatsHeld` - a 451-turn world runs the UK Commons
  // with 57 officeholders across 942 seats, the USSR with 95 across 7,330 and
  // China with 96 across 5,014. `electionEntry`'s Phase 2 also registers at
  // most ONE candidate per party per election, so seats-worth of extra NPPs
  // can never stand for anything.
  //
  // Sizing off `totalSeats` produced exactly that: with the founding phase on,
  // every seat in the world is contested at cycle 0 simultaneously, so summing
  // them created 29,492 NPPs at bootstrap (RU 7,474 against a real 95) - an
  // inert bench that every turn still had to process, and which slowed turn
  // time roughly fivefold. Counting races instead lands on the same order of
  // magnitude as the live steady state.
  const targetByRegion = new Map<string, number>();
  for (const e of elections) {
    const key = `${e.countryId}:${e.state}`;
    if (!validRegionKeys.has(key)) continue;
    targetByRegion.set(key, (targetByRegion.get(key) ?? 0) + 1);
  }
  if (targetByRegion.size === 0) {
    log("NPP priors population: no cycle-0 regional elections found, nothing to seed");
    return { nppsCreated: 0, byCountry: {} };
  }

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find(
      {},
      {
        projection: {
          sequentialId: 1,
          countryId: 1,
          name: 1,
          isDefault: 1,
          economicPosition: 1,
          socialPosition: 1,
        },
      }
    )
    .toArray();
  const partiesByCountry = new Map<string, PoliticalParty[]>();
  for (const p of parties) {
    const list = partiesByCountry.get(p.countryId) ?? [];
    list.push(p);
    partiesByCountry.set(p.countryId, list);
  }

  const orgRows = await db
    .collection<OrgRow>("statePartyOrg")
    .find(
      {},
      {
        projection: {
          countryId: 1,
          stateId: 1,
          partyId: 1,
          organization: 1,
          registration: 1,
          registrationShare: 1,
          hasPresence: 1,
        },
      }
    )
    .toArray();
  const orgRowsByRegion = new Map<string, OrgRow[]>();
  for (const r of orgRows) {
    const key = `${r.countryId}:${r.stateId}`;
    const list = orgRowsByRegion.get(key) ?? [];
    list.push(r);
    orgRowsByRegion.set(key, list);
  }

  const existingNpps = await db
    .collection<NPP>("npps")
    .find({ retiredAt: null }, { projection: { name: 1, countryId: 1, homeState: 1, party: 1 } })
    .toArray();
  const existingNames = new Set(existingNpps.map((n) => n.name));
  const existingCountByBucket = new Map<string, number>();
  for (const n of existingNpps) {
    const key = `${n.countryId}:${n.homeState}:${n.party}`;
    existingCountByBucket.set(key, (existingCountByBucket.get(key) ?? 0) + 1);
  }

  interface PlannedNpp {
    countryId: CountryId;
    state: string;
    party: PoliticalParty;
  }
  const plan: PlannedNpp[] = [];
  const byCountry: Record<string, number> = {};

  for (const [regionKey, target] of targetByRegion) {
    const idx = regionKey.indexOf(":");
    const countryId = regionKey.slice(0, idx) as CountryId;
    const state = regionKey.slice(idx + 1);

    const countryParties = partiesByCountry.get(countryId) ?? [];
    if (countryParties.length === 0) continue;
    const partyBySeq = new Map(countryParties.map((p) => [String(p.sequentialId), p]));

    const rows = orgRowsByRegion.get(regionKey) ?? [];
    let weights = computeZeroStateRegionWeights(rows);
    let candidateParties: PoliticalParty[];
    if (weights.size > 0) {
      candidateParties = [...weights.keys()]
        .map((id) => partyBySeq.get(id))
        .filter((p): p is PoliticalParty => !!p);
    } else {
      // No seeded regional-presence data at all for this region - even
      // split across every seeded default party for the country, matching
      // `backfillChamber`'s no-org-data fallback.
      candidateParties = countryParties.filter((p) => p.isDefault);
      weights = new Map(candidateParties.map((p) => [String(p.sequentialId), 1]));
    }
    if (candidateParties.length === 0) continue;

    const majorIds = topMajorPartyIds(weights);
    const allocation = allocatePriorsSeatsWithMajorFloor(target, weights, majorIds);

    for (const party of candidateParties) {
      const seqId = String(party.sequentialId);
      const wanted = allocation.get(seqId) ?? 0;
      if (wanted <= 0) continue;
      const bucketKey = `${countryId}:${state}:${seqId}`;
      const already = existingCountByBucket.get(bucketKey) ?? 0;
      const need = wanted - already;
      for (let i = 0; i < need; i++) {
        plan.push({ countryId, state, party });
        byCountry[countryId] = (byCountry[countryId] ?? 0) + 1;
      }
    }
  }

  if (plan.length === 0) {
    log(
      "NPP priors population: every seeded party already meets its regional target, nothing to add"
    );
    return { nppsCreated: 0, byCountry: {} };
  }

  const startSeq = await reserveNppSequentialIdBlock(db, plan.length);
  const toInsert: NPP[] = plan.map((planned, i) => {
    let name = generateUniqueNPPName(Array.from(existingNames), 100, planned.countryId);
    if (!name) {
      name = `NPP ${Math.random().toString(36).substring(7)}`;
    }
    existingNames.add(name);

    const gender = Math.random() < 0.5 ? "male" : "female";
    const ethnicity = weightedRandomEthnicity(planned.countryId);
    const avatarUrl = selectPoliticianImage(planned.countryId, gender, ethnicity, name);

    const npp: NPP = {
      _id: new ObjectId(),
      sequentialId: startSeq + i,
      name,
      countryId: planned.countryId,
      homeState: planned.state,
      gender,
      ethnicity,
      ...(avatarUrl && { avatarUrl }),
      politicalInfluence: 10,
      favorability: 50 + Math.random() * 20 - 10,
      // Positions come straight from the resolved party doc - no slug/name
      // lookup table needed, unlike seedHistorical.ts's `resolvePartyId` path,
      // because this seeder always starts from an already-resolved party doc.
      policies: {
        economic: planned.party.economicPosition,
        social: planned.party.socialPosition,
      },
      party: String(planned.party.sequentialId),
      currentOffice: null,
      personality: generateDefaultPersonality(),
      generatedAt: now,
      retiredAt: null,
      influenceState: { totalTimesInfluenced: 0 },
      ...NPP_ECONOMY_DEFAULTS,
      archetypeApprovals: {},
      electionCooldowns: {},
      createdAt: now,
      updatedAt: now,
    };
    return npp;
  });

  await db.collection<NPP>("npps").insertMany(toInsert);
  log(
    `Seeded NPP priors population: ${toInsert.length} NPPs across ${
      Object.keys(byCountry).length
    } countries (region-and-party-weighted, sized from cycle-0 race counts)`
  );

  return { nppsCreated: toInsert.length, byCountry };
}
