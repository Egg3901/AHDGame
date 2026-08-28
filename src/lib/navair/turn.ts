import type { Db } from "mongodb";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { loadMilitaryBlocs } from "@/lib/military/blocLookup";
import { homeRegionOf } from "@/lib/military/regionTopology";
import {
  loadNavairChannels,
  saveNavairChannels,
  channelsFor,
} from "@/lib/db/collections/navairChannels";
import { advanceChannels, channelKey, type ContestInput } from "./channels";
import { detectionFromPresence } from "./detection";
import {
  basingStatus,
  berthCapacity,
  berthDemand,
  overcrowdPenalty,
  supplyCeiling,
} from "./basing";
import { cv, baseCv, alive } from "./engineCore";
import type { NavairUnit, RegionChannels } from "./types";
import type { CountryId } from "@/lib/constants/countries";
import type { RegionCode } from "@/lib/military/types";

/**
 * The naval and air pass, run once per turn for the whole world.
 *
 * This is NOT driven by a battle declaration and NOT scoped to a war. Fleets are at sea
 * whether or not anyone attacked this turn, sea control builds in peacetime, and a
 * blockade bites a country that has fought nothing. Battles read the state this pass
 * leaves behind; they do not produce it.
 *
 * Cost matters: it runs every turn for every country that owns a hull or a wing, so it
 * loads units, conflicts, blocs and channels ONCE and does the rest in memory.
 */

export interface NavairTurnResult {
  countriesProcessed: number;
  regionsContested: number;
  channelsWritten: number;
  unitsStationed: number;
}

/** Who each country is currently shooting at, from active conflicts. */
async function buildHostilityMap(db: Db): Promise<Map<string, Set<string>>> {
  const conflicts = await getConflictsCollection(db)
    .find({ status: "active" })
    .project<{ sideA: { countries: string[] }; sideB: { countries: string[] } }>({
      "sideA.countries": 1,
      "sideB.countries": 1,
    })
    .toArray();

  const hostility = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!hostility.has(a)) hostility.set(a, new Set());
    hostility.get(a)!.add(b);
  };

  for (const c of conflicts) {
    for (const a of c.sideA?.countries ?? []) {
      for (const b of c.sideB?.countries ?? []) {
        link(a, b);
        link(b, a);
      }
    }
  }
  return hostility;
}

/**
 * Where a formation is, falling back to its country's home region.
 *
 * A unit that has never been given a station is in home waters, not nowhere. Returning
 * null here instead would quietly drop every un-commanded fleet out of the contest, and
 * the symptom would be an empty ocean rather than an error.
 */
export function stationOf(unit: NavairUnit): RegionCode | null {
  return unit.station ?? homeRegionOf(unit.countryId) ?? null;
}

/**
 * One turn of naval and air operations.
 *
 * Order matters: stationing settles where everything is, detection is computed from that,
 * the contest is scored, and only then do channels move. Scoring before stationing would
 * contest last turn's positions.
 */
export async function processNavairTurn(db: Db, turn: number): Promise<NavairTurnResult> {
  const units = (await getMilitaryUnitsCollection(db)
    .find({ domain: { $in: ["naval", "air"] } })
    .toArray()) as unknown as NavairUnit[];

  if (!units.length) {
    return { countriesProcessed: 0, regionsContested: 0, channelsWritten: 0, unitsStationed: 0 };
  }

  const [hostility, blocs, channels] = await Promise.all([
    buildHostilityMap(db),
    loadMilitaryBlocs(db),
    loadNavairChannels(db),
  ]);

  // ── station everything, then index by region ────────────────────────────────
  const byRegion = new Map<RegionCode, NavairUnit[]>();
  const countries = new Set<CountryId>();
  let unitsStationed = 0;

  for (const u of units) {
    if (!alive(u)) continue;
    const station = stationOf(u);
    if (!station) continue;
    if (!u.station) unitsStationed++;
    u.station = station;
    countries.add(u.countryId);
    const list = byRegion.get(station);
    if (list) list.push(u);
    else byRegion.set(station, [u]);
  }

  // ── supply at station, before anything reads combat value ───────────────────
  // Combat value is scaled by supply, so an unsupplied fleet must be unsupplied BEFORE
  // the contest is scored, not after.
  for (const [region, here] of byRegion) {
    for (const countryId of new Set(here.map((u) => u.countryId))) {
      const mine = here.filter((u) => u.countryId === countryId);
      const enemies = hostility.get(countryId) ?? new Set<string>();
      const status = basingStatus(region, countryId, blocs, enemies);
      const capacity = berthCapacity(region, status, 0);
      const crowding = overcrowdPenalty(berthDemand(mine), capacity);
      const airlift = mine.some((u) => u.domain === "air" && u.mission === "AIRLIFT");
      for (const u of mine) u.supply = supplyCeiling(u, status, crowding, airlift);
    }
  }

  // ── score the contest and move the channels ─────────────────────────────────
  const updates: Array<{ countryId: CountryId; region: RegionCode; channels: RegionChannels }> = [];
  let regionsContested = 0;

  for (const countryId of countries) {
    const enemies = hostility.get(countryId) ?? new Set<string>();
    const home = homeRegionOf(countryId);
    const detection = detectionFromPresence(units, countryId, home ? [home] : []);

    for (const [region, here] of byRegion) {
      const mine = here.filter((u) => u.countryId === countryId);
      const hostile = here.filter((u) => enemies.has(u.countryId));
      if (!mine.length && !hostile.length) continue;

      const sea: ContestInput = {
        own: weigh(mine, "naval"),
        hostile: weigh(hostile, "naval"),
      };
      const air: ContestInput = {
        own: weigh(mine, "air"),
        hostile: weigh(hostile, "air"),
      };
      if (sea.hostile > 0 || air.hostile > 0) regionsContested++;

      const current = channelsFor(channels, countryId, region, turn);
      const next = advanceChannels(current, { air, sea }, detection.get(region) ?? 0, turn);
      updates.push({ countryId, region, channels: next });
      channels.set(channelKey(countryId, region), next);
    }
  }

  const channelsWritten = await saveNavairChannels(db, updates);

  return {
    countriesProcessed: countries.size,
    regionsContested,
    channelsWritten,
    unitsStationed,
  };
}

/**
 * Combat weight one group brings to a domain's contest.
 *
 * Naval weight is mission-weighted, so a fleet in port or in transit contests far less
 * than one fighting for the water. Air weight counts only formations actually flying to
 * hold the sky: a wing sitting on close air support is helping the land battle, not
 * contesting the air, and counting it twice would let one squadron do two jobs.
 */
function weigh(units: readonly NavairUnit[], domain: "naval" | "air"): number {
  let total = 0;
  for (const u of units) {
    if (u.domain !== domain) continue;
    if (domain === "naval") {
      total += cv(u, "combat");
    } else if (u.mission === "CAP" || u.mission === "PATROL") {
      total += baseCv(u);
    }
  }
  return total;
}
