import { ObjectId } from "mongodb";
import { natMods } from "../doctrineTree";
import type { BattleContext, BattleSide } from "../battle";
import { type CombatUnit, type Front } from "../combat";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Shared battle fixtures.
 *
 * Lifted out of `battle.test.ts` so the coalition tests build sides exactly the way
 * the existing battle tests do — if the two files grew their own builders, a
 * "coalition matches solo" assertion would be comparing two different fixtures
 * rather than two code paths.
 */

/** The fronts in play, keyed by theaterId — the live-conflict map a context carries. */
export const front = (id: string, over: Partial<Front> = {}): Front => ({
  id,
  name: id,
  region: id,
  terrain: "Arid / mountainous",
  contested: id !== "reserve",
  terr: id === "reserve" ? 1.0 : 1.15,
  infra: id === "reserve" ? 100 : 40,
  enemyMix: ["armor", "mech", "infantry", "arty", "air", "airdef"],
  ...over,
});

export const FRONTS_MAP: Record<string, Front> = {
  reserve: front("reserve", { terrain: "Rear area", enemyMix: undefined }),
  afghan: front("afghan"),
  angola: front("angola", { terrain: "Savanna" }),
};

export function unit(over: Partial<CombatUnit> = {}): CombatUnit {
  return {
    _id: new ObjectId(),
    countryId: "US",
    branchId: "army",
    domain: "ground",
    name: "1st Armored Division",
    type: "Armored Division",
    icon: "tank",
    basePower: 92,
    personnel: 15000,
    upkeepBase: 180,
    posture: "standard",
    techTier: 2,
    vet: 1,
    xp: 0,
    readiness: 70,
    equipment: { firepower: 1, protection: 1, support: 1 },
    drill: null,
    theaterId: "afghan",
    assignedGeneralId: null,
    createdTurn: 1,
    ...over,
  };
}

export function ctx(units: CombatUnit[]): BattleContext {
  return {
    units,
    positions: {},
    assignments: [],
    generalsById: {},
    natMods: natMods({}),
    countryScale: 2.6,
    side: "A",
    fronts: FRONTS_MAP,
  };
}

/**
 * One country's contingent: `basePowers` becomes that many units at `theaterId`.
 *
 * `side` is which end of the conflict it fights on. It replaced a `bloc` argument —
 * only report naming ever read that, and reading it from a global bloc table got the
 * answer wrong for any country the table omitted.
 */
export function side(
  country: string,
  conflictSide: "A" | "B",
  basePowers: number[],
  theaterId: string
): BattleSide {
  return {
    units: basePowers.map((bp) =>
      unit({ _id: new ObjectId(), countryId: country as CountryId, basePower: bp, theaterId })
    ),
    assignments: [],
    generalsById: {},
    positions: {},
    natMods: natMods({}),
    countryScale: 2.6,
    side: conflictSide,
    country,
    fronts: FRONTS_MAP,
  };
}
