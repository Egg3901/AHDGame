/**
 * US House apportionment + presidential electoral-vote derivation (P1d-2).
 *
 * These parameterized builders reconstruct the EV maps/units from a LIVE house-
 * seats map (`state.houseDistricts`), replacing the frozen `ELECTORAL_VOTES[_1991]`
 * / `ELECTORAL_VOTE_UNITS[_1991]` seed constants. A golden test pins that, fed the
 * seed seats, they reproduce those constants exactly — so the dynamic-sourcing
 * swap is behavior-preserving until a decennial census reapportions the seats.
 */

import { getHouseSeats, type ElectoralVoteUnit } from "@/lib/constants/states";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { admittedStateIdsAsOf } from "./statehoodAdmission";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/** US senators per state (the +2 in EV = houseSeats + senators). */
const SENATORS_PER_STATE = 2;
/**
 * DC electoral votes — the 23rd Amendment caps DC at the least-populous state's
 * EV (3). DC has NO House seats, so it isn't in the apportionment seats map and
 * is added here as a special case.
 */
const DC_ELECTORAL_VOTES = 3;
/**
 * The 23rd Amendment was ratified 29 March 1961. Before that DC cast NO
 * electoral votes at all — which is why `ELECTORAL_VOTES_1953` has no DC entry.
 * The builder used to add DC's 3 unconditionally, so a 1953 world contradicted
 * its own seed constant and handed DC three votes it would not hold for another
 * eight years.
 */
const DC_ELECTORAL_VOTES_FROM_YEAR = 1961;
/**
 * States allocating EVs by congressional district, and the year each adopted
 * the split. Both were winner-take-all before: Maine changed for the 1972
 * cycle, Nebraska for 1992. Splitting them in a 1953 or 1979 world invents a
 * mechanism that did not exist, and in Maine's case can hand a losing candidate
 * a stray elector.
 */
const DISTRICT_SPLIT_FROM_YEAR: Record<string, number> = { ME: 1972, NE: 1992 };

/**
 * The year an apportionment applies to. Prefers the live in-game year so a
 * world that has advanced past an amendment gains its effect; falls back to the
 * preset's starting year, which is what makes the era gates correct even for
 * callers that have no clock (the overwhelming majority).
 */
function resolveApportionmentYear(preset: string | undefined, year?: number | null): number {
  if (typeof year === "number" && Number.isFinite(year)) return year;
  return getStartingYearForPreset(preset ?? DEFAULT_SEED_PRESET);
}

/** Context for the era gates below. */
export interface ApportionmentEraContext {
  preset?: string;
  /** Live in-game year; falls back to the preset's starting year when absent. */
  year?: number | null;
}

/**
 * Electoral votes per state = house seats + 2 senators, plus DC's 3 once the
 * 23rd Amendment is in force.
 */
export function electoralVotesFromSeats(
  seats: Record<string, number>,
  ctx: ApportionmentEraContext = {}
): Record<string, number> {
  const ev: Record<string, number> = {};
  for (const [stateId, n] of Object.entries(seats)) ev[stateId] = n + SENATORS_PER_STATE;
  if (resolveApportionmentYear(ctx.preset, ctx.year) >= DC_ELECTORAL_VOTES_FROM_YEAR) {
    ev["DC"] = DC_ELECTORAL_VOTES;
  }
  return ev;
}

/**
 * Electoral-vote allocation units. Most states are a single winner-take-all unit
 * (`ev = seats + 2`); ME/NE split into an at-large unit (2 EV) plus one 1-EV unit
 * per congressional district (#districts = house seats). Order mirrors the seed
 * IIFE (iterates the EV map) so it deep-equals `ELECTORAL_VOTE_UNITS`.
 */
export function electoralVoteUnitsFromSeats(
  seats: Record<string, number>,
  ctx: ApportionmentEraContext = {}
): ElectoralVoteUnit[] {
  const units: ElectoralVoteUnit[] = [];
  const year = resolveApportionmentYear(ctx.preset, ctx.year);
  const ev = electoralVotesFromSeats(seats, ctx);
  for (const [stateId, total] of Object.entries(ev)) {
    const splitsFrom = DISTRICT_SPLIT_FROM_YEAR[stateId];
    const districts = seats[stateId] ?? 0;
    if (splitsFrom !== undefined && year >= splitsFrom && districts > 0) {
      // At-large leg: derived from this state's districts, never simulated.
      // See `ElectoralVoteUnit` — every unit used to draw the WHOLE state's
      // electorate from `stateId`, so a split state counted its voters once per
      // leg (#1464).
      units.push({
        unitId: stateId,
        ev: SENATORS_PER_STATE,
        stateId,
        electorateShare: 0,
        derivesFromDistricts: true,
      });
      for (let d = 1; d <= districts; d++) {
        units.push({
          unitId: `${stateId}_CD${d}`,
          ev: 1,
          stateId,
          electorateShare: 1 / districts,
        });
      }
    } else {
      units.push({ unitId: stateId, ev: total, stateId, electorateShare: 1 });
    }
  }
  return units;
}

export interface Apportionment {
  /** House seats per state (live `state.houseDistricts`, seed fallback). */
  houseSeats: Record<string, number>;
  /** Electoral votes per state (seats + 2, + DC's 3). */
  electoralVotes: Record<string, number>;
  /** EV allocation units (ME/NE split). */
  electoralVoteUnits: ElectoralVoteUnit[];
}

/**
 * Build the live apportionment from a per-state seats override (the census-updated
 * `state.houseDistricts`), falling back to the preset seed (`getHouseSeats`) for
 * any state without a live value. With an empty/seed override this reproduces the
 * seed constants exactly (golden gate) — so consumers swap to this with no
 * behavior change until a census reapportions.
 */
export function buildApportionment(
  liveSeatsByState: Record<string, number>,
  preset: string | undefined,
  year?: number | null,
  admittedStateIds?: Iterable<string>
): Apportionment {
  const seats: Record<string, number> = { ...getHouseSeats(preset) };
  // States admitted mid-game are absent from the preset's frozen apportionment
  // map — that absence is exactly what "not a state yet" means here — so they
  // must be let into the map before the override loop, or the guard below drops
  // them and a newly admitted Alaska stays seatless forever.
  for (const id of admittedStateIds ?? []) {
    if (!(id in seats)) seats[id] = 0;
  }
  for (const [id, n] of Object.entries(liveSeatsByState)) {
    if (Number.isFinite(n) && n > 0 && id in seats) seats[id] = n; // override only known House states
  }
  // An admitted state with no live seat count yet would otherwise sit at 0 and
  // draw 2 EVs from its senators alone. The constitutional floor is one seat.
  for (const id of admittedStateIds ?? []) {
    if (seats[id] === 0) seats[id] = 1;
  }
  const ctx: ApportionmentEraContext = { preset, year };
  return {
    houseSeats: seats,
    electoralVotes: electoralVotesFromSeats(seats, ctx),
    electoralVoteUnits: electoralVoteUnitsFromSeats(seats, ctx),
  };
}

/**
 * Load the live apportionment from the DB: reads US states' `houseDistricts` and
 * builds the seats/EV/units (seed fallback). Async wrapper over `buildApportionment`
 * for consumers without states already in hand.
 */
export async function loadApportionment(
  db: import("mongodb").Db,
  preset: string | undefined,
  year?: number | null
): Promise<Apportionment> {
  const usStates = (await db
    .collection("states")
    .find({ countryId: "US" }, { projection: { _id: 1, houseDistricts: 1, admittedYear: 1 } })
    .toArray()) as unknown as Array<{
    _id: string;
    houseDistricts?: number;
    admittedYear?: number;
  }>;
  const live: Record<string, number> = {};
  for (const s of usStates) {
    if (typeof s.houseDistricts === "number") live[s._id] = s.houseDistricts;
  }
  // A future-dated admission must not count yet — the year gate is what keeps
  // this consistent with the DC/ME-NE gates above.
  const admitted = admittedStateIdsAsOf(usStates, resolveApportionmentYear(preset, year));
  return buildApportionment(live, preset, year, admitted);
}

/**
 * Apportion `totalSeats` House seats across states by the **method of equal
 * proportions** (Huntington-Hill, the US algorithm). Every state gets a 1-seat
 * floor, then each remaining seat goes to the state with the highest priority
 * `pop / √(n·(n+1))` where `n` is its current seat count. Deterministic; ties
 * (vanishingly rare with real populations) resolve to the first-seen state.
 */
export function apportionHouseSeats(
  populations: Record<string, number>,
  totalSeats: number
): Record<string, number> {
  const ids = Object.keys(populations);
  const seats: Record<string, number> = {};
  for (const id of ids) seats[id] = 1; // constitutional floor
  let remaining = Math.max(0, totalSeats - ids.length);
  while (remaining > 0) {
    let bestId = ids[0];
    let bestPriority = -Infinity;
    for (const id of ids) {
      const n = seats[id];
      const pop = Number.isFinite(populations[id]) && populations[id] > 0 ? populations[id] : 0;
      const priority = pop / Math.sqrt(n * (n + 1));
      if (priority > bestPriority) {
        bestPriority = priority;
        bestId = id;
      }
    }
    seats[bestId] += 1;
    remaining -= 1;
  }
  return seats;
}
