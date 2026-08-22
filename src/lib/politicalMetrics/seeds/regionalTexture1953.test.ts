import { describe, it, expect } from "vitest";
import { REGIONAL_TEXTURE_1953 } from "./regionalTexture1953";
import { REGIONAL_MODIFIERS_1953 } from "./regionalModifiers1953";
import { TEXTURE_CAP } from "../derive/playableTexture";
import { playableRegionSeeds1953, type PlayableCountryId } from "../derive/playableLegacySeeds";
import { FAMILY_SLUGS, POLITICAL_METRIC_CATEGORIES, type PoliticalMetricId } from "../types";
import type { PoliticalMetricsCountryId } from "../types";

const VALID_FAMILIES = new Set(
  POLITICAL_METRIC_CATEGORIES.flatMap((c) =>
    (FAMILY_SLUGS[c.id as keyof typeof FAMILY_SLUGS] as readonly string[]).map(
      (f) => `${c.id}.${f}`
    )
  )
);

describe("REGIONAL_TEXTURE_1953", () => {
  it("names only real political families", () => {
    for (const regions of Object.values(REGIONAL_TEXTURE_1953)) {
      for (const families of Object.values(regions)) {
        for (const family of Object.keys(families)) {
          expect(VALID_FAMILIES.has(family)).toBe(true);
        }
      }
    }
  });

  it("keeps every deviation inside the cap", () => {
    for (const regions of Object.values(REGIONAL_TEXTURE_1953)) {
      for (const families of Object.values(regions)) {
        for (const dev of Object.values(families)) {
          expect(Math.abs(dev as number)).toBeLessThanOrEqual(TEXTURE_CAP + 1e-6);
        }
      }
    }
  });

  it("leaves each family's mean near zero so country baselines are preserved", () => {
    for (const [countryId, regions] of Object.entries(REGIONAL_TEXTURE_1953)) {
      const regionCount = playableRegionSeeds1953(countryId as PlayableCountryId).length;
      const byFamily: Record<string, number[]> = {};
      for (const families of Object.values(regions)) {
        for (const [family, dev] of Object.entries(families)) {
          (byFamily[family] ??= []).push(dev as number);
        }
      }
      for (const [family, devs] of Object.entries(byFamily)) {
        // The residue left by noise-floor dropping, spread over the whole
        // country, is the shift the authored national baseline actually sees.
        // Hand-authored collisions are excluded BEFORE centring (see
        // playableTexture.ts), so they contribute nothing here; when they were
        // dropped afterwards instead, US society.integration shifted 1.02.
        const shift = Math.abs(devs.reduce((a, b) => a + b, 0)) / regionCount;
        // Name the offender in the failure rather than reporting a bare number.
        expect({ family: `${countryId} ${family}`, over: shift >= 0.75 }).toEqual({
          family: `${countryId} ${family}`,
          over: false,
        });
      }
    }
  });

  it("never collides with a hand-authored modifier", () => {
    for (const [countryId, regions] of Object.entries(REGIONAL_TEXTURE_1953)) {
      const authored = REGIONAL_MODIFIERS_1953[countryId as PoliticalMetricsCountryId] ?? {};
      for (const [regionId, families] of Object.entries(regions)) {
        for (const family of Object.keys(families)) {
          expect(authored[regionId]?.[family as PoliticalMetricId]).toBeUndefined();
        }
      }
    }
  });

  it("gives the Attorney General portfolio real regional texture in the US", () => {
    const usRegions = Object.values(REGIONAL_TEXTURE_1953.US ?? {});
    const safety = usRegions
      .map((f) => f["order.safety" as PoliticalMetricId])
      .filter((v): v is number => typeof v === "number");
    expect(safety.length).toBeGreaterThan(5);
    expect(new Set(safety).size).toBeGreaterThan(3);
  });
});

describe("REGIONAL_TEXTURE_1953 region ids", () => {
  it("only names regions that exist in the country's 1953 seed", () => {
    for (const [countryId, regions] of Object.entries(REGIONAL_TEXTURE_1953)) {
      const known = new Set(
        playableRegionSeeds1953(countryId as PlayableCountryId).map((s) => s.regionId)
      );
      for (const regionId of Object.keys(regions)) {
        expect(known.has(regionId)).toBe(true);
      }
    }
  });
});
