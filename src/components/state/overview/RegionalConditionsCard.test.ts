import { describe, expect, it } from "vitest";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { splitConditionForces } from "./RegionalConditionsCard";

function mod(
  partial: Partial<ActiveModifier> & Pick<ActiveModifier, "id" | "label" | "effect">
): ActiveModifier {
  return partial;
}

describe("splitConditionForces", () => {
  it("splits boosts and maluses and totals each side", () => {
    const mods = [
      mod({ id: "a", label: "Economic Boom", effect: 2 }),
      mod({ id: "b", label: "Low Poverty", effect: 1 }),
      mod({ id: "c", label: "Rising Inequality", effect: -1 }),
      mod({ id: "d", label: "High Immigration", effect: -2 }),
    ];

    const result = splitConditionForces(mods);

    expect(result.tailwinds.map((m) => m.id)).toEqual(["a", "b"]);
    expect(result.headwinds.map((m) => m.id)).toEqual(["c", "d"]);
    expect(result.boostTotal).toBe(3);
    expect(result.dragTotal).toBe(-3);
  });

  it("handles empty and one-sided lists", () => {
    expect(splitConditionForces([])).toEqual({
      tailwinds: [],
      headwinds: [],
      boostTotal: 0,
      dragTotal: 0,
    });

    const onlyBoost = [mod({ id: "a", label: "Boom", effect: 2 })];
    const boostOnly = splitConditionForces(onlyBoost);
    expect(boostOnly.boostTotal).toBe(2);
    expect(boostOnly.dragTotal).toBe(0);
    expect(boostOnly.headwinds).toHaveLength(0);
  });

  /**
   * This card is region scoped. The war block is national and reaches into the
   * twenties, so if it ever arrived here it would swamp the balance bar and
   * misattribute a national effect to one region.
   */
  it("leaves the national war block out of a regional balance", () => {
    const mods = [
      mod({ id: "a", label: "Boom", effect: 2 }),
      mod({ id: "war", label: "War", effect: -8, source: "war" }),
    ];
    const result = splitConditionForces(mods);
    expect(result.headwinds).toHaveLength(0);
    expect(result.dragTotal).toBe(0);
  });
});
