import { describe, it, expect } from "vitest";
import {
  CAREER_ARCHETYPE_CLAMP,
  CAREER_ARCHETYPE_MODIFIERS,
  careerArchetypeModifiers,
  careerArchetypeModifiersContinuous,
  type CareerArchetypeModifiers,
} from "./careerArchetype";

const FIELDS: (keyof CareerArchetypeModifiers)[] = [
  "campaignAggressionMult",
  "fundraiseAppetiteMult",
  "officeSeekingMult",
  "legislativeActivityMult",
  "saveInvestAppetiteMult",
  "riskToleranceMult",
];

const p = (ambition: number, stubbornness: number) => ({ ambition, stubbornness, loyalty: 50 });

describe("careerArchetypeModifiersContinuous", () => {
  it("matches the archetype table exactly at the four corners", () => {
    const corners = [
      [p(100, 0), "reformer"],
      [p(100, 100), "ideologue"],
      [p(0, 0), "technocrat"],
      [p(0, 100), "steward"],
    ] as const;

    for (const [personality, archetype] of corners) {
      const blended = careerArchetypeModifiersContinuous(personality);
      for (const field of FIELDS) {
        expect(blended[field]).toBeCloseTo(CAREER_ARCHETYPE_MODIFIERS[archetype][field], 10);
      }
    }
  });

  it("distinguishes personalities the bucketed version treats as identical", () => {
    // The whole point: ambition 51 and ambition 99 are the same archetype bucket.
    expect(careerArchetypeModifiers(p(51, 60))).toEqual(careerArchetypeModifiers(p(99, 60)));
    expect(careerArchetypeModifiersContinuous(p(51, 60))).not.toEqual(
      careerArchetypeModifiersContinuous(p(99, 60))
    );
  });

  it("varies office-seeking monotonically with ambition", () => {
    let previous = -Infinity;
    for (let ambition = 0; ambition <= 100; ambition += 10) {
      const value = careerArchetypeModifiersContinuous(p(ambition, 0)).officeSeekingMult;
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("respects the clamp bands across the whole personality space", () => {
    for (let ambition = 0; ambition <= 100; ambition += 5) {
      for (let stubbornness = 0; stubbornness <= 100; stubbornness += 5) {
        const modifiers = careerArchetypeModifiersContinuous(p(ambition, stubbornness));
        for (const field of FIELDS) {
          const [min, max] = CAREER_ARCHETYPE_CLAMP[field];
          expect(modifiers[field]).toBeGreaterThanOrEqual(min);
          expect(modifiers[field]).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  it("clamps out-of-range personality sliders instead of extrapolating", () => {
    expect(careerArchetypeModifiersContinuous(p(500, -200))).toEqual(
      careerArchetypeModifiersContinuous(p(100, 0))
    );
  });

  it("leaves the bucketed function untouched", () => {
    // Migration is per-call-site; the discrete version still backs the throttles
    // whose balance was tuned against it.
    expect(careerArchetypeModifiers(p(80, 80))).toEqual(CAREER_ARCHETYPE_MODIFIERS.ideologue);
  });
});
