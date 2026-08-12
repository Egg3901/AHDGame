import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import { seedFromSeats } from "@/lib/npp/seedHistorical";
import type { HistoricalSeat } from "@/lib/constants/historicalSeats";
import type { GameState, State } from "@/lib/db/types";
import {
  STATE_SENATE_SEATS,
  subNationalChamberSeats,
  getHouseSeats,
  isUsElectoralState,
} from "@/lib/constants/states";

/**
 * True when `stateId` is eligible for the US federal seat backfill (House,
 * Senate) under the given era's apportionment map. Mirrors the gate
 * `initializeOfficials.ts` and `seedSeats.ts` apply at world-bootstrap time:
 * DC is never electoral (`isUsElectoralState`), and AK/HI are excluded before
 * their preset's apportionment map lists them (pre-statehood eras — a
 * post-1959 world legitimately gains them once the era's `houseSeatsByState`
 * includes them).
 *
 * Without this gate, `backfillChamber`/`backfillSubNationalChamber` — which
 * iterate the `states` collection directly rather than the era-scoped `seats`
 * slot collection — apportion federal seats by raw population across EVERY US
 * `states` row, fabricating a DC Senate seat and DC/HI House `seatsHeld` from
 * population alone. Measured in the sandbox world: a DC Senate seat plus
 * DC(2)/HI(1) House seatsHeld, inflating the nominal House to 438 against the
 * real 435 (`congressionalDistricts` has zero DC/HI docs).
 */
export function isUsBackfillEligibleState(
  stateId: string,
  houseSeatsByState: Record<string, number>
): boolean {
  return isUsElectoralState(stateId) && houseSeatsByState[stateId] != null;
}

/**
 * Office types where ONE electedOfficial record can represent multiple seats
 * via `seatsHeld` (multi-member delegations, e.g. "1 NPP holds all 6 GOP
 * House seats in Alabama"). Mirrors seedHistorical.ts's own allowlist EXACTLY
 * — anything outside it (senate, governor, president, ...) is a genuinely
 * single-seat office there, and seedFromSeats silently ignores `seatsHeld`
 * for those, defaulting every record to 1 seat. Keep in sync with the
 * `seat.officeType === "house" || ...` list in seedHistorical.ts.
 */
const SEATS_HELD_OFFICE_TYPES = new Set([
  "house",
  "commons",
  "stateSenate",
  "regionalCouncil",
  "shugiin",
  "sangiin",
  "bundestag",
  "landtag",
  "npcDelegate",
  "peoplesCongress",
  "dail",
  "seanad",
  "localCouncil",
  "chamber",
  "volkskammerDeputy",
  "landAssembly",
  "supremeSovietDeputy",
  "nationalitiesDeputy",
  "republicSupremeSoviet",
  // Beta-parliament office-type keys (FR/IT/ES/SE/TR). Elections are keyed by
  // chamber name but seated officials use these keys — see officeKeyForElectionType.
  "deputy",
  "senator",
  "member",
  "procurador",
]);

/**
 * Backfills a legislative chamber up to its CONFIGURED seat count
 * (COUNTRY_CONFIGS[countryId].legislature.{upper,lower}Chamber.seats) when the
 * authored historical seat data falls short — generating synthetic NPPs via
 * the SAME seedFromSeats() pipeline the real historical rosters use, not a
 * bespoke generator.
 *
 * Root cause this exists to cover: seedHistoricalOfficials only seats what's
 * in the authored HistoricalSeat[] dataset for the preset (historicalSeats.ts)
 * — real historical rosters for less-researched countries/eras are
 * incomplete (documented project convention: "deliberately not estimated"),
 * so some chambers start with FEWER real seats than the country's own config
 * says should exist. Found via the headless sim: Nigeria's entire 1991
 * legislature (House: 360 configured seats, Senate: 109) had ZERO seeded
 * officials of any kind — only the presidency was seeded — and the UK
 * Commons was short by 14 of 665 configured seats.
 *
 * NOT wired into the live game's bootstrap/reset path — this only runs from
 * the headless sim harness (scripts/sim/runWorld.ts), which needs a fully
 * populated world for balance-testing "every seat active" scenarios. The
 * live game's admin reset flow is left untouched: a genuinely vacant real
 * seat is legitimate game state (a player or NPP wins it through the normal
 * election pipeline over time), not something to silently paper over with a
 * name that has no real-world basis.
 *
 * The generated NPPs are explicitly synthetic, not historical — distributed
 * across the country's ALREADY-SEEDED regions (proportional to population,
 * largest-remainder rounding) and parties (proportional to that chamber's
 * EXISTING seat share if any exists, so a backfill never distorts an
 * already-established political balance). When the chamber starts from ZERO
 * (UK Commons "democracies start vacant", Nigeria 1991), parties are weighted
 * by their SEEDED per-region strength from statePartyOrg — organization,
 * scaled by the seeded registration share where present — so a 2.5%-polling
 * party gets a sliver, and a party with NO statePartyOrg row (or
 * hasPresence: false) in a region gets NOTHING there (regional parties never
 * get seats outside their home regions). Only regions with no statePartyOrg
 * data at all fall back to the legacy even split.
 */
/** Minimal statePartyOrg row shape consumed by the zero-state weighting. */
export interface SeedStrengthRow {
  stateId: string;
  partyId: string;
  organization?: number;
  registration?: number;
  registrationShare?: number;
  hasPresence?: boolean;
}

/**
 * Zero-state party weights for ONE region, from seeded statePartyOrg rows.
 *
 * - A party with no row in the region isn't in the result at all (weight 0):
 *   no seeded presence → no synthetic incumbents (SNP never seats in London).
 * - `hasPresence: false` rows are likewise excluded.
 * - Weight = organization, scaled by the seeded registration share
 *   (`registrationShare` preferred, `registration` fallback) when EVERY
 *   present row in the region carries one — org alone over-weights tiny
 *   parties because seeded org has a floor (e.g. UK MIN_ORG=5) and a
 *   compressed scale; org × regShare puts a 2.5%-polling party at a sliver.
 *   Mixing org-only and org×reg scales within one region would skew
 *   proportions by orders of magnitude, hence the all-or-nothing rule.
 */
export function computeZeroStateRegionWeights(rows: SeedStrengthRow[]): Map<string, number> {
  const present = rows.filter((r) => r.hasPresence !== false);
  const allHaveReg =
    present.length > 0 &&
    present.every((r) => typeof (r.registrationShare ?? r.registration) === "number");
  const weights = new Map<string, number>();
  for (const r of present) {
    const org = Math.max(0, r.organization ?? 0);
    const reg = Math.max(0, r.registrationShare ?? r.registration ?? 0);
    const w = allHaveReg ? org * reg : org;
    if (w > 0) weights.set(r.partyId, w);
  }
  return weights;
}

/**
 * Largest-remainder allocation of `seats` across weighted parties.
 * Deterministic: parties are processed in descending-weight order.
 * Returns only parties that received at least one seat.
 */
export function allocateSeatsByWeights(
  seats: number,
  weights: Map<string, number>
): Map<string, number> {
  const out = new Map<string, number>();
  const entries = [...weights.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (seats <= 0 || total <= 0 || entries.length === 0) return out;

  let allocated = 0;
  const remainders: { key: string; remainder: number }[] = [];
  for (const [key, w] of entries) {
    const exact = (seats * w) / total;
    const floor = Math.floor(exact);
    if (floor > 0) out.set(key, floor);
    allocated += floor;
    remainders.push({ key, remainder: exact - floor });
  }
  remainders.sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; allocated < seats; i++, allocated++) {
    const k = remainders[i % remainders.length].key;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

export async function backfillMissingSeats(
  db: Db,
  countryId: CountryId
): Promise<{ house: number; senate: number; subNational: number }> {
  const config = COUNTRY_CONFIGS[countryId];
  const legislature = config?.legislature;
  if (!legislature) return { house: 0, senate: 0, subNational: 0 };

  // US-only: the active preset's apportionment map decides which `states` rows
  // are eligible for federal seat backfill — see `isUsBackfillEligibleState`.
  // Read once and thread through so DC/pre-statehood AK/HI never enter the
  // population-proportional apportionment below.
  const houseSeatsByState =
    // eslint-disable-next-line local/no-country-literals -- DC/AK/HI federal apportionment quirks are a US-only structural concept, not config-driven
    countryId === "US"
      ? getHouseSeats(
          (await db.collection<GameState>("gameState").findOne({ _id: "current" }))?.preset
        )
      : null;

  const lower = legislature.lowerChamber
    ? await backfillChamber(
        db,
        countryId,
        legislature.lowerChamber.key,
        legislature.lowerChamber.seats,
        houseSeatsByState
      )
    : 0;
  // Appointed / non-elected upper chambers (UK Lords, SE Första kammaren in
  // eras where upperElectionSystem is undefined, CN CPPCC) must NOT be
  // backfilled — inventing 784 Lords NPPs inflated UK party seat sums far
  // past Commons totalSeats in the 1953 sim audit.
  const upper =
    legislature.upperChamber && config.upperElectionSystem
      ? await backfillChamber(
          db,
          countryId,
          legislature.upperChamber.key,
          legislature.upperChamber.seats,
          houseSeatsByState
        )
      : 0;

  // Multi-seat SUB-NATIONAL chambers (one chamber per state/region): the US
  // State Senate, the CN Provincial People's Congress, etc. These start
  // un-backfilled (the national lower/upper loop above never touches them), so
  // in a vacant-legislature preset (e.g. 1953) they have no incumbents to
  // defend and no challenger supply → the races resolve with zero candidates
  // and the chamber is never seated. Backfill both parties' delegations (by
  // seeded regional org presence, like the House) so both defend each cycle →
  // contested/seated. Single-seat offices (governor/senate) are deliberately
  // NOT backfilled: one incumbent can't make a single-winner race contested;
  // that needs challenger supply, not backfill.
  const subNational = await backfillSubNationalChamber(db, countryId, houseSeatsByState);

  return { house: lower, senate: upper, subNational };
}

/** State/region doc shape the sub-national seat sizing needs. */
type SubNatStateDoc = { _id: string; stateSenateSeats?: number | null };

/**
 * Per-country multi-seat sub-national chamber: its officeType and a per-state
 * seat count. Only countries whose sub-national chamber is a multi-seat
 * proportional body belong here (single-seat offices don't benefit from
 * incumbent backfill).
 *
 * RU's republic Supreme Soviets (`republicSupremeSoviet`) are the one-party
 * analog of CN's provincial People's Congress: each republic authors its own
 * chamber size in the seed doc's `stateSenateSeats`, so a vacant-legislature
 * preset (1953/1979) starts them un-seeded — no incumbents to defend, no
 * challenger supply, so `ensureRURepublicSovietElections` resolves with ZERO
 * candidates and the chamber never seats. Backfilling both parties' authored
 * delegations gives every republic soviet contested/seated cycles, exactly the
 * CN People's Congress fix (#3388) applied to the USSR (#3386). The national
 * Supreme Soviet chambers (`supremeSovietDeputy` / `nationalitiesDeputy`) are
 * the RU legislature's lower/upper chambers, so they are already covered by the
 * generic `backfillChamber` loop above.
 */
export const SUB_NATIONAL_CHAMBERS: Partial<
  Record<CountryId, { officeType: string; seatsForState: (s: SubNatStateDoc) => number }>
> = {
  US: {
    officeType: "stateSenate",
    seatsForState: (s) => STATE_SENATE_SEATS[s._id] ?? s.stateSenateSeats ?? 0,
  },
  CN: {
    officeType: "peoplesCongress",
    seatsForState: (s) => subNationalChamberSeats("CN", s),
  },
  RU: {
    officeType: "republicSupremeSoviet",
    // Each republic's authored chamber size (seedRU.ts's stateSenateSeats),
    // the same single source of truth `ensureRURepublicSovietElections` sizes
    // its per-region elections from.
    seatsForState: (s) => subNationalChamberSeats("RU", s),
  },
  DD: {
    officeType: "landAssembly",
    // Each Land's authored assembly size (ddRegions*.ts stateSenateSeats).
    seatsForState: (s) => subNationalChamberSeats("DD", s),
  },
};

async function backfillSubNationalChamber(
  db: Db,
  countryId: CountryId,
  houseSeatsByState: Record<string, number> | null
): Promise<number> {
  const spec = SUB_NATIONAL_CHAMBERS[countryId];
  if (!spec) return 0;
  const { officeType, seatsForState } = spec;

  const states = (
    await db
      .collection<State>("states")
      .find({ countryId }, { projection: { _id: 1, stateSenateSeats: 1 } })
      .toArray()
  ).filter((s) => countryId !== "US" || isUsBackfillEligibleState(s._id, houseSeatsByState ?? {}));
  if (states.length === 0) return 0;
  const parties = await db
    .collection("politicalParties")
    .find({ countryId }, { projection: { sequentialId: 1, name: 1 } })
    .sort({ sequentialId: 1 })
    .toArray();
  if (parties.length === 0) return 0;
  const nameBySequentialId = new Map(
    parties.map((p) => [String(p.sequentialId), p.name as string])
  );

  // Currently filled seats per state for this office (respecting seatsHeld).
  const currentByState = new Map<string, number>();
  const existing = await db
    .collection("electedOfficials")
    .aggregate<{ _id: string; total: number }>([
      { $match: { countryId, officeType } },
      { $group: { _id: "$state", total: { $sum: { $ifNull: ["$seatsHeld", 1] } } } },
    ])
    .toArray();
  for (const e of existing) currentByState.set(String(e._id), e.total);

  // Seeded regional org presence → both-party split (a party with no presence in
  // a region gets no synthetic incumbents there — same rule as backfillChamber).
  const knownPartyIds = new Set(nameBySequentialId.keys());
  const orgRows = await db
    .collection<SeedStrengthRow>("statePartyOrg")
    .find(
      { countryId },
      {
        projection: {
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
  const rowsByState = new Map<string, SeedStrengthRow[]>();
  for (const r of orgRows) {
    if (!knownPartyIds.has(String(r.partyId))) continue;
    const list = rowsByState.get(r.stateId) ?? [];
    list.push(r);
    rowsByState.set(r.stateId, list);
  }

  const newSeats: HistoricalSeat[] = [];
  for (const state of states) {
    const target = seatsForState(state);
    if (target <= 0) continue;
    const shortfall = target - (currentByState.get(state._id) ?? 0);
    if (shortfall <= 0) continue;

    const weights = computeZeroStateRegionWeights(rowsByState.get(state._id) ?? []);
    if (weights.size > 0) {
      for (const [partySeqId, count] of allocateSeatsByWeights(shortfall, weights)) {
        const partyName = nameBySequentialId.get(partySeqId);
        if (partyName && count > 0) {
          newSeats.push({
            state: state._id,
            officeType: officeType as HistoricalSeat["officeType"],
            party: partyName,
            seatsHeld: count,
          });
        }
      }
    } else {
      // No seeded org presence for this region — even split across all parties.
      const per = Math.max(1, Math.floor(shortfall / parties.length));
      let remaining = shortfall;
      for (const p of parties) {
        if (remaining <= 0) break;
        const take = Math.min(per, remaining);
        newSeats.push({
          state: state._id,
          officeType: officeType as HistoricalSeat["officeType"],
          party: p.name as string,
          seatsHeld: take,
        });
        remaining -= take;
      }
      if (remaining > 0 && newSeats.length > 0) {
        const last = newSeats[newSeats.length - 1];
        last.seatsHeld = (last.seatsHeld ?? 1) + remaining;
      }
    }
  }

  if (newSeats.length === 0) return 0;
  const result = await seedFromSeats(db, newSeats);
  return result.officialsCreated;
}

async function backfillChamber(
  db: Db,
  countryId: CountryId,
  chamberKey: string,
  targetSeats: number | undefined,
  houseSeatsByState: Record<string, number> | null
): Promise<number> {
  if (!targetSeats || targetSeats <= 0) return 0;
  const officeType = getOfficeTypeForChamber(countryId, chamberKey);

  // Cap the fill target at the chamber's ACTUAL seeded seat slots, not the static
  // modern config. seedSeats creates seat slots per the active era's state set, so
  // a pre-statehood era has fewer than the config assumes — e.g. the 1953 US Senate
  // is 96 slots (48 states × 2), not the config's 100, because Alaska/Hawaii are
  // territories. Without this cap the backfill would seat 4 phantom "third senators"
  // in the largest states to reach 100. Each slot doc counts as its `totalSeats`
  // (multi-member house) or 1 (per-seat senate). Falls back to the config target if
  // no slots are found (defensive — slots are always seeded before backfill runs).
  const slotDocs = await db
    .collection<{ totalSeats?: number }>("seats")
    .find({ countryId, electionType: officeType }, { projection: { totalSeats: 1 } })
    .toArray();
  const slotCapacity = slotDocs.reduce(
    (n, d) => n + (typeof d.totalSeats === "number" ? d.totalSeats : 1),
    0
  );
  const effectiveTarget = slotCapacity > 0 ? Math.min(targetSeats, slotCapacity) : targetSeats;

  const [current] = await db
    .collection("electedOfficials")
    .aggregate<{ total: number }>([
      { $match: { countryId, officeType } },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$seatsHeld", 1] } } } },
    ])
    .toArray();
  const currentTotal = current?.total ?? 0;
  const shortfall = effectiveTarget - currentTotal;
  if (shortfall <= 0) return 0;

  // US-only: exclude DC and pre-statehood AK/HI from the population-proportional
  // apportionment below — see `isUsBackfillEligibleState`. Every other country
  // passes through unfiltered.
  const states = (
    await db
      .collection<State>("states")
      .find({ countryId }, { projection: { _id: 1, population: 1 } })
      .toArray()
  ).filter((s) => countryId !== "US" || isUsBackfillEligibleState(s._id, houseSeatsByState ?? {}));
  const parties = await db
    .collection("politicalParties")
    .find({ countryId }, { projection: { sequentialId: 1, name: 1 } })
    .sort({ sequentialId: 1 })
    .toArray();
  if (states.length === 0 || parties.length === 0) return 0;

  const nameBySequentialId = new Map(
    parties.map((p) => [String(p.sequentialId), p.name as string])
  );

  // Party weights: proportional to this chamber's EXISTING seat share when any
  // exists, so backfilling never shifts an already-established balance (e.g.
  // UK's real 1992 Commons proportions). When the chamber starts from ZERO,
  // weight parties by their seeded per-region strength (statePartyOrg) via
  // `computeZeroStateRegionWeights` — the old even split seated SNP/PC/SF
  // "incumbents" in England who then auto-defended their seats (1953 sim
  // forensics). Even split survives only for regions with no statePartyOrg
  // data at all.
  const existingByParty = await db
    .collection("electedOfficials")
    .aggregate<{ _id: string; total: number }>([
      { $match: { countryId, officeType } },
      { $group: { _id: "$party", total: { $sum: { $ifNull: ["$seatsHeld", 1] } } } },
    ])
    .toArray();
  const partyWeights = new Map<string, number>();
  if (existingByParty.length > 0) {
    for (const e of existingByParty) {
      const name = nameBySequentialId.get(e._id) ?? e._id;
      partyWeights.set(name, e.total);
    }
  } else {
    for (const p of parties) partyWeights.set(p.name as string, 1);
  }
  const totalWeight = [...partyWeights.values()].reduce((a, b) => a + b, 0) || 1;

  // Zero-state chamber: load seeded regional strength once for the country.
  let weightsByState: Map<string, Map<string, number>> | null = null;
  if (existingByParty.length === 0) {
    const knownPartyIds = new Set(nameBySequentialId.keys());
    const orgRows = await db
      .collection<SeedStrengthRow>("statePartyOrg")
      .find(
        { countryId },
        {
          projection: {
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
    const rowsByState = new Map<string, SeedStrengthRow[]>();
    for (const r of orgRows) {
      if (!knownPartyIds.has(String(r.partyId))) continue; // party not in seeded roster
      const list = rowsByState.get(r.stateId) ?? [];
      list.push(r);
      rowsByState.set(r.stateId, list);
    }
    weightsByState = new Map();
    for (const [sid, rows] of rowsByState) {
      const w = computeZeroStateRegionWeights(rows);
      if (w.size > 0) weightsByState.set(sid, w);
    }
  }

  // Region allocation: population-proportional, largest-remainder method so the
  // shortfall total is preserved exactly (plain rounding can drift by a seat or two).
  const totalPop =
    states.reduce((sum, s) => sum + ((s.population as number) ?? 1), 0) || states.length;
  const shares = states.map((s) => {
    const exact = shortfall * (((s.population as number) ?? 1) / totalPop);
    return { state: s._id, seats: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let allocated = shares.reduce((sum, s) => sum + s.seats, 0);
  shares.sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; allocated < shortfall; i++, allocated++) {
    shares[i % shares.length].seats += 1;
  }

  const newSeats: HistoricalSeat[] = [];
  const pushSeats = (state: string, party: string, count: number) => {
    if (count <= 0) return;
    if (SEATS_HELD_OFFICE_TYPES.has(officeType)) {
      // Multi-seat delegation office (e.g. house/commons) — one record can
      // legitimately represent several seats via seatsHeld.
      newSeats.push({
        state,
        officeType: officeType as HistoricalSeat["officeType"],
        party,
        seatsHeld: count,
      });
    } else {
      // Single-seat office (e.g. senate/governor) — seedFromSeats/
      // seedHistorical.ts's own officeType allowlist only ever honors
      // seatsHeld for the multi-seat types above; anything else silently
      // defaults every record to 1 seat regardless of what's passed. Found
      // via a real backfill run: NG's Senate came back with 12 of the
      // intended 109 seats — 12 records, one per (state, party) pair, each
      // silently collapsed to 1 seat. Push one record per actual seat here
      // instead of relying on a multiplier this office type doesn't support.
      for (let i = 0; i < count; i++) {
        newSeats.push({ state, officeType: officeType as HistoricalSeat["officeType"], party });
      }
    }
  };

  for (const { state, seats } of shares) {
    if (seats <= 0) continue;

    // Zero-state chamber with seeded regional strength: allocate this region's
    // seats by largest remainder over the per-region statePartyOrg weights.
    // Parties with no row (no presence) here got no weight → no seats.
    const regionWeights = weightsByState?.get(String(state));
    if (regionWeights && regionWeights.size > 0) {
      const byParty = allocateSeatsByWeights(seats, regionWeights);
      for (const [partySeqId, count] of byParty) {
        const partyName = nameBySequentialId.get(partySeqId);
        if (partyName) pushSeats(String(state), partyName, count);
      }
      continue;
    }

    let remaining = seats;
    const partyEntries = [...partyWeights.entries()];
    for (const [partyName, weight] of partyEntries) {
      if (remaining <= 0) break;
      const share = Math.max(1, Math.round((seats * weight) / totalWeight));
      const take = Math.min(share, remaining);
      pushSeats(state, partyName, take);
      remaining -= take;
    }
    if (remaining > 0) {
      // Rounding leftover — hand it to the largest party rather than dropping seats.
      const [biggest] = partyEntries.sort((a, b) => b[1] - a[1]);
      pushSeats(state, biggest[0], remaining);
    }
  }

  const result = await seedFromSeats(db, newSeats);
  return result.officialsCreated;
}
