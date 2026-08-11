/**
 * Regression coverage for the 1991-era demographic adjuster.
 *
 * The adjuster deep-clones its input via `JSON.parse(JSON.stringify())`, which
 * silently turns `Date` fields into ISO strings. A persisted string
 * `lastUpdated` then crashed the region page (`demographics.lastUpdated.toISOString
 * is not a function`) — the "Chinese region pages won't load" bug. These tests
 * lock in that `lastUpdated` survives as a real `Date`.
 */

import { describe, expect, it } from "vitest";
import type { StateDemographics } from "@/lib/db/types";
import { applyEra1991DemographicAdjustments } from "./stateDemographics1991";

function makeDemographics(overrides: Partial<StateDemographics> = {}): StateDemographics {
  return {
    _id: "HD",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 14, economicLean: 0, socialLean: 3, turnout: 95 },
      urban_professional: { population: 30, economicLean: 2, socialLean: 0, turnout: 88 },
      rural_peasant: { population: 8, economicLean: -2, socialLean: 2, turnout: 82 },
      industrial_worker: { population: 16, economicLean: -1, socialLean: 1, turnout: 86 },
      migrant_worker: { population: 12, economicLean: -2, socialLean: 1, turnout: 65 },
      entrepreneur: { population: 14, economicLean: 3, socialLean: 1, turnout: 90 },
      youth: { population: 6, economicLean: 1, socialLean: -1, turnout: 78 },
    },
    lastUpdated: new Date("2026-05-29T00:00:00.000Z"),
    ...overrides,
  } as StateDemographics;
}

describe("applyEra1991DemographicAdjustments — lastUpdated type", () => {
  it("preserves lastUpdated as a Date for an adjusted country (CN)", () => {
    const out = applyEra1991DemographicAdjustments(makeDemographics(), "CN");
    expect(out.lastUpdated).toBeInstanceOf(Date);
    // The Date must still expose toISOString (the call that crashed the page).
    expect(() => out.lastUpdated!.toISOString()).not.toThrow();
  });

  it("re-normalises cohort populations back to ~100 while keeping a Date", () => {
    const out = applyEra1991DemographicAdjustments(makeDemographics(), "CN");
    const total = Object.values(out.groups).reduce((s, g) => s + (g?.population ?? 0), 0);
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(1);
    expect(out.lastUpdated).toBeInstanceOf(Date);
  });

  it("passes through unchanged (still a Date) for a country with no overrides", () => {
    const input = makeDemographics({ countryId: "ZZ" as never });
    const out = applyEra1991DemographicAdjustments(input, "ZZ" as never);
    expect(out.lastUpdated).toBeInstanceOf(Date);
  });
});
