import { describe, it, expect } from "vitest";
import {
  deriveCeoArchetype,
  ceoArchetypeModifiers,
  CEO_ARCHETYPE_MODIFIERS,
  type CeoArchetype,
} from "./ceoArchetype";
import type { NPPPersonality } from "@/lib/db/types/npp";

function p(ambition: number, stubbornness: number, loyalty = 50): NPPPersonality {
  return { ambition, stubbornness, loyalty };
}

describe("deriveCeoArchetype", () => {
  it("maps high ambition + low stubbornness to aggressive", () => {
    expect(deriveCeoArchetype(p(80, 20))).toBe("aggressive");
  });

  it("maps high ambition + high stubbornness to innovator", () => {
    expect(deriveCeoArchetype(p(80, 80))).toBe("innovator");
  });

  it("maps low ambition + high stubbornness to costCutter", () => {
    expect(deriveCeoArchetype(p(20, 80))).toBe("costCutter");
  });

  it("maps low ambition + low stubbornness to cautious", () => {
    expect(deriveCeoArchetype(p(20, 20))).toBe("cautious");
  });

  it("treats the midpoint (50) as high", () => {
    expect(deriveCeoArchetype(p(50, 50))).toBe("innovator");
  });

  it("ignores loyalty in classification", () => {
    expect(deriveCeoArchetype(p(80, 20, 0))).toBe(deriveCeoArchetype(p(80, 20, 100)));
  });
});

describe("CEO_ARCHETYPE_MODIFIERS", () => {
  const archetypes: CeoArchetype[] = ["aggressive", "cautious", "innovator", "costCutter"];

  it("defines modifiers for every archetype", () => {
    for (const a of archetypes) {
      expect(CEO_ARCHETYPE_MODIFIERS[a]).toBeDefined();
      expect(ceoArchetypeModifiers(a)).toEqual(CEO_ARCHETYPE_MODIFIERS[a]);
    }
  });

  it("keeps all multipliers within sane positive bounds", () => {
    for (const a of archetypes) {
      const m = CEO_ARCHETYPE_MODIFIERS[a];
      for (const mult of [
        m.marketingMult,
        m.rdMult,
        m.dividendMult,
        m.cashFloorMult,
        m.expansionMinMarginMult,
        m.expansionMinCashMult,
      ]) {
        expect(mult).toBeGreaterThan(0);
        expect(mult).toBeLessThanOrEqual(3);
      }
      expect(m.divestMarginFloor).toBeLessThanOrEqual(0);
    }
  });

  it("makes the innovator the heaviest R&D spender", () => {
    const rd = CEO_ARCHETYPE_MODIFIERS.innovator.rdMult;
    expect(rd).toBeGreaterThan(CEO_ARCHETYPE_MODIFIERS.aggressive.rdMult);
    expect(rd).toBeGreaterThan(CEO_ARCHETYPE_MODIFIERS.costCutter.rdMult);
  });

  it("makes the aggressive CEO run the leanest cash floor and the cautious the fattest", () => {
    expect(CEO_ARCHETYPE_MODIFIERS.aggressive.cashFloorMult).toBeLessThan(1);
    expect(CEO_ARCHETYPE_MODIFIERS.cautious.cashFloorMult).toBeGreaterThan(1);
  });
});
