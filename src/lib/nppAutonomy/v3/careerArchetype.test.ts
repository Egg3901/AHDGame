import { describe, it, expect } from "vitest";
import type { NPPPersonality } from "@/lib/db/types/npp";
import {
  CAREER_ARCHETYPE_MODIFIERS,
  CAREER_ARCHETYPE_CLAMP,
  clampCareerModifiers,
  careerArchetypeModifiers,
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

function personality(ambition: number, stubbornness: number): NPPPersonality {
  return { loyalty: 50, ambition, stubbornness };
}

describe("careerArchetype", () => {
  it("every archetype's table values sit inside the declared safe bands", () => {
    for (const mods of Object.values(CAREER_ARCHETYPE_MODIFIERS)) {
      for (const field of FIELDS) {
        const [min, max] = CAREER_ARCHETYPE_CLAMP[field];
        expect(mods[field]).toBeGreaterThanOrEqual(min);
        expect(mods[field]).toBeLessThanOrEqual(max);
      }
    }
  });

  it("clampCareerModifiers pulls out-of-band values back into their band", () => {
    const wild: CareerArchetypeModifiers = {
      campaignAggressionMult: 99,
      fundraiseAppetiteMult: -5,
      officeSeekingMult: 99,
      legislativeActivityMult: -5,
      saveInvestAppetiteMult: 99,
      riskToleranceMult: -5,
    };
    const clamped = clampCareerModifiers(wild);
    for (const field of FIELDS) {
      const [min, max] = CAREER_ARCHETYPE_CLAMP[field];
      expect(clamped[field]).toBe(
        field === "fundraiseAppetiteMult" ||
          field === "legislativeActivityMult" ||
          field === "riskToleranceMult"
          ? min
          : max
      );
    }
  });

  it("maps the four personality quadrants to the expected archetype profiles", () => {
    // reformer: high ambition, low stubbornness — spends (low save), high office-seeking
    const reformer = careerArchetypeModifiers(personality(80, 20));
    expect(reformer).toEqual(CAREER_ARCHETYPE_MODIFIERS.reformer);
    // steward: low ambition, high stubbornness — frugal (high save), low risk
    const steward = careerArchetypeModifiers(personality(20, 80));
    expect(steward).toEqual(CAREER_ARCHETYPE_MODIFIERS.steward);
    // technocrat saves more than reformer; reformer takes more risk than steward
    expect(CAREER_ARCHETYPE_MODIFIERS.technocrat.saveInvestAppetiteMult).toBeGreaterThan(
      CAREER_ARCHETYPE_MODIFIERS.reformer.saveInvestAppetiteMult
    );
    expect(CAREER_ARCHETYPE_MODIFIERS.reformer.riskToleranceMult).toBeGreaterThan(
      CAREER_ARCHETYPE_MODIFIERS.steward.riskToleranceMult
    );
  });
});
