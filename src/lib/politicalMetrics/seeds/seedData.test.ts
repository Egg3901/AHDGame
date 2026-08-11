import { describe, expect, it } from "vitest";
import { states1953 } from "@/lib/seeds/reference/states1953";
import { ukRegions1953 } from "@/lib/seeds/uk/ukRegions1953";
import { ruRegions1953 } from "@/lib/seeds/ru/ruRegions1953";
import { ddRegions } from "@/lib/seeds/dd/ddRegions";
import { ddRegions1953 } from "@/lib/seeds/dd/ddRegions1953";
import { POLITICAL_METRIC_FAMILIES } from "../families";
import { POLITICAL_METRIC_COUNTRY_IDS } from "../types";
import { NATIONAL_BASELINES_1953 } from "./nationalBaselines1953";
import { REGIONAL_MODIFIERS_1953 } from "./regionalModifiers1953";

describe("political metrics 1953 seed data", () => {
  it("national baselines cover every family for every country, in bounds", () => {
    for (const countryId of POLITICAL_METRIC_COUNTRY_IDS) {
      const base = NATIONAL_BASELINES_1953[countryId];
      for (const f of POLITICAL_METRIC_FAMILIES) {
        const b = base[f.id];
        expect(b, `${countryId} ${f.id}`).toBeDefined();
        expect(b.value).toBeGreaterThanOrEqual(0);
        expect(b.value).toBeLessThanOrEqual(100);
        expect(Number.isFinite(b.trendPerYear)).toBe(true);
      }
    }
  });

  it("regional modifier region ids all exist in the 1953 region seeds", () => {
    const validIds: Record<string, Set<string>> = {
      US: new Set(states1953.map((s) => s._id)),
      UK: new Set(ukRegions1953.map((s) => s._id)),
      RU: new Set(ruRegions1953.map((s) => s._id)),
      // DD authors modifiers for BOTH era bundles (1953 macro-regions + the
      // 1979 eastern Länder) so an era switch keeps regional character.
      DD: new Set([...ddRegions1953.map((s) => s._id), ...ddRegions.map((s) => s._id)]),
    };
    for (const countryId of POLITICAL_METRIC_COUNTRY_IDS) {
      for (const regionId of Object.keys(REGIONAL_MODIFIERS_1953[countryId])) {
        expect(validIds[countryId].has(regionId), `${countryId} ${regionId}`).toBe(true);
      }
    }
  });

  it("modifiers are small deltas, not absolute values", () => {
    for (const countryId of POLITICAL_METRIC_COUNTRY_IDS) {
      for (const mods of Object.values(REGIONAL_MODIFIERS_1953[countryId])) {
        for (const delta of Object.values(mods)) {
          expect(Math.abs(delta as number)).toBeLessThanOrEqual(25);
        }
      }
    }
  });

  it("every country has at least some authored regional texture", () => {
    for (const countryId of POLITICAL_METRIC_COUNTRY_IDS) {
      expect(Object.keys(REGIONAL_MODIFIERS_1953[countryId]).length).toBeGreaterThanOrEqual(3);
    }
  });
});
