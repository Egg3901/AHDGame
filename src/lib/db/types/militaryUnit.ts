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
}
