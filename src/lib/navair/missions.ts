import * as M from "./map";
import { homeRegionOf } from "@/lib/military/regionTopology";
import { tradeApproaches } from "./blockade";
import type { RegionCode } from "@/lib/military/types";
import type { NavairUnit, NavairMission, NavalMission, AirMission } from "./types";

/**
 * Standing missions for formations nobody has given orders to.
 *
 * This is what makes the subsystem live rather than inert. A mission is stored on the
 * unit and persists until a commander changes it, but most of the world is run by nobody:
 * NPC countries, players who have not opened the war room, and every unit that existed
 * before this subsystem did. Without a sensible default, every navy in the game sits in
 * port with a null mission and nothing ever happens.
 *
 * Deliberately NOT an AI. There is no search, no scoring, no per turn re-planning. It is
 * a small set of doctrine rules that answer "what would this formation obviously be doing"
 * from facts already on the unit. That keeps it cheap enough to run for every formation in
 * the world every turn, and predictable enough that a player can out-think it, which is
 * the point of giving players orders at all.
 */

export interface MissionContext {
  /** Countries this formation's owner is at war with. */
  enemies: ReadonlySet<string>;
  /** Regions where a land front this country is fighting on sits. */
  frontRegions: ReadonlySet<RegionCode>;
  /** True when a hostile naval formation is stationed in the same region. */
  contestedHere: boolean;
  /** True when a hostile air formation is operating over this region. */
  airContestedHere: boolean;
}

/** Damage below which a formation should be going home rather than fighting. */
export const WITHDRAW_INTEGRITY = 35;

/** Readiness below which a formation is too worn to sustain an aggressive posture. */
export const WITHDRAW_READINESS = 25;

/**
 * The mission a naval formation would obviously be flying, absent orders.
 *
 * Order of the checks IS the doctrine, and it reads as a priority list a staff officer
 * would recognise: save the ship, then fight what is in front of you, then squeeze the
 * enemy, then go home.
 */
export function defaultNavalMission(unit: NavairUnit, ctx: MissionContext): NavalMission {
  // A wreck is worth more repaired than sunk. This is first so a damaged fleet withdraws
  // instead of grinding itself to nothing in a fight it is already losing.
  if ((unit.integrity ?? 100) < WITHDRAW_INTEGRITY) return "PORT";
  if (unit.readiness < WITHDRAW_READINESS) return "PORT";

  // Peacetime is not a posture, it is an absence of one. Sitting at sea in peace costs
  // readiness and buys nothing.
  if (!ctx.enemies.size) return "PORT";

  // Something hostile is here. You are in a fight whether or not you wanted one, so be in
  // it properly rather than being caught in transit.
  if (ctx.contestedHere) return "SEA_CONTROL";

  // A submarine's value is being hard to find, not standing in the line. Giving it sea
  // control would spend the one advantage it has.
  if (unit.type === "Attack Submarine") return "SEA_DENIAL";

  // Nothing to fight here, so apply pressure instead: this is water the enemy needs.
  if (isEnemyApproach(unit.station, ctx.enemies)) return "BLOCKADE";

  return "TRANSIT";
}

/**
 * The mission an air formation would obviously be flying, absent orders.
 *
 * Air defaults toward supporting the ground war, because that is what air power is for in
 * this game and because a wing that defaults to patrolling empty sky is a wing the player
 * has to micromanage to make useful.
 */
export function defaultAirMission(unit: NavairUnit, ctx: MissionContext): AirMission {
  if ((unit.integrity ?? 100) < WITHDRAW_INTEGRITY) return "STANDDOWN";
  if (unit.readiness < WITHDRAW_READINESS) return "STANDDOWN";
  if (!ctx.enemies.size) return "STANDDOWN";

  // An air defence wing does one thing. Sending it to support a ground attack would be
  // using it as a worse fighter wing.
  if (unit.type === "Air Defense Wing") return "CAP";

  // Contested sky first: close air support flown into an uncontested enemy fighter screen
  // is how you lose an air force without moving the front.
  if (ctx.airContestedHere) return "CAP";

  // Transport does not fight. Keeping the fleet and the front supplied is its whole job.
  if (unit.type === "Airlift Wing") return "AIRLIFT";

  // The land war is the point. Support it if this wing can reach it.
  if (canReachFront(unit, ctx.frontRegions)) return "CAS";

  return "PATROL";
}

/** Dispatch on domain. Returns null for a formation this subsystem does not command. */
export function defaultMissionFor(unit: NavairUnit, ctx: MissionContext): NavairMission | null {
  if (unit.domain === "naval") return defaultNavalMission(unit, ctx);
  if (unit.domain === "air") return defaultAirMission(unit, ctx);
  return null;
}

/** Is this water on an approach one of the enemies depends on? */
function isEnemyApproach(
  station: RegionCode | null | undefined,
  enemies: ReadonlySet<string>
): boolean {
  if (!station) return false;
  for (const enemy of enemies) {
    if (tradeApproaches(homeRegionOf(enemy)).includes(station)) return true;
  }
  return false;
}

/** Can this wing physically reach a front its country is fighting on? */
function canReachFront(unit: NavairUnit, frontRegions: ReadonlySet<RegionCode>): boolean {
  if (!unit.station || !frontRegions.size) return false;
  const radius = unit.type === "Bomber Squadron" || unit.type === "Airlift Wing" ? 2 : 1;
  for (const region of M.within(unit.station, radius)) {
    if (frontRegions.has(region as RegionCode)) return true;
  }
  return false;
}

/** Every naval posture a commander may order. */
export const NAVAL_MISSIONS_ORDERABLE: readonly NavalMission[] = [
  "BLOCKADE",
  "SEA_CONTROL",
  "SEA_DENIAL",
  "ESCORT",
  "TRANSIT",
  "PORT",
];

/** Every air mission a commander may order. */
export const AIR_MISSIONS_ORDERABLE: readonly AirMission[] = [
  "CAP",
  "STRIKE_NAVAL",
  "STRIKE_AIRBASE",
  "CAS",
  "PATROL",
  "AIRLIFT",
  "STANDDOWN",
];

/**
 * Whether this mission may be ordered for this domain.
 *
 * Checked server side and never inferred from the client, because a naval formation on
 * an air mission would fall through `navalPosture` to the flying-weights fallback and
 * quietly fight at half value forever, with nothing in the UI to say why.
 */
export function isMissionValidFor(domain: string, mission: string): boolean {
  if (domain === "naval") return (NAVAL_MISSIONS_ORDERABLE as readonly string[]).includes(mission);
  if (domain === "air") return (AIR_MISSIONS_ORDERABLE as readonly string[]).includes(mission);
  return false;
}

/** Missions that require a target region to mean anything. */
export function missionNeedsTarget(mission: string): boolean {
  return mission === "STRIKE_NAVAL" || mission === "STRIKE_AIRBASE";
}
