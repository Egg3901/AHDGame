import { describe, it, expect } from "vitest";
import { resolvePvpBattle } from "../battle";
import { side, unit } from "./battleFixtures";
import type { CountryId } from "@/lib/constants/countries";
import { ObjectId } from "mongodb";

const T = "afghan";
const SEED = 4242;

/**
 * The readiness a battle leaves, per unit id.
 *
 * Readiness used to be ASSIGNED a level scaled by `armorMit` and the role's casualty
 * weight. Both terms correctly reduce CASUALTIES on the line above; applied to a level
 * they invert, so armour and safe roles left a unit more exhausted. These tests pin the
 * subtraction that replaces it, and the operational-tempo escalator it enables.
 */
function fight(attackerUnits: ReturnType<typeof unit>[], readiness?: number) {
  const att = side("US", "A", [100], T);
  att.units = attackerUnits.map((u) =>
    unit({ ...u, readiness: readiness ?? u.readiness, theaterId: T })
  );
  const def = side("CN", "B", [100, 100], T);
  const r = resolvePvpBattle([att], [def], T, SEED);
  const out = new Map<string, number>();
  for (const u of r.attacker.unitResults) out.set(u.id, u.readiness);
  return out;
}

const mk = (over: Record<string, unknown>) =>
  unit({ _id: new ObjectId(), countryId: "US" as CountryId, theaterId: T, ...over });

describe("readiness ledger", () => {
  it("spends less on an armoured formation than an unarmoured one", () => {
    // `armorMit` protects the crew. It must reduce what the battle takes out of them,
    // not leave a tank division more exhausted than the infantry beside it.
    const armor = mk({ type: "Armored Division", basePower: 90 });
    const infantry = mk({ type: "Infantry Division", basePower: 90 });
    const after = fight([armor, infantry], 90);
    const armorDrop = 90 - after.get(String(armor._id))!;
    const infantryDrop = 90 - after.get(String(infantry._id))!;
    expect(armorDrop).toBeLessThan(infantryDrop);
  });

  it("spends less on a rear formation than a frontline one", () => {
    // Exposure should cost stamina. A carrier that lost three men ending more exhausted
    // than an infantry division that lost thousands was the clearest symptom.
    const front = mk({ type: "Infantry Division", basePower: 90 });
    const rear = mk({ type: "Artillery Regiment", basePower: 90 });
    const after = fight([front, rear], 90);
    expect(90 - after.get(String(rear._id))!).toBeLessThan(90 - after.get(String(front._id))!);
  });

  it("charges a worn formation MORE than a fresh one for the same battle", () => {
    // The tempo escalator, and the whole point of the change: continuous pace leaves
    // little room for rest. Under the old assignment a worn unit was charged LESS,
    // because the level it was pinned to was already below where it stood.
    const u = mk({ type: "Infantry Division", basePower: 90 });
    const fresh = 92 - fight([u], 92).get(String(u._id))!;
    const worn = 40 - fight([u], 40).get(String(u._id))!;
    expect(worn).toBeGreaterThan(fresh);
  });

  it("never pushes readiness below the floor or above where it started", () => {
    const u = mk({ type: "Infantry Division", basePower: 90 });
    for (const start of [3, 8, 40, 92]) {
      const end = fight([u], start).get(String(u._id))!;
      expect(end).toBeGreaterThanOrEqual(3);
      expect(end).toBeLessThanOrEqual(start);
    }
  });

  it("is deterministic for a seed", () => {
    const u = mk({ type: "Infantry Division", basePower: 90 });
    expect(fight([u], 80).get(String(u._id))).toBe(fight([u], 80).get(String(u._id)));
  });
});
