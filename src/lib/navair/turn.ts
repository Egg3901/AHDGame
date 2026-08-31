import type { Db } from "mongodb";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { loadMilitaryBlocs } from "@/lib/military/blocLookup";
import { homeRegionOf } from "@/lib/military/regionTopology";
import { navalStationFor } from "./map";
import { conflictRegions } from "@/lib/military/conflictRegions";
import { recordNavairEngagements } from "@/lib/db/collections/navairEngagements";
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
import { resolveEngagement, engagementControlBonus } from "./engagement";
import { defaultMissionFor } from "./missions";
import { isWithdrawing, repairedIntegrity } from "./repair";
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
  /** Formations that recovered hull or airframe condition this turn. */
  formationsRepaired: number;
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
  /** theaterId -> the region that conflict is fought in. */
  theaterRegion: Map<string, RegionCode>;
  /** Active conflicts, so engagements can be fought side against side. */
  conflicts: Array<{ id: string; region?: RegionCode; a: string[]; b: string[] }>;
}

async function buildWarContext(db: Db): Promise<WarContext> {
  // Projection passed as a find option rather than via the cursor's .project(), which is
  // this codebase's house style and does not require a cursor implementation of it.
  const conflicts = (await getConflictsCollection(db)
    .find(
      { status: "active" },
      { projection: { "sideA.countries": 1, "sideB.countries": 1, region: 1, extendedRegions: 1 } }
    )
    .toArray()) as unknown as Array<{
    _id?: unknown;
    sideA?: { countries?: string[] };
    sideB?: { countries?: string[] };
    region?: RegionCode;
    extendedRegions?: RegionCode[];
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
    // Every region the war has spread into, not just where it started. A war confined to
    // its opening region would leave air based on a newly opened flank unable to see a
    // front it is standing next to.
    if (c.region) {
      for (const r of conflictRegions({ region: c.region, extendedRegions: c.extendedRegions })) {
        for (const country of [...a, ...b]) front(country, r);
      }
    }
  }
  const theaterRegion = new Map<string, RegionCode>();
  for (const c of conflicts) {
    if (c.region && c._id) theaterRegion.set(String(c._id), c.region);
  }

  const sides = conflicts.map((c) => ({
    id: String(c._id),
    region: c.region,
    a: c.sideA?.countries ?? [],
    b: c.sideB?.countries ?? [],
  }));

  return { hostility, frontRegions, theaterRegion, conflicts: sides };
}

/**
 * Where a formation is, falling back to its country's home region.
 *
 * A unit that has never been given a station is in home waters, not nowhere. Returning
 * null here instead would quietly drop every un-commanded fleet out of the contest, and
 * the symptom would be an empty ocean rather than an error.
 */
export function stationOf(
  unit: NavairUnit,
  theaterRegion?: ReadonlyMap<string, RegionCode>
): RegionCode | null {
  // A commander's order stands. Everything else is re-derived every turn, so a change to
  // the placement rules takes effect everywhere on the next tick instead of only for
  // formations that happen to have no station yet.
  if (unit.station && unit.stationSetByPlayer) return unit.station;

  // A formation ASSIGNED to a war is at that war, not sitting at home. Falling back to
  // the home region first was wrong in a way that quietly broke the whole point: US air
  // deployed to a European front read as stationed in North America, three hops from the
  // fighting, so it could never fly close air support and never contested the sky over
  // the front it was actually committed to. The symptom was an air term stuck at neutral
  // forever, with nothing anywhere saying why.
  const atWar = unit.theaterId && unit.theaterId !== "reserve";
  const base =
    (atWar ? theaterRegion?.get(unit.theaterId) : undefined) ?? homeRegionOf(unit.countryId);
  if (!base) return null;

  // A ship cannot be on dry land. A fleet committed to an inland front bases in the
  // nearest navigable water instead, which is where it would actually be. Putting it on
  // the front's own land region was worse than cosmetic: sea control over a land tile is
  // read by nothing, so a dominant navy changed nothing anywhere.
  if (unit.domain === "naval") {
    return navalStationFor(base, homeRegionOf(unit.countryId)) as RegionCode | null;
  }

  return base;
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
      formationsRepaired: 0,
    };
  }

  const [war, blocs, channels] = await Promise.all([
    buildWarContext(db),
    loadMilitaryBlocs(db),
    loadNavairChannels(db),
  ]);
  const { hostility, frontRegions, theaterRegion, conflicts: warSides } = war;

  // ── station everything, then index by region ────────────────────────────────
  const touchedByMission = new Set<NavairUnit>();
  const byRegion = new Map<RegionCode, NavairUnit[]>();
  const countries = new Set<CountryId>();
  let unitsStationed = 0;

  for (const u of units) {
    if (!alive(u)) continue;
    const station = stationOf(u, theaterRegion);
    if (!station) continue;
    if (u.station !== station) {
      // The derived station disagrees with what is stored, so write it. That covers both
      // a formation being placed for the first time and one whose placement rules have
      // since changed: the second case is why this compares rather than checking for
      // absence. Fixing the geography once corrected nothing already on the map, and the
      // only remedy was a database heal, which a turn then undid.
      //
      // It is also why this subsystem needs no migration: placement converges on the
      // first turn after any deploy.
      unitsStationed++;
      touchedByMission.add(u);
    }
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

  // A formation fights at most once a turn, whatever it is at war with. The previous
  // pairing was country against country, so a fleet facing three enemies fought three
  // separate actions and took damage in each, every one costed as if it were the only
  // action that turn. Losses scaled with the NUMBER of enemies rather than their
  // strength, which breaks precisely when a coalition forms.
  const alreadyFought = new Set<string>();

  for (const [region, here] of byRegion) {
    const naval = here.filter((u) => u.domain === "naval");
    if (naval.length < 2) continue;

    for (const war of warSides) {
      const inA = naval.filter(
        (u) => war.a.includes(u.countryId) && !alreadyFought.has(String(u._id))
      );
      const inB = naval.filter(
        (u) => war.b.includes(u.countryId) && !alreadyFought.has(String(u._id))
      );
      if (!inA.length || !inB.length) continue;

      // One action, both coalitions in the line together, exactly as the land battle
      // treats a coalition front.
      const result = resolveEngagement(region, inA, inB);
      if (!result) continue;

      for (const u of [...inA, ...inB]) alreadyFought.add(String(u._id));
      engagements.push(result.outcome);
      crippled.push(...result.crippled);
      for (const u of [...result.crippled, ...result.damaged]) touched.add(u);
    }
  }

  // A crippled formation is not deleted, it is combat ineffective: `alive` reads its
  // integrity, so it drops out of the contest below without any roster surgery. It keeps
  // its general and its theater and rebuilds in place, which is the game's existing
  // convention for a mauled unit and the reason nothing here writes a delete.
  for (const [region, here] of byRegion) {
    byRegion.set(region, here.filter(alive));
  }

  // Winning the water is worth more than sitting in it. Capped well below the full scale
  // by `engagementControlBonus`, so one good turn cannot hand over a region the loser has
  // held for twenty: the contest still has to be won by staying.
  const controlBonus = new Map<string, number>();
  for (const outcome of engagements) {
    const bonus = engagementControlBonus(outcome.marginPct);
    for (const c of outcome.winner) {
      const key = channelKey(c, outcome.region);
      controlBonus.set(key, Math.max(controlBonus.get(key) ?? 0, bonus));
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

      // A country at peace is not "winning" the sky over its own coast, it is simply
      // unopposed, and treating that as full control let a coalition inherit a freshly
      // joined ally's stale 100 for the several turns it takes to decay. Only a country
      // with something to contest builds a holding.
      const contested = sea.hostile > 0 || air.hostile > 0 || enemies.size > 0;
      if (!contested) continue;

      const current = channelsFor(channels, countryId, region, turn);
      const next = advanceChannels(current, { air, sea }, detection.get(region) ?? 0, turn);
      const bonus = controlBonus.get(channelKey(countryId, region)) ?? 0;
      if (bonus > 0) next.seaControl = Math.min(100, next.seaControl + bonus);
      updates.push({ countryId, region, channels: next });
      channels.set(channelKey(countryId, region), next);
    }
  }

  const channelsWritten = await saveNavairChannels(db, updates);

  // Repair runs HERE, after the contest, and the ordering is load-bearing. It changes a
  // formation's station, supply and integrity, and `byRegion` above still indexes every
  // hull by where it was at the start of the turn. Repairing before the contest therefore
  // let a hull that had just withdrawn home go on contesting the water it left, at the
  // better supply it found at home — a fleet in two places at once, slightly winning.
  // ── repair ──────────────────────────────────────────────────────────────────
  // Iterates `units` rather than `byRegion` deliberately. Two `alive` gates above have
  // already dropped crippled hulls from `byRegion`, and a hull at zero integrity was
  // never stationed in the first place — which is exactly why zero was permanent and the
  // UK's entire navy sat unrecoverable on the live world. Reading the flat roster reaches
  // those hulls without moving either gate, so berth demand, overcrowding and the contest
  // are all untouched by this step.
  let formationsRepaired = 0;
  for (const u of units) {
    const before = u.integrity ?? 100;

    // A formation too damaged to fight withdraws to home water to mend, unless a
    // commander deliberately stationed it where it is. `WITHDRAW_INTEGRITY` is the same
    // threshold `defaultNavalMission` already uses for "save the ship" — reusing it keeps
    // one doctrine rather than inventing a second.
    //
    // Withdrawing has to persist for as long as it takes, not for one turn. `stationOf`
    // sends any formation with a theater straight back to the front, and a front is
    // exactly where supply is too low for `supplyScale` to allow any repair at all — so a
    // hull nudged off zero and immediately redeployed would stick a few points above zero
    // forever. That is the plateau the config's own docblock warns about.
    const withdrawing = isWithdrawing(u);
    const stationBefore = u.station;
    if (withdrawing) {
      const home = homeRegionOf(u.countryId);
      if (home) u.station = home as RegionCode;
    }

    const station = u.station as RegionCode | null | undefined;
    if (!station) continue;

    const basing = basingStatus(
      station,
      u.countryId,
      blocs,
      hostility.get(u.countryId) ?? new Set<string>()
    );

    // A hull at zero never passed the `alive` gate above, so it was never stationed and
    // the sustain pass never gave it a supply figure. Without this its repair would be
    // scaled by a reading from whenever it was last seaworthy.
    if (before <= 0 || withdrawing) {
      u.supply = supplyCeiling(u, basing, 0, false);
    }

    // A withdrawn formation is in a yard by definition, whatever its last standing order
    // said. One left forward under orders mends by the ordinary rules, which for a fleet
    // sitting in unsupplied water correctly means barely at all.
    u.integrity = withdrawing
      ? repairedIntegrity({ ...u, mission: "PORT" }, basing)
      : repairedIntegrity(u, basing);

    const mended = (u.integrity ?? 100) !== before;
    if (mended) formationsRepaired++;
    // The move home is persisted even on a turn that mends nothing. A formation that
    // withdrew and then fought recovers no condition, so keying the write on the repair
    // alone silently dropped the station change and left it at the front.
    if (mended || u.station !== stationBefore) touched.add(u);
  }

  for (const u of touchedByMission) touched.add(u);
  const rowsWritten = await persistCombatResults(db, touched);
  // Record what was fought so players can read the sea war. Nothing reads these back;
  // an invisible war is one nobody can play.
  await recordNavairEngagements(db, turn, engagements);

  return {
    countriesProcessed: countries.size,
    regionsContested,
    channelsWritten,
    unitsStationed,
    engagementsFought: engagements.length,
    formationsLost: crippled.length,
    formationsUpdated: rowsWritten,
    missionsAssigned,
    formationsRepaired,
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
          // Preserved deliberately: writing `false` here would erase a commander's
          // decision on the first turn after they made it, and the engine would quietly
          // start moving their fleet again.
          stationSetByPlayer: u.stationSetByPlayer === true,
        },
      },
    },
  }));
  const res = await getMilitaryUnitsCollection(db).bulkWrite(ops, { ordered: false });
  return res.modifiedCount ?? 0;
}
