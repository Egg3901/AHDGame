import type { Db, AnyBulkWriteOperation } from "mongodb";
import type { State } from "@/lib/db/types/state";
import type { GameState } from "@/lib/db/types/gameState";
import { apportionHouseSeats } from "@/lib/elections/apportionment";
import { createSystemNewsPost } from "@/lib/news";
import { regenerateCongressionalDistricts } from "@/lib/redistricting/regenerate";
import { getAutoNeutralizeStateIds } from "@/lib/redistricting/autoNeutralizeStates";

/** Total US House seats redistributed each census (constitutional cap). */
export const US_HOUSE_TOTAL_SEATS = 435;

export interface SeatDelta {
  state: string;
  from: number;
  to: number;
  delta: number;
}

export interface CensusResult {
  ran: boolean;
  year?: number;
  deltas?: SeatDelta[];
}

/**
 * Decennial census fires in Week 1 of years ending in 0 (real US census cadence,
 * keyed to the live game year so it's preset-aware: 2020/2030 for the 2019 start,
 * 2000/2010 for the 1991 start). `currentYear` increments at year rollover, so the
 * first turn it becomes a multiple of 10 IS Week 1; `lastCensusYear` guards against
 * re-firing within that year. Neither preset's start year (1991/2019) is ≡0 mod 10,
 * so nothing fires at bootstrap.
 */
export function shouldRunCensus(currentYear: number, lastCensusYear: number | undefined): boolean {
  if (!Number.isFinite(currentYear)) return false;
  if (currentYear % 10 !== 0) return false;
  return currentYear > (lastCensusYear ?? -Infinity);
}

/** Per-state seat changes (only states whose apportionment moved). */
export function computeSeatDeltas(
  oldSeats: Record<string, number>,
  newSeats: Record<string, number>
): SeatDelta[] {
  const deltas: SeatDelta[] = [];
  for (const [state, to] of Object.entries(newSeats)) {
    const from = oldSeats[state] ?? to;
    if (to !== from) deltas.push({ state, from, to, delta: to - from });
  }
  // Largest gains first, then largest losses — readable headline order.
  return deltas.sort((a, b) => b.delta - a.delta);
}

/** Format the census reapportionment news content. */
export function buildCensusContent(year: number, deltas: SeatDelta[]): string {
  if (deltas.length === 0) {
    return `The ${year} Census is complete. House apportionment is unchanged.`;
  }
  const fmt = (d: SeatDelta) => `${d.state} ${d.delta > 0 ? "+" : ""}${d.delta}`;
  return `The ${year} Census reapportions the House of Representatives: ${deltas
    .map(fmt)
    .join(", ")}.`;
}

/**
 * Run the decennial census + reapportionment (P1d-2 Phase 3). On a decennial-year
 * Week-1 turn, recompute US House seats from live state populations by method of
 * equal proportions, write the new `state.houseDistricts` (which the live
 * apportionment now drives EC + House from), stamp `gameState.lastCensusYear`, and
 * post a National Wire census event. No-op otherwise.
 */
export async function runCensus(db: Db, _turn: number): Promise<CensusResult> {
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" } as Partial<GameState>);
  const currentYear = gameState?.currentYear;
  if (currentYear === undefined || !shouldRunCensus(currentYear, gameState?.lastCensusYear)) {
    return { ran: false };
  }

  const usStates = (await db
    .collection("states")
    .find({ countryId: "US" }, { projection: { _id: 1, population: 1, houseDistricts: 1 } })
    .toArray()) as unknown as Array<{ _id: string; population?: number; houseDistricts?: number }>;

  // Apportion only over states that currently hold House seats (excludes DC etc.).
  const populations: Record<string, number> = {};
  const oldSeats: Record<string, number> = {};
  for (const s of usStates) {
    if (typeof s.houseDistricts === "number" && s.houseDistricts > 0) {
      populations[s._id] = Number.isFinite(s.population) ? (s.population as number) : 0;
      oldSeats[s._id] = s.houseDistricts;
    }
  }

  const newSeats = apportionHouseSeats(populations, US_HOUSE_TOTAL_SEATS);
  const deltas = computeSeatDeltas(oldSeats, newSeats);

  const ops: AnyBulkWriteOperation<State>[] = Object.entries(newSeats).map(([state, seats]) => ({
    updateOne: { filter: { _id: state }, update: { $set: { houseDistricts: seats } } },
  }));
  if (ops.length > 0) await db.collection<State>("states").bulkWrite(ops);

  // Redistricting (flag-gated): regenerate the maps of states whose seat count
  // changed, plus commission-run states that auto-neutralize each census. Neutral
  // rebuilds; a legislature-drawn trifecta may still redraw this census.
  if (gameState?.redistrictingEnabled) {
    const changed = deltas.map((d) => d.state);
    const autoNeutral = await getAutoNeutralizeStateIds(db, "US");
    const toRegen = [...new Set([...changed, ...autoNeutral])];
    if (toRegen.length > 0) {
      await regenerateCongressionalDistricts(db, {
        countryId: "US",
        stateIds: toRegen,
        now: new Date(),
      });
    }
  }

  await db.collection<GameState>("gameState").updateOne({ _id: "current" } as Partial<GameState>, {
    // Stamp the year (re-fire guard) AND a compact seat-change summary the region
    // population route reads to show a per-region reapportionment notice (P1d-3).
    $set: {
      lastCensusYear: currentYear,
      lastCensus: { year: currentYear, deltas },
    },
  });

  await createSystemNewsPost(buildCensusContent(currentYear, deltas), "election", {
    title: `${currentYear} Census`,
  });

  return { ran: true, year: currentYear, deltas };
}
