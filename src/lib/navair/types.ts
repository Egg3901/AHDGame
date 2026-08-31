import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { CountryId } from "@/lib/constants/countries";
import type { RegionCode } from "@/lib/military/types";

/**
 * Naval and air layer types.
 *
 * Built on `MilitaryUnit`, not beside it. A fleet is not a new kind of object: it is the
 * naval units a country already owns, with two things the schema does not carry yet, a
 * station and a mission. Everything else (readiness, veterancy, equipment, general,
 * upkeep, procurement) already works and must keep working.
 */

/**
 * What a naval formation is doing. Layered ON TOP of `MilitaryUnit.posture`, which stays
 * what it is: a generic readiness stance shared by every domain.
 *
 * Weights for each of these live in `config.NAVAL_MISSIONS`.
 */
export type NavalMission =
  "BLOCKADE" | "SEA_CONTROL" | "SEA_DENIAL" | "ESCORT" | "TRANSIT" | "PORT";

/** What an air formation is doing. Weights live in `config.AIR_MISSIONS`. */
export type AirMission =
  "CAP" | "STRIKE_NAVAL" | "STRIKE_AIRBASE" | "CAS" | "PATROL" | "AIRLIFT" | "STANDDOWN";

export type NavairMission = NavalMission | AirMission;

/**
 * The schema additions this subsystem needs on `MilitaryUnit`.
 *
 * Deliberately additive and optional. A ground unit never has either, and a naval unit
 * that has never been given orders falls back to a derived default rather than breaking.
 */
export interface NavairUnitFields {
  /**
   * Where this formation physically is.
   *
   * `MilitaryUnit.theaterId` says which WAR a unit belongs to, which is enough for a land
   * front and not enough for a fleet: two carriers in the same war can be in different
   * oceans, and that difference is the entire subsystem. Null means it has not put to sea
   * and is treated as sitting in its country's home region.
   */
  station?: RegionCode | null;
  /** Standing mission. Persists between turns; only a command changes it. */
  mission?: NavairMission | null;
  /** Region a strike mission is aimed at. Null for missions that take no target. */
  missionTarget?: RegionCode | null;
  /** Hull or airframe damage, 0..100 where 100 is undamaged. Distinct from readiness. */
  integrity?: number;
  /** Supply level at station, 0..100. Set by the sustain pass. */
  supply?: number;
  /**
   * Set when this formation fought this turn. Blocks repair: you mend between
   * engagements, not during one.
   *
   * In memory ONLY, and it must stay that way. `persistCombatResults` writes only the
   * formations it touched, so a stored `true` would never be cleared on a turn the
   * formation did not fight, and that hull's repair would be blocked for ever.
   */
  engaged?: boolean;
}

/** A naval or air unit: a `MilitaryUnit` in one of the two domains this layer resolves. */
export type NavairUnit = MilitaryUnit & NavairUnitFields;

/**
 * A side's persistent hold on one region.
 *
 * Per COUNTRY, per region, not per conflict. Control of the North Atlantic is a fact
 * about the North Atlantic, and one region can carry several wars at once. A battle
 * reads these by aggregating the countries on each side.
 *
 * Both are 0..100 and both decay. See `channels.ts` for the build and decay rates, which
 * come from measured values rather than invented ones.
 */
export interface RegionChannels {
  airSuperiority: number;
  seaControl: number;
  /** Detection level this country holds over the region, 0..3. */
  detection: number;
  /** Turn this record was last advanced, so a stale row can be caught up or trusted. */
  updatedTurn: number;
}

/** Persisted document: one row per country per region. */
export interface NavairChannelDoc {
  countryId: CountryId;
  region: RegionCode;
  airSuperiority: number;
  seaControl: number;
  detection: number;
  updatedTurn: number;
}

/**
 * What the naval and air layer hands a land battle.
 *
 * Four named values, each entering `battle.ts` at a different point. Keeping them
 * separate is what stops the subsystem collapsing back into one opaque multiplier, and
 * it is what lets a player be told why they are losing.
 */
export interface FrontSupport {
  /** Aggregated air superiority for this side over the front's region, 0..100. */
  airSuperiority: number;
  /** Aggregated sea control for this side in the adjacent water, 0..100. */
  seaControl: number;
  /** Additive combat weight delivered by close air support this turn. */
  casWeight: number;
  /** 0..1 reduction applied to the ENEMY side's supply throughput. */
  interdiction: number;
}

/** One surface action, recorded so the channel model can move sea control. */
export interface EngagementOutcome {
  region: RegionCode;
  winner: CountryId[];
  loser: CountryId[];
  /** Margin as a share of combined combat value, 0..100. */
  marginPct: number;
  sunk: string[];
}
