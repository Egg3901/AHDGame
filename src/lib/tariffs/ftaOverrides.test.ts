import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { buildFtaCoverageLookup, ftaPairKey, isFtaActive, type FtaPairSet } from "./ftaOverrides";
import { getEffectiveTariffRate, getForeignTariffMarginModifier } from "./tariffEffects";
import type { Tariff } from "@/lib/db/types";

function tariff(rate: number, overrides: Partial<Tariff> = {}): Tariff {
  return {
    _id: new ObjectId(),
    countryId: "US",
    scopeType: "economy_wide",
    rate,
    sourceBillId: new ObjectId(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Tariff;
}

describe("ftaPairKey", () => {
  it("is order-independent", () => {
    expect(ftaPairKey("US", "UK")).toBe(ftaPairKey("UK", "US"));
  });
});

describe("isFtaActive", () => {
  const pairs: FtaPairSet = new Set([ftaPairKey("US", "UK")]);

  it("returns true for partnered pair (either direction)", () => {
    expect(isFtaActive(pairs, "US", "UK")).toBe(true);
    expect(isFtaActive(pairs, "UK", "US")).toBe(true);
  });

  it("returns false for unrelated pair", () => {
    expect(isFtaActive(pairs, "US", "DE")).toBe(false);
  });

  it("treats same country as integrated (no tariff)", () => {
    expect(isFtaActive(pairs, "US", "US")).toBe(true);
  });
});

describe("getEffectiveTariffRate with FTA overrides", () => {
  it("returns 0 when sector and corp HQ are FTA partners", () => {
    const tariffs = [tariff(40)]; // 40% economy-wide US tariff
    const fta: FtaPairSet = new Set([ftaPairKey("US", "UK")]);
    const rate = getEffectiveTariffRate(tariffs, "US", "automobiles", "UK", undefined, fta);
    expect(rate).toBe(0);
  });

  it("returns the bill rate when no FTA covers the pair", () => {
    const tariffs = [tariff(40)];
    const fta: FtaPairSet = new Set([ftaPairKey("US", "DE")]);
    const rate = getEffectiveTariffRate(tariffs, "US", "automobiles", "UK", undefined, fta);
    expect(rate).toBe(40);
  });

  it("returns the bill rate when no FTA set is provided (back-compat)", () => {
    const tariffs = [tariff(25)];
    expect(getEffectiveTariffRate(tariffs, "US", "automobiles", "UK", undefined)).toBe(25);
  });
});

describe("getForeignTariffMarginModifier with FTA overrides", () => {
  it("returns 0 modifier for FTA partners (rate is 0)", () => {
    const tariffs = [tariff(60)];
    const fta: FtaPairSet = new Set([ftaPairKey("US", "UK")]);
    const mod = getForeignTariffMarginModifier(tariffs, "US", "automobiles", "UK", undefined, fta);
    expect(mod).toBe(0);
  });

  it("applies the half-rate penalty for non-partners", () => {
    const tariffs = [tariff(40)];
    const mod = getForeignTariffMarginModifier(tariffs, "US", "automobiles", "UK", undefined);
    expect(mod).toBe(-20);
  });
});

describe("buildFtaCoverageLookup", () => {
  it("returns empty maps when no sectors are provided", () => {
    const coverage = buildFtaCoverageLookup([], new Map(), new Set());
    expect(coverage.byCountryEconomyWide.size).toBe(0);
    expect(coverage.bySectorType.size).toBe(0);
    expect(coverage.corpHqByCorpId.size).toBe(0);
    expect(coverage.pairs.size).toBe(0);
  });

  it("returns share 0 when foreign corps exist but no FTAs are active", () => {
    const ukCorpId = new ObjectId();
    const sectors = [
      {
        corporationId: ukCorpId,
        countryId: "US" as const,
        sectorType: "technology" as const,
        revenue: 1000,
      },
    ];
    const corpById = new Map([[ukCorpId.toString(), { _id: ukCorpId, countryId: "UK" as const }]]);
    const coverage = buildFtaCoverageLookup(sectors, corpById, new Set());
    expect(coverage.byCountryEconomyWide.get("US")).toBe(0);
    expect(coverage.bySectorType.get("US:technology")).toBe(0);
    expect(coverage.corpHqByCorpId.get(ukCorpId.toString())).toBe("UK");
  });

  it("returns share 1.0 when all foreign sectors are HQ'd in FTA partners", () => {
    const jpCorpId = new ObjectId();
    const sectors = [
      {
        corporationId: jpCorpId,
        countryId: "US" as const,
        sectorType: "technology" as const,
        revenue: 800,
      },
    ];
    const corpById = new Map([[jpCorpId.toString(), { _id: jpCorpId, countryId: "JP" as const }]]);
    const coverage = buildFtaCoverageLookup(sectors, corpById, new Set([ftaPairKey("JP", "US")]));
    expect(coverage.byCountryEconomyWide.get("US")).toBeCloseTo(1.0);
    expect(coverage.bySectorType.get("US:technology")).toBeCloseTo(1.0);
  });

  it("computes proportional shares with a mix of partner and non-partner foreign corps", () => {
    const jpCorpId = new ObjectId();
    const ukCorpId = new ObjectId();
    const sectors = [
      {
        corporationId: jpCorpId,
        countryId: "US" as const,
        sectorType: "technology" as const,
        revenue: 300,
      },
      {
        corporationId: ukCorpId,
        countryId: "US" as const,
        sectorType: "technology" as const,
        revenue: 700,
      },
    ];
    const corpById = new Map([
      [jpCorpId.toString(), { _id: jpCorpId, countryId: "JP" as const }],
      [ukCorpId.toString(), { _id: ukCorpId, countryId: "UK" as const }],
    ]);
    const coverage = buildFtaCoverageLookup(sectors, corpById, new Set([ftaPairKey("JP", "US")]));
    // 300 partner / 1000 total = 0.3
    expect(coverage.byCountryEconomyWide.get("US")).toBeCloseTo(0.3);
    expect(coverage.bySectorType.get("US:technology")).toBeCloseTo(0.3);
  });

  it("isolates sector-type shares (partner dominant in one type, absent in another)", () => {
    const jpCorpId = new ObjectId();
    const ukCorpId = new ObjectId();
    const sectors = [
      {
        corporationId: jpCorpId,
        countryId: "US" as const,
        sectorType: "technology" as const,
        revenue: 800,
      },
      {
        corporationId: ukCorpId,
        countryId: "US" as const,
        sectorType: "retail" as const,
        revenue: 200,
      },
    ];
    const corpById = new Map([
      [jpCorpId.toString(), { _id: jpCorpId, countryId: "JP" as const }],
      [ukCorpId.toString(), { _id: ukCorpId, countryId: "UK" as const }],
    ]);
    const coverage = buildFtaCoverageLookup(sectors, corpById, new Set([ftaPairKey("JP", "US")]));
    expect(coverage.bySectorType.get("US:technology")).toBeCloseTo(1.0);
    expect(coverage.bySectorType.get("US:retail")).toBeCloseTo(0);
    // economy-wide: 800 partner / 1000 total = 0.8
    expect(coverage.byCountryEconomyWide.get("US")).toBeCloseTo(0.8);
  });

  it("excludes domestic sectors from the denominator", () => {
    const usCorpId = new ObjectId();
    const jpCorpId = new ObjectId();
    const sectors = [
      {
        corporationId: usCorpId,
        countryId: "US" as const,
        sectorType: "technology" as const,
        revenue: 500,
      },
      {
        corporationId: jpCorpId,
        countryId: "US" as const,
        sectorType: "technology" as const,
        revenue: 500,
      },
    ];
    const corpById = new Map([
      [usCorpId.toString(), { _id: usCorpId, countryId: "US" as const }],
      [jpCorpId.toString(), { _id: jpCorpId, countryId: "JP" as const }],
    ]);
    const coverage = buildFtaCoverageLookup(sectors, corpById, new Set([ftaPairKey("JP", "US")]));
    // Only the JP foreign sector counts (500/500), not the US domestic sector
    expect(coverage.byCountryEconomyWide.get("US")).toBeCloseTo(1.0);
  });
});
