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
import { resolveEngagement } from "./engagement";
import { defaultMissionFor } from "./missions";
import type { NavairUnit, RegionChannels, EngagementOutcome } from "./types";
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
  engagementsFought: number;
  /** Formations reduced to combat ineffectiveness. Never deleted. */
  formationsLost: number;
  /** Formation rows written back after combat. */
  formationsUpdated: number;
  /** Formations given a standing mission because they had none. */
  missionsAssigned: number;
}

/**
 * Who each country is shooting at, and where its land fronts are.
 *
 * Both come from the same read of active conflicts, so the pass does not query twice for
 * two facts about one document.
 */
interface WarContext {
  hostility: Map<string, Set<string>>;
  frontRegions: Map<string, Set<RegionCode>>;
}

async function buildWarContext(db: Db): Promise<WarContext> {
  // Projection passed as a find option rather than via the cursor's .project(), which is
  // this codebase's house style and does not require a cursor implementation of it.
  const conflicts = (await getConflictsCollection(db)
    .find(
      { status: "active" },
      { projection: { "sideA.countries": 1, "sideB.countries": 1, region: 1 } }
    )
    .toArray()) as unknown as Array<{
    sideA?: { countries?: string[] };
    sideB?: { countries?: string[] };
    region?: RegionCode;
  }>;

  const hostility = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!hostility.has(a)) hostility.set(a, new Set());
    hostility.get(a)!.add(b);
  };

  const frontRegions = new Map<string, Set<RegionCode>>();
  const front = (country: string, region: RegionCode) => {
    if (!frontRegions.has(country)) frontRegions.set(country, new Set());
    frontRegions.get(country)!.add(region);
  };

  for (const c of conflicts) {
    const a = c.sideA?.countries ?? [];
    const b = c.sideB?.countries ?? [];
    for (const x of a) {
      for (const y of b) {
        link(x, y);
        link(y, x);
      }
    }
    if (c.region) for (const country of [...a, ...b]) front(country, c.region);
  }
  return { hostility, frontRegions };
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
    return {
      countriesProcessed: 0,
      regionsContested: 0,
      channelsWritten: 0,
      unitsStationed: 0,
      engagementsFought: 0,
      formationsLost: 0,
      formationsUpdated: 0,
      missionsAssigned: 0,
    };
  }

  const [war, blocs, channels] = await Promise.all([
    buildWarContext(db),
    loadMilitaryBlocs(db),
    loadNavairChannels(db),
  ]);
  const { hostility, frontRegions } = war;

  // ── station everything, then index by region ────────────────────────────────
  const touchedByMission = new Set<NavairUnit>();
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

  // ── standing missions for formations nobody commands ────────────────────────
  // Most of the world is run by nobody: NPC countries, players who have not opened the
  // war room, and every formation that existed before this subsystem did. Without this,
  // every navy in the game carries a null mission, no blockade or engagement ever fires,
  // and naval combat value falls through to the flying-weights fallback. A stored mission
  // is never overwritten: this fills a blank, it does not overrule a commander.
  let missionsAssigned = 0;
  for (const [region, here] of byRegion) {
    const hostileNavalHere = new Set(
      here.filter((u) => u.domain === "naval").map((u) => u.countryId)
    );
    const hostileAirHere = new Set(here.filter((u) => u.domain === "air").map((u) => u.countryId));

    for (const u of here) {
      if (u.mission) continue;
      const enemies = hostility.get(u.countryId) ?? new Set<string>();
      const mission = defaultMissionFor(u, {
        enemies,
        frontRegions: frontRegions.get(u.countryId) ?? new Set<RegionCode>(),
        contestedHere: [...hostileNavalHere].some((c) => enemies.has(c)),
        airContestedHere: [...hostileAirHere].some((c) => enemies.has(c)),
      });
      if (mission) {
        u.mission = mission;
        touchedByMission.add(u);
        missionsAssigned++;
      }
    }
    void region;
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

  // ── surface actions ─────────────────────────────────────────────────────────
  // Resolved BEFORE the contest is scored, so a fleet that was sunk or crippled this
  // turn does not go on to contest the water it just lost. Scoring first would let a
  // destroyed squadron hold a region for one more turn, every time.
  const engagements: EngagementOutcome[] = [];
  const crippled: NavairUnit[] = [];
  const touched = new Set<NavairUnit>();

  for (const [region, here] of byRegion) {
    const naval = here.filter((u) => u.domain === "naval");
    if (naval.length < 2) continue;

    // Each hostile pairing fights once. Sorted so the pairing order, and therefore the
    // result, does not depend on Mongo's return order.
    const present = [...new Set(naval.map((u) => u.countryId))].sort();
    const fought = new Set<string>();

    for (const a of present) {
      const enemies = hostility.get(a) ?? new Set<string>();
      for (const b of present) {
        if (a === b || !enemies.has(b)) continue;
        const pair = [a, b].sort().join(":");
        if (fought.has(pair)) continue;
        fought.add(pair);

        const result = resolveEngagement(
          region,
          naval.filter((u) => u.countryId === a),
          naval.filter((u) => u.countryId === b)
        );
        if (!result) continue;
        engagements.push(result.outcome);
        crippled.push(...result.crippled);
        for (const u of [...result.crippled, ...result.damaged]) touched.add(u);
      }
    }
  }

  // A crippled formation is not deleted, it is combat ineffective: `alive` reads its
  // integrity, so it drops out of the contest below without any roster surgery. It keeps
  // its general and its theater and rebuilds in place, which is the game's existing
  // convention for a mauled unit and the reason nothing here writes a delete.
  for (const [region, here] of byRegion) {
    byRegion.set(region, here.filter(alive));
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

  for (const u of touchedByMission) touched.add(u);
  const formationsLost = await persistCombatResults(db, touched);

  return {
    countriesProcessed: countries.size,
    regionsContested,
    channelsWritten,
    unitsStationed,
    engagementsFought: engagements.length,
    formationsLost: crippled.length,
    formationsUpdated: formationsLost,
    missionsAssigned,
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

/**
 * Write back what combat did to the formations that fought.
 *
 * An update, never a delete. Mirrors `persistSide` in the land battle path: personnel,
 * readiness and condition change, the command structure does not. A formation reduced to
 * nothing keeps its general and its theater and rebuilds in place.
 */
async function persistCombatResults(db: Db, touched: ReadonlySet<NavairUnit>): Promise<number> {
  if (!touched.size) return 0;
  const ops = [...touched].map((u) => ({
    updateOne: {
      filter: { _id: u._id },
      update: {
        $set: {
          personnel: u.personnel,
          readiness: u.readiness,
          integrity: u.integrity ?? 100,
          supply: u.supply ?? 100,
          station: u.station ?? null,
          mission: u.mission ?? null,
        },
      },
    },
  }));
  const res = await getMilitaryUnitsCollection(db).bulkWrite(ops, { ordered: false });
  return res.modifiedCount ?? 0;
}
