import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

export type UnitDomain = "ground" | "naval" | "air" | "rocket" | "space" | "marine";
export type Posture = "garrison" | "standard" | "forward" | "alert";

/** 0..4 → Green, Regular, Seasoned, Veteran, Elite. */
export type Veterancy = 0 | 1 | 2 | 3 | 4;

export interface UnitEquipment {
  firepower: number;
  protection: number;
  support: number;
}

export interface MilitaryUnit {
  _id: ObjectId;
  countryId: CountryId;
  branchId: string;
  domain: UnitDomain;
  name: string;
  type: string;
  icon: string;
  posture: Posture;
  techTier: 0 | 1 | 2 | 3;
  personnel: number;
  readiness: number; // 0-100
  basePower: number;
  upkeepBase: number; // M/turn before multipliers
  vet: Veterancy;
  xp: number;
  equipment: UnitEquipment;
  drill: string | null;
  theaterId: string; // warfront id; "reserve" = homeland garrison
  assignedGeneralId: string | null; // characterId of the leading general; null = General Staff (unassigned)
  createdTurn: number;
  /** Turn when this freshly-recruited unit becomes operational (null = ready now). */
  readyAtTurn?: number | null;

  // ── naval and air layer ────────────────────────────────────────────────────
  // Optional because a ground formation never carries them, and because they are
  // backfilled by the navairOperations phase rather than by a migration. Typed as plain
  // strings here rather than importing the navair unions, to keep the dependency running
  // one way: navair narrows these, this file does not know about navair.

  /**
   * Which region a naval or air formation physically occupies.
   *
   * `theaterId` says which WAR a unit belongs to, which is enough for a land front and
   * not enough for a fleet: two carriers in one war can be in different oceans.
   */
  station?: string | null;
  /**
   * True when a commander chose this station, rather than the engine deriving it.
   *
   * The engine re-derives a machine-assigned station every turn, so a change to the
   * placement rules corrects itself everywhere on the next tick. A player's order is
   * never overwritten. Without this a bad default was PERMANENT: the pass only assigned
   * a station when one was missing, so fixing the logic fixed nothing already placed and
   * every correction needed a database heal.
   */
  stationSetByPlayer?: boolean;
  /** Standing mission. Persists between turns; only a command changes it. */
  mission?: string | null;
  /** Region a strike mission is aimed at. Null for missions that take no target. */
  missionTarget?: string | null;
  /** Hull or airframe condition, 0..100. Distinct from readiness. */
  integrity?: number;
  /** Supply level at station, 0..100. Set by the naval and air sustain pass. */
  supply?: number;
}
