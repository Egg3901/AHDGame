import { describe, it, expect } from "vitest";
import type { CrisisTemplate } from "@/lib/db/types/crisis";
import {
  CYBER_ATTACK_TEMPLATE,
  PANDEMIC_TEMPLATE,
  TECH_BUBBLE_BURST_TEMPLATE,
  DISINFORMATION_CRISIS_TEMPLATE,
  ENERGY_CRISIS_TEMPLATE,
  ALL_CRISIS_TEMPLATES,
} from "./templates";
import { isTemplateAllowedInYear } from "./crisisEraWindow";

describe("crisis template era window", () => {
  it("still blocks modern templates at the era start years", () => {
    // The behaviour the old preset gate was reaching for, preserved.
    expect(isTemplateAllowedInYear(CYBER_ATTACK_TEMPLATE, 1991)).toBe(false);
    expect(isTemplateAllowedInYear(TECH_BUBBLE_BURST_TEMPLATE, 1991)).toBe(false);
    expect(isTemplateAllowedInYear(DISINFORMATION_CRISIS_TEMPLATE, 1991)).toBe(false);
    expect(isTemplateAllowedInYear(CYBER_ATTACK_TEMPLATE, 1953)).toBe(false);
  });

  it("OPENS the window once the world reaches the year — the bug this replaces", () => {
    // A 1991-seeded world that has advanced to 2008 used to block these
    // forever, because the gate read the seed preset and a preset never
    // changes. This is the whole point of the change.
    expect(isTemplateAllowedInYear(CYBER_ATTACK_TEMPLATE, 2008)).toBe(true);
    expect(isTemplateAllowedInYear(TECH_BUBBLE_BURST_TEMPLATE, 2008)).toBe(true);
    expect(isTemplateAllowedInYear(DISINFORMATION_CRISIS_TEMPLATE, 2015)).toBe(true);
  });

  it("opens exactly on the boundary year, inclusive", () => {
    expect(isTemplateAllowedInYear(CYBER_ATTACK_TEMPLATE, 1994)).toBe(false);
    expect(isTemplateAllowedInYear(CYBER_ATTACK_TEMPLATE, 1995)).toBe(true);
    expect(isTemplateAllowedInYear(DISINFORMATION_CRISIS_TEMPLATE, 2009)).toBe(false);
    expect(isTemplateAllowedInYear(DISINFORMATION_CRISIS_TEMPLATE, 2010)).toBe(true);
  });

  it("leaves era-appropriate templates alone in every year", () => {
    for (const year of [1953, 1979, 1991, 2008, 2024]) {
      expect(isTemplateAllowedInYear(ENERGY_CRISIS_TEMPLATE, year)).toBe(true);
    }
  });

  it("allows pandemics in every era", () => {
    // Deliberate: the old gate blocked 1979 and 1991 while leaving 1953 open,
    // which was incoherent. 1957 Asian flu and 1968 Hong Kong flu each killed
    // over a million people, so a mid-century world must be able to have one.
    for (const year of [1953, 1968, 1979, 1991, 2020]) {
      expect(isTemplateAllowedInYear(PANDEMIC_TEMPLATE, year)).toBe(true);
    }
  });

  it("honours an untilYear as well as a fromYear", () => {
    const windowed = { fromYear: 1960, untilYear: 1975 } as CrisisTemplate;
    expect(isTemplateAllowedInYear(windowed, 1959)).toBe(false);
    expect(isTemplateAllowedInYear(windowed, 1960)).toBe(true);
    expect(isTemplateAllowedInYear(windowed, 1975)).toBe(true);
    expect(isTemplateAllowedInYear(windowed, 1976)).toBe(false);
  });

  it("template with no window is always allowed", () => {
    const ungated = {} as CrisisTemplate;
    for (const year of [1953, 2024]) {
      expect(isTemplateAllowedInYear(ungated, year)).toBe(true);
    }
  });

  it("fails OPEN when the world has no stamped year", () => {
    // Suppressing the entire catalogue would be far harder to notice than one
    // anachronistic crisis.
    expect(isTemplateAllowedInYear(CYBER_ATTACK_TEMPLATE, undefined)).toBe(true);
    expect(isTemplateAllowedInYear(CYBER_ATTACK_TEMPLATE, null)).toBe(true);
    expect(isTemplateAllowedInYear(CYBER_ATTACK_TEMPLATE, NaN)).toBe(true);
  });

  it("no template still carries the retired preset-keyed gate", () => {
    for (const [key, template] of Object.entries(ALL_CRISIS_TEMPLATES)) {
      expect(
        (template as CrisisTemplate & { notForEras?: unknown }).notForEras,
        `${key} still has notForEras`
      ).toBeUndefined();
    }
  });

  it("every declared window is a sane year", () => {
    for (const [key, template] of Object.entries(ALL_CRISIS_TEMPLATES)) {
      const t = template as CrisisTemplate;
      if (typeof t.fromYear === "number") {
        expect(t.fromYear, `${key} fromYear`).toBeGreaterThan(1900);
        expect(t.fromYear, `${key} fromYear`).toBeLessThan(2100);
      }
      if (typeof t.untilYear === "number" && typeof t.fromYear === "number") {
        expect(t.untilYear, `${key} untilYear`).toBeGreaterThanOrEqual(t.fromYear);
      }
    }
  });
});
