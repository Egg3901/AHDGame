import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import {
  gdpToAnchor,
  getGdpAnchorRate,
  isKnownGdpAnchorCountry,
  loadWorldGdpAnchorRates,
  loadWorldPreset,
} from "./gdpAnchorRate";
import {
  COUNTRY_CONFIGS,
  ERA_COUNTRY_CONFIG_OVERRIDES,
  type CountryId,
} from "@/lib/constants/countries";

const MODERN_AND_ALIAS_PRESETS = [
  "1979-default",
  "1991-default",
  "1999-default",
  "2007-default",
  "2019-default",
  "2023-default",
  "empty",
  "2019-no-parties",
  "a-preset-that-does-not-exist",
];

/** Minimal `Db` stand-in: only `gameState.findOne` is ever reached. */
function fakeDb(gameState: { preset?: string } | null): Db {
  return {
    collection: () => ({ findOne: async () => gameState }),
  } as unknown as Db;
}

describe("getGdpAnchorRate", () => {
  it("returns the base config rate for every modern preset and for no preset", () => {
    for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
      const base = COUNTRY_CONFIGS[countryId].usdExchangeRate;
      expect(getGdpAnchorRate(countryId), countryId).toBe(base);
      for (const preset of MODERN_AND_ALIAS_PRESETS) {
        expect(getGdpAnchorRate(countryId, preset), `${countryId} @ ${preset}`).toBe(base);
      }
    }
  });

  it("returns the 1953 override where the era table authors one", () => {
    const overrides = ERA_COUNTRY_CONFIG_OVERRIDES["1953-default"];
    const authored = (Object.keys(overrides) as CountryId[]).filter(
      (c) => overrides[c]?.usdExchangeRate !== undefined
    );
    // Guard the guard: the era table must actually carry rates, or this test
    // would silently pass on an empty set.
    expect(authored.length).toBeGreaterThan(20);
    for (const countryId of authored) {
      expect(getGdpAnchorRate(countryId, "1953-default"), countryId).toBe(
        overrides[countryId]!.usdExchangeRate
      );
    }
  });

  it("falls back to an anchor passthrough for an unrecognized country", () => {
    // A stale `countryId` on one state doc must not produce 0 or NaN and zero
    // out a market — it degrades to 'this GDP is already ₳'.
    expect(getGdpAnchorRate("BY" as CountryId)).toBe(1);
    expect(isKnownGdpAnchorCountry("BY" as CountryId)).toBe(false);
    expect(isKnownGdpAnchorCountry("US")).toBe(true);
  });

  it("converts stored GDP millions into ₳ millions", () => {
    // France 1953: FFr 16,450,000m at 350 FRF/₳ is a $47B economy, not $3.9T.
    expect(Math.round(gdpToAnchor(16_450_000, "FR", "1953-default"))).toBe(47_000);
    // The same figure read off the base config is what shipped the $3.9T bug.
    expect(Math.round(gdpToAnchor(16_450_000, "FR"))).toBeGreaterThan(3_000_000);
  });
});

describe("loadWorldPreset", () => {
  it("reads the gameState singleton", async () => {
    expect(await loadWorldPreset(fakeDb({ preset: "1953-default" }))).toBe("1953-default");
  });

  it("falls back to 2019-default when the doc or the field is missing", async () => {
    expect(await loadWorldPreset(fakeDb(null))).toBe("2019-default");
    expect(await loadWorldPreset(fakeDb({}))).toBe("2019-default");
    expect(await loadWorldPreset(fakeDb({ preset: "   " }))).toBe("2019-default");
  });
});

describe("loadWorldGdpAnchorRates", () => {
  it("binds the world's preset to the per-country resolver", async () => {
    const rates = await loadWorldGdpAnchorRates(fakeDb({ preset: "1953-default" }));
    expect(rates.preset).toBe("1953-default");
    expect(rates.rateFor("FR")).toBe(getGdpAnchorRate("FR", "1953-default"));
    expect(Math.round(rates.toAnchor(16_450_000, "FR"))).toBe(47_000);
  });
});
