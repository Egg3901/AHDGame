import { describe, it, expect } from "vitest";
import { planEngagement, battleForecast, resolvePvpBattle } from "../battle";
import { side, unit, FRONTS_MAP } from "./battleFixtures";
import { FRONT_CAPACITY_BASE, TERRAIN_CAPACITY } from "../config";
import { capacityOfTerrain } from "../combat";
import type { CountryId } from "@/lib/constants/countries";
import { ObjectId } from "mongodb";

const T = "afghan";

/** A side of `n` identical formations, so only the cap can separate them. */
function force(country: string, n: number, type = "Infantry Division") {
  const s = side(country, "A", new Array(n).fill(90), T);
  s.units = s.units.map(() =>
    unit({
      _id: new ObjectId(),
      countryId: country as CountryId,
      type,
      theaterId: T,
      basePower: 90,
    })
  );
  return s;
}

const ctxOf = (s: ReturnType<typeof force>) => ({
  units: s.units,
  positions: s.positions,
  assignments: s.assignments,
  generalsById: s.generalsById,
  natMods: s.natMods,
  countryScale: s.countryScale,
  side: s.side,
  fronts: s.fronts,
});

describe("capacityOfTerrain", () => {
  it("gives open ground the base and constricted ground less", () => {
    expect(capacityOfTerrain("Plain / forest")).toBe(
      FRONT_CAPACITY_BASE * TERRAIN_CAPACITY.temperate
    );
    expect(capacityOfTerrain("Arid / mountainous")).toBeLessThan(
      capacityOfTerrain("Plain / forest")
    );
    expect(capacityOfTerrain("Jungle / delta")).toBeLessThan(capacityOfTerrain("Plain / forest"));
  });

  it("falls back to the base for terrain it does not recognise", () => {
    // `terrainFactor` returns 1 rather than inventing a family; this matches that.
    expect(capacityOfTerrain("Rear area")).toBe(FRONT_CAPACITY_BASE);
    expect(capacityOfTerrain(undefined)).toBe(FRONT_CAPACITY_BASE);
  });
});

describe("planEngagement", () => {
  it("puts everyone in contact when the side fits", () => {
    const s = force("US", 3);
    const plan = planEngagement([ctxOf(s)], T, 100000);
    expect(plan.inContact.size).toBe(3);
    expect(plan.roleOf.size).toBe(0);
  });

  it("holds the overflow in depth once the front is full", () => {
    const s = force("US", 30);
    const plan = planEngagement([ctxOf(s)], T, 200);
    expect(plan.inContact.size).toBeGreaterThan(0);
    expect(plan.inContact.size).toBeLessThan(30);
    // Everything not in contact is reassigned, and to the rear treatment.
    for (const u of s.units) {
      const id = String(u._id);
      if (!plan.inContact.has(id)) expect(plan.roleOf.get(id)).toBe("rear");
    }
  });

  it("always keeps one formation in contact, however small the front", () => {
    // A side that fielded nothing would not be a battle.
    const s = force("US", 4);
    expect(planEngagement([ctxOf(s)], T, 0).inContact.size).toBe(1);
  });

  it("is deterministic, so a report does not vary between ticks", () => {
    const s = force("US", 20);
    const a = planEngagement([ctxOf(s)], T, 300);
    const b = planEngagement([ctxOf(s)], T, 300);
    expect([...a.inContact].sort()).toEqual([...b.inContact].sort());
  });

  it("spends ONE budget across a coalition, not one each", () => {
    // The cap is a property of the front. Two allies do not each get a full front.
    const a = force("US", 10);
    const b = force("UK", 10);
    const solo = planEngagement([ctxOf(a)], T, 300).inContact.size;
    const pair = planEngagement([ctxOf(a), ctxOf(b)], T, 300).inContact.size;
    expect(pair).toBeLessThanOrEqual(solo + 1);
  });

  it("ignores formations posted to another front", () => {
    const s = force("US", 5);
    s.units = s.units.map((u, i) => ({ ...u, theaterId: i < 2 ? T : "elsewhere" }));
    const plan = planEngagement([ctxOf(s)], T, 100000);
    expect(plan.inContact.size).toBe(2);
  });
});

describe("front capacity in the battle math", () => {
  it("stops a superstack from bringing everything to bear", () => {
    const enemy = force("CN", 3);
    enemy.side = "B";
    const huge = force("US", 40);
    const uncapped = { ...FRONTS_MAP, [T]: { ...FRONTS_MAP[T]!, capacity: 1e9 } };
    const capped = { ...FRONTS_MAP, [T]: { ...FRONTS_MAP[T]!, capacity: 300 } };
    const a = battleForecast([{ ...huge, fronts: uncapped }], [{ ...enemy, fronts: uncapped }], T);
    const b = battleForecast([{ ...huge, fronts: capped }], [{ ...enemy, fronts: capped }], T);
    expect(b.attStr).toBeLessThan(a.attStr);
  });

  it("stops casualties scaling with a force that never reached the line", () => {
    // The defect this exists to fix: side casualties went as ~0.6N + 1, so committing
    // more men cost more men even when they could not all fight.
    const enemy = force("CN", 3);
    enemy.side = "B";
    const huge = force("US", 40);
    const uncapped = { ...FRONTS_MAP, [T]: { ...FRONTS_MAP[T]!, capacity: 1e9 } };
    const capped = { ...FRONTS_MAP, [T]: { ...FRONTS_MAP[T]!, capacity: 300 } };
    const a = resolvePvpBattle(
      [{ ...huge, fronts: uncapped }],
      [{ ...enemy, fronts: uncapped }],
      T,
      99
    );
    const b = resolvePvpBattle(
      [{ ...huge, fronts: capped }],
      [{ ...enemy, fronts: capped }],
      T,
      99
    );
    expect(b.attacker.loss).toBeLessThan(a.attacker.loss);
  });

  it("leaves a side that fits the front completely unchanged", () => {
    const enemy = force("CN", 3);
    enemy.side = "B";
    const small = force("US", 2);
    const wide = { ...FRONTS_MAP, [T]: { ...FRONTS_MAP[T]!, capacity: 1e9 } };
    const narrow = { ...FRONTS_MAP, [T]: { ...FRONTS_MAP[T]!, capacity: 100000 } };
    const a = battleForecast([{ ...small, fronts: wide }], [{ ...enemy, fronts: wide }], T);
    const b = battleForecast([{ ...small, fronts: narrow }], [{ ...enemy, fronts: narrow }], T);
    expect(b.attStr).toBeCloseTo(a.attStr, 6);
  });
});
