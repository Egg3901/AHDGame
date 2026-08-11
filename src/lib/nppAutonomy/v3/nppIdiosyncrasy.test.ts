import { describe, it, expect } from "vitest";
import {
  applyNppIdiosyncrasy,
  careerPhase,
  CAREER_PHASE_TURNS,
  IDIOSYNCRASY_JITTER,
} from "./nppIdiosyncrasy";
import {
  CAREER_ARCHETYPE_CLAMP,
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

const base = careerArchetypeModifiersContinuous({ ambition: 60, stubbornness: 40, loyalty: 50 });

describe("nppIdiosyncrasy", () => {
  it("is stable across turns within a career phase", () => {
    const a = applyNppIdiosyncrasy(base, "42", 0);
    const b = applyNppIdiosyncrasy(base, "42", CAREER_PHASE_TURNS - 1);
    expect(a).toEqual(b);
  });

  it("drifts when the career phase advances", () => {
    const early = applyNppIdiosyncrasy(base, "42", 0);
    const later = applyNppIdiosyncrasy(base, "42", CAREER_PHASE_TURNS);
    expect(later).not.toEqual(early);
  });

  it("differentiates two NPPs with identical personalities", () => {
    const a = applyNppIdiosyncrasy(base, "1", 0);
    const b = applyNppIdiosyncrasy(base, "2", 0);
    expect(a.modifiers).not.toEqual(b.modifiers);
  });

  it("is deterministic for the same inputs", () => {
    expect(applyNppIdiosyncrasy(base, "7", 350)).toEqual(applyNppIdiosyncrasy(base, "7", 350));
  });

  it("keeps every field inside its clamp band", () => {
    for (let id = 0; id < 250; id++) {
      const { modifiers } = applyNppIdiosyncrasy(base, String(id), 0);
      for (const field of FIELDS) {
        const [min, max] = CAREER_ARCHETYPE_CLAMP[field];
        expect(modifiers[field]).toBeGreaterThanOrEqual(min);
        expect(modifiers[field]).toBeLessThanOrEqual(max);
      }
    }
  });

  it("keeps the jitter small — quirks colour behaviour, they don't redefine it", () => {
    for (let id = 0; id < 250; id++) {
      const { modifiers } = applyNppIdiosyncrasy(base, String(id), 0);
      for (const field of FIELDS) {
        const [min, max] = CAREER_ARCHETYPE_CLAMP[field];
        // Compare against the clamped base so a field already sitting on a band
        // edge isn't counted as drift the jitter didn't cause.
        const expectedMin = Math.max(min, base[field] * (1 - IDIOSYNCRASY_JITTER) - 1e-9);
        const expectedMax = Math.min(max, base[field] * (1 + IDIOSYNCRASY_JITTER) + 1e-9);
        expect(modifiers[field]).toBeGreaterThanOrEqual(expectedMin);
        expect(modifiers[field]).toBeLessThanOrEqual(expectedMax);
      }
    }
  });

  it("returns a bounded temperature multiplier", () => {
    for (let id = 0; id < 250; id++) {
      const { temperatureMult } = applyNppIdiosyncrasy(base, String(id), 0);
      expect(temperatureMult).toBeGreaterThan(0.7);
      expect(temperatureMult).toBeLessThan(1.3);
    }
  });

  it("computes the career phase from the turn", () => {
    expect(careerPhase(0)).toBe(0);
    expect(careerPhase(CAREER_PHASE_TURNS - 1)).toBe(0);
    expect(careerPhase(CAREER_PHASE_TURNS)).toBe(1);
  });
});
