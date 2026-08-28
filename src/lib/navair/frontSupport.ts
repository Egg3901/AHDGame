import * as R from "./config";
import * as M from "./map";
import { baseCv, alive, archetypeRadius, clamp } from "./engineCore";
import { sideChannel } from "./channels";
import type { CountryId } from "@/lib/constants/countries";
import type { RegionCode } from "@/lib/military/types";
import type { NavairUnit, RegionChannels, FrontSupport } from "./types";

/**
 * What naval and air power is worth to a land battle.
 *
 * This is the point of the whole subsystem: ground troops are supported, or they are not,
 * and the difference is decided at sea and in the air before the land battle is fought.
 *
 * Four separate channels, each entering the battle at a different place. Keeping them
 * apart is deliberate. Collapsed into one multiplier, a commander cannot tell whether
 * they are losing because the sky is contested, because the sea lane is cut, or because
 * nobody flew close air support, and all three have different answers.
 */

/** An empty support profile: no air, no sea, no sorties flown. */
export const NO_SUPPORT: FrontSupport = {
  airSuperiority: 0,
  seaControl: 0,
  casWeight: 0,
  interdiction: 0,
};

/**
 * Close air support delivered to a front this turn.
 *
 * Only wings that are actually ON the close air support mission AND can physically reach
 * the front's region count. A fighter wing two oceans away on combat air patrol is doing
 * something useful, but it is not this.
 *
 * Scaled by `FRONT.casScale`, which is the measured conversion from air combat value to
 * ground effect. That constant was calibrated against a front where a wing's contribution
 * had to be worth flying without being worth more than the army.
 */
export function casWeightFor(
  units: readonly NavairUnit[],
  countries: readonly string[],
  frontRegion: RegionCode
): number {
  const side = new Set<string>(countries);
  let weight = 0;
  for (const u of units) {
    if (!alive(u) || u.domain !== "air" || u.mission !== "CAS") continue;
    if (!side.has(u.countryId) || !u.station) continue;
    if (!M.within(u.station, archetypeRadius(u)).includes(frontRegion)) continue;
    weight += baseCv(u);
  }
  return weight * R.FRONT.casScale;
}

/**
 * Interdiction: how much of the enemy's supply this side is cutting.
 *
 * Bombers striking behind a front, and blockade closing the sea lane that feeds it, both
 * starve an army without ever meeting it. Returned as a 0..1 reduction applied to the
 * ENEMY side's throughput, capped well short of 1 because no air force in this era ever
 * severed a theatre completely and a front that can be reduced to zero supply by air
 * alone makes the land war pointless.
 */
export function interdictionFor(
  units: readonly NavairUnit[],
  countries: readonly string[],
  frontRegion: RegionCode,
  seaControlHere: number
): number {
  const side = new Set<string>(countries);
  let strikeWeight = 0;
  for (const u of units) {
    if (!alive(u) || u.domain !== "air" || !u.station) continue;
    if (!side.has(u.countryId)) continue;
    if (u.mission !== "STRIKE_AIRBASE" && u.mission !== "STRIKE_NAVAL") continue;
    if (!M.within(u.station, archetypeRadius(u)).includes(frontRegion)) continue;
    strikeWeight += baseCv(u);
  }

  const fromAir = strikeWeight * INTERDICTION.perCombatValue;
  // A closed sea lane starves a coastal front too, but only where the sea can reach it.
  const coastal = M.isWaterAccessible(frontRegion) || M.neighbors(frontRegion).some(M.isNavigable);
  const fromSea = coastal ? (seaControlHere / 100) * INTERDICTION.fromSeaControl : 0;

  return clamp(fromAir + fromSea, 0, INTERDICTION.cap);
}

/**
 * Interdiction tuning.
 *
 * Not ported: the reference had no interdiction channel at all. These are first values
 * and the replay is what validates them, which is recorded here so nobody later mistakes
 * them for measured numbers.
 */
export const INTERDICTION = {
  /** Supply reduction per point of striking combat value. */
  perCombatValue: 0.00004,
  /** Supply reduction at total sea control, for a front the sea can reach. */
  fromSeaControl: 0.2,
  /**
   * Hard ceiling. An army cut off entirely stops being a war and starts being a
   * bookkeeping exercise, and the land layer already models encirclement its own way.
   */
  cap: 0.45,
} as const;

/**
 * The full support profile one side brings to a front.
 *
 * `channels` is the world's persisted per-country regional state; the side's holding is
 * the BEST of its members, not the sum, because the sky over a region is held by whoever
 * holds it hardest and averaging would punish a strong power for taking on weak allies.
 */
export function frontSupportFor(
  units: readonly NavairUnit[],
  channels: ReadonlyMap<string, RegionChannels>,
  countries: readonly string[],
  frontRegion: RegionCode
): FrontSupport {
  const airSuperiority = sideChannel(channels, countries, frontRegion, "airSuperiority");

  // Sea control that matters to a land front is the water NEXT to it, not the land tile
  // itself, so take the best adjacent water this side holds.
  const adjacentWater = [frontRegion, ...M.neighbors(frontRegion)].filter(M.isWaterAccessible);
  let seaControl = 0;
  for (const w of adjacentWater) {
    const here = sideChannel(channels, countries, w as RegionCode, "seaControl");
    if (here > seaControl) seaControl = here;
  }

  return {
    airSuperiority,
    seaControl,
    casWeight: casWeightFor(units, countries, frontRegion),
    interdiction: interdictionFor(units, countries, frontRegion, seaControl),
  };
}

/**
 * Whether a marine formation can land across water onto this front.
 *
 * The one place sea control touches the ground directly. Below the threshold the
 * reinforcement does not arrive; marines already ashore fight normally regardless,
 * because the sea decides whether you can land, not how you fight once you have.
 */
export function canLandMarines(seaControl: number): boolean {
  return seaControl >= MARINE_LANDING_THRESHOLD;
}

/**
 * Sea control needed to put marines ashore.
 *
 * Set above parity on purpose. An opposed landing into contested water is the single most
 * dangerous operation in this era, and letting it happen at 50 would make amphibious
 * assault the default answer to any coastal front.
 */
export const MARINE_LANDING_THRESHOLD = 65;
