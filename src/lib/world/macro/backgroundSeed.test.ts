import { describe, expect, it } from "vitest";
import { getWorldEntityPresetManifest } from "@/lib/world/worldEntityManifest";
import { buildBackgroundMacroCountry } from "./backgroundSeed";
import { backgroundSeedUnit, buildBackgroundMacroSpec } from "./rules/backgroundProfile";
import { buildSectorsFromSpec } from "./seedBuilder";
import { computeMacroContribution } from "./kernel";

const now = new Date("1991-01-20T00:00:00Z");

describe("background macro population distribution", () => {
  it.each(["1979-default", "1991-default", "1999-default", "2019-default", "2027-default"])(
    "uses the population range across the actual %s roster",
    (preset) => {
      const entries = getWorldEntityPresetManifest(preset).entries.filter(
        (entry) => entry.simulationTier === "background-macro" && entry.status === "sovereign"
      );
      const countries = entries.map((entry) => buildBackgroundMacroCountry(entry, preset, now));
      const populations = countries.map((country) => country.population);
      expect(countries.length).toBeGreaterThan(100);
      expect(new Set(populations).size).toBeGreaterThan(countries.length * 0.9);
      expect(populations.filter((population) => population < 400_000).length).toBeLessThan(
        countries.length * 0.1
      );
      expect(Math.max(...populations)).toBeGreaterThan(80_000_000);
      expect(Math.min(...populations)).toBeLessThan(1_000_000);
      for (const country of countries) {
        expect(country.population).toBeGreaterThanOrEqual(350_000);
        expect(country.population).toBeLessThanOrEqual(95_350_000);
        expect(country.dataQuality.provenance).toBe("estimated-background");
        expect(country.dataQuality.missingFields).toEqual([]);
        expect(country.dataQuality.fallbackFields).toEqual([]);
      }
    }
  );
});

describe("background sampler and economic reconciliation", () => {
  it.each(["short", "long"])("spreads %s identifiers without a length floor", (length) => {
    const ids = Array.from({ length: 676 }, (_, index) => {
      const suffix = String.fromCharCode(65 + Math.floor(index / 26), 65 + (index % 26));
      return length === "short" ? suffix : `background-country-${suffix}`;
    });
    for (const salt of [17, 41, 73, 97, 131, 181]) {
      const samples = ids.map((id) => backgroundSeedUnit(id, salt));
      const buckets = Array.from(
        { length: 10 },
        (_, bucket) => samples.filter((value) => Math.floor(value * 10) === bucket).length
      );
      expect(Math.min(...buckets)).toBeGreaterThan(30);
      expect(Math.max(...buckets)).toBeLessThan(110);
      expect(samples.every((value) => value >= 0 && value < 1)).toBe(true);
      expect(samples).toEqual(ids.map((id) => backgroundSeedUnit(id, salt)));
    }
  });

  it("uses distinct trait salts and retains the specified era income relationship", () => {
    const id = "CA";
    expect(
      new Set([17, 41, 73, 97, 131, 181].map((salt) => backgroundSeedUnit(id, salt))).size
    ).toBe(6);
    const earlier = buildBackgroundMacroSpec(id, "Canada", "market", 1991);
    const later = buildBackgroundMacroSpec(id, "Canada", "market", 2027);
    expect(later.population).toBe(earlier.population);
    expect(later.annualGdpGameUnits).toBeGreaterThan(earlier.annualGdpGameUnits);
    expect(earlier).toEqual(buildBackgroundMacroSpec(id, "Canada", "market", 1991));
  });

  it("builds GDP, domestic demand and held contributions together for every 1991 country", () => {
    const entries = getWorldEntityPresetManifest("1991-default").entries.filter(
      (entry) => entry.simulationTier === "background-macro" && entry.status === "sovereign"
    );
    for (const entry of entries) {
      const spec = buildBackgroundMacroSpec(
        entry.entityId,
        entry.displayName,
        entry.economicArchetype,
        1991
      );
      const country = buildBackgroundMacroCountry(entry, "1991-default", now);
      expect(country.sectors).toEqual(buildSectorsFromSpec(spec));
      expect(country.contribution).toEqual(computeMacroContribution(country, 1));
      const capacity = Object.values(country.sectors).reduce(
        (sum, sector) => sum + (sector?.capacity ?? 0),
        0
      );
      expect(capacity).toBeCloseTo(spec.annualGdpGameUnits / 48, 1);
      expect(country.fiscalCapacity).toBeGreaterThanOrEqual(0.2);
      expect(country.fiscalCapacity).toBeLessThan(0.65);
      expect(country.stability).toBeGreaterThanOrEqual(0.4);
      expect(country.stability).toBeLessThan(0.85);
      expect(country.tradeExposure).toBeGreaterThanOrEqual(0.18);
      expect(country.tradeExposure).toBeLessThan(0.8);
      expect(country.lastMacroTickTurn).toBeNull();
      for (const balance of Object.values(country.contribution.byCommodity)) {
        expect(Number.isFinite(balance.supply) && balance.supply >= 0).toBe(true);
        expect(Number.isFinite(balance.demand) && balance.demand >= 0).toBe(true);
      }
    }
  });
});
