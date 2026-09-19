import { describe, expect, it } from "vitest";
import { derivePlayableTexture1953 } from "@/lib/politicalMetrics/derive/playableTexture";
import { REGIONAL_TEXTURE_1953 } from "./regionalTexture1953";
import { REGIONAL_MODIFIERS_1953 } from "./regionalModifiers1953";
import { states1953 } from "@/lib/seeds/reference/states1953";
import { ukRegions1953 } from "@/lib/seeds/uk/ukRegions1953";
import { ruRegions1953 } from "@/lib/seeds/ru/ruRegions1953";
import { ddRegions1953 } from "@/lib/seeds/dd/ddRegions1953";
import type { PoliticalMetricId, PoliticalMetricsCountryId } from "@/lib/politicalMetrics/types";

/**
 * Issue #704 contract for the generated texture. The committed
 * REGIONAL_TEXTURE_1953 is reviewable data, but the guarantees below are what
 * make it safe to seed: every deviation inside +/-12, a zero
 * population-weighted country mean per family (so the authored national level
 * survives reseeding), hand-authored modifiers winning outright, and a
 * committed artifact that exactly matches what the generator derives today.
 */

const COUNTRIES = ["US", "UK", "RU", "DD"] as const;

const POPULATIONS: Record<PoliticalMetricsCountryId, Map<string, number>> = {
  US: new Map(states1953.map((s) => [s._id, s.population ?? 0])),
  UK: new Map(ukRegions1953.map((s) => [s._id, s.population ?? 0])),
  RU: new Map(ruRegions1953.map((s) => [s._id, s.population ?? 0])),
  DD: new Map(ddRegions1953.map((s) => [s._id, s.population ?? 0])),
};

describe("REGIONAL_TEXTURE_1953", () => {
  it("stays inside the +/-12 bound at 1-decimal precision", () => {
    let cells = 0;
    for (const countryId of COUNTRIES) {
      for (const texture of Object.values(REGIONAL_TEXTURE_1953[countryId])) {
        for (const v of Object.values(texture)) {
          expect(Math.abs(v!)).toBeLessThanOrEqual(12);
          expect(Number.isInteger(v! * 10)).toBe(true);
          cells++;
        }
      }
    }
    expect(cells).toBeGreaterThan(0);
  });

  it("sums to a zero population-weighted country mean per family", () => {
    // Rounding to the emitted 1-decimal precision moves each cell by at most
    // 0.05, so the weighted mean of the rounded vector stays within 0.05 of
    // the exact zero the generator centers before rounding.
    for (const countryId of COUNTRIES) {
      const texture = REGIONAL_TEXTURE_1953[countryId];
      const regions = Object.keys(texture);
      const families = new Set<PoliticalMetricId>();
      for (const t of Object.values(texture)) {
        for (const f of Object.keys(t)) families.add(f as PoliticalMetricId);
      }
      for (const familyId of families) {
        let weighted = 0;
        let denom = 0;
        for (const regionId of regions) {
          const w = POPULATIONS[countryId].get(regionId) ?? 0;
          weighted += w * (texture[regionId]?.[familyId] ?? 0);
          denom += w;
        }
        expect(weighted / denom).toBeLessThan(0.06);
        expect(weighted / denom).toBeGreaterThan(-0.06);
      }
    }
  });

  it("carries no texture where a hand-authored modifier wins outright", () => {
    // Deliberate history (Mississippi society.integration -18) must not be
    // diluted by a mechanical average: the generator zeroes those cells and
    // the seeder applies the modifier instead.
    let zeroed = 0;
    for (const countryId of COUNTRIES) {
      for (const [regionId, modifiers] of Object.entries(REGIONAL_MODIFIERS_1953[countryId])) {
        for (const familyId of Object.keys(modifiers)) {
          expect(
            REGIONAL_TEXTURE_1953[countryId]?.[regionId]?.[familyId as PoliticalMetricId]
          ).toBeUndefined();
          zeroed++;
        }
      }
    }
    expect(zeroed).toBeGreaterThan(0);
    expect(REGIONAL_MODIFIERS_1953.US.MS?.["society.integration"]).toBe(-18);
    expect(REGIONAL_TEXTURE_1953.US.MS?.["society.integration"]).toBeUndefined();
  });

  it("is deterministic and matches the committed artifact exactly", () => {
    // The generator named in nonPlayableBoards.ts's header no longer exists,
    // leaving that output unreproducible. This texture must not repeat that:
    // deriving twice yields the same table, and the committed file is exactly
    // what derivation produces, so a stale artifact fails the build.
    const first = derivePlayableTexture1953();
    const second = derivePlayableTexture1953();
    expect(second.texture).toEqual(first.texture);
    expect(REGIONAL_TEXTURE_1953).toEqual(first.texture);
  });
});
