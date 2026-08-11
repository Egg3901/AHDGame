import { describe, it, expect } from "vitest";
import {
  deriveGoverningArchetype,
  governingArchetypeModifiers,
  GOVERNING_ARCHETYPE_MODIFIERS,
  GOVERNING_ARCHETYPE_CLAMP,
  clampSpendAppetite,
  type GoverningArchetype,
} from "./governingArchetype";
import type { NPPPersonality } from "@/lib/db/types/npp";

function p(ambition: number, stubbornness: number, loyalty = 50): NPPPersonality {
  return { ambition, stubbornness, loyalty };
}

describe("deriveGoverningArchetype", () => {
  it("maps high ambition + low stubbornness to reformer", () => {
    expect(deriveGoverningArchetype(p(80, 20))).toBe("reformer");
  });
  it("maps high ambition + high stubbornness to ideologue", () => {
    expect(deriveGoverningArchetype(p(80, 80))).toBe("ideologue");
  });
  it("maps low ambition + high stubbornness to steward", () => {
    expect(deriveGoverningArchetype(p(20, 80))).toBe("steward");
  });
  it("maps low ambition + low stubbornness to technocrat", () => {
    expect(deriveGoverningArchetype(p(20, 20))).toBe("technocrat");
  });
  it("treats the midpoint (50) as high on both axes", () => {
    expect(deriveGoverningArchetype(p(50, 50))).toBe("ideologue");
  });
  it("ignores loyalty (reserved for the political role)", () => {
    expect(deriveGoverningArchetype(p(80, 20, 0))).toBe(deriveGoverningArchetype(p(80, 20, 100)));
  });
});

describe("GOVERNING_ARCHETYPE_MODIFIERS", () => {
  const all: GoverningArchetype[] = ["reformer", "ideologue", "technocrat", "steward"];

  it("defines a modifier set for every archetype", () => {
    for (const a of all) expect(GOVERNING_ARCHETYPE_MODIFIERS[a]).toBeDefined();
  });

  it("gives reformers the broadest agenda and stewards the narrowest", () => {
    expect(GOVERNING_ARCHETYPE_MODIFIERS.reformer.agendaBreadthDelta).toBeGreaterThan(
      GOVERNING_ARCHETYPE_MODIFIERS.steward.agendaBreadthDelta
    );
  });

  it("weights ideology highest for ideologues and conditions highest for technocrats", () => {
    expect(GOVERNING_ARCHETYPE_MODIFIERS.ideologue.ideologyWeightMult).toBeGreaterThan(
      GOVERNING_ARCHETYPE_MODIFIERS.technocrat.ideologyWeightMult
    );
    expect(GOVERNING_ARCHETYPE_MODIFIERS.technocrat.conditionsWeightMult).toBeGreaterThan(
      GOVERNING_ARCHETYPE_MODIFIERS.ideologue.conditionsWeightMult
    );
  });

  it("keeps every spend appetite inside the safe clamp band", () => {
    for (const a of all) {
      const m = GOVERNING_ARCHETYPE_MODIFIERS[a];
      expect(clampSpendAppetite(m.spendAppetiteMult)).toBe(m.spendAppetiteMult);
    }
  });

  it("clamps an out-of-band spend appetite to the safe ceiling/floor", () => {
    expect(clampSpendAppetite(99)).toBe(GOVERNING_ARCHETYPE_CLAMP.maxSpendAppetiteMult);
    expect(clampSpendAppetite(0)).toBe(GOVERNING_ARCHETYPE_CLAMP.minSpendAppetiteMult);
  });
});

describe("governingArchetypeModifiers", () => {
  it("resolves personality → archetype → modifiers in one call", () => {
    expect(governingArchetypeModifiers(p(80, 20))).toBe(GOVERNING_ARCHETYPE_MODIFIERS.reformer);
  });
});
