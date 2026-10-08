import { describe, expect, it } from "vitest";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import { revenuePerCapacityUnit } from "@/lib/constants/capacityEconomy";
import { foundingStarterUnits } from "@/lib/corporations/foundingPlant";
import { computeUnownedSeedRevenue } from "@/lib/admin/seed/seedUnownedSectors";
import { nppCorpSpawnPlan } from "@/lib/admin/seed/seedNppCorporations";
import { NPP_SEED_COUNTRY_POOL_SHARE, nppSeedRevenueCap } from "./nppSeedCapacity";

const PRESET = "1991-default";

describe("nppSeedRevenueCap", () => {
  it("is the country pool share split across the competitors", () => {
    const cap = nppSeedRevenueCap({
      countryPoolRevenue: 1_000_000_000,
      perSectorCount: 2,
      floorRevenue: 10,
    });
    expect(cap).toBeCloseTo((1_000_000_000 * NPP_SEED_COUNTRY_POOL_SHARE) / 2, 6);
  });

  it("never drops below the first-plant floor", () => {
    expect(
      nppSeedRevenueCap({ countryPoolRevenue: 100, perSectorCount: 2, floorRevenue: 500 })
    ).toBe(500);
  });
});

describe("1991 NPP competitor book vs economy size", () => {
  // Capital region as a share of the country's GDP, from the 1991 world.
  const CAPITAL_GDP_SHARE: Partial<Record<CountryId, number>> = {
    US: 0.007,
    JP: 0.384,
    DE: 0.043,
    FR: 0.284,
    IT: 0.106,
    IE: 0.385,
    UK: 0.186,
    GR: 0.41,
  };

  function seededShares(applyCap: boolean) {
    const plan = nppCorpSpawnPlan(PRESET, 1991).filter((p) => p.countryId in CAPITAL_GDP_SHARE);
    // Country GDP in ₳ is what matters; invert the per-country rate so every
    // country's pool tracks its share of a 100-unit world.
    const worldGdp: Record<string, number> = {
      US: 36,
      JP: 21.5,
      DE: 10.8,
      FR: 8,
      IT: 7,
      UK: 6,
      IE: 0.4,
      GR: 0.4,
    };
    const book: Record<string, number> = {};
    const pools: Record<string, number> = {};
    for (const p of plan) {
      const share = CAPITAL_GDP_SHARE[p.countryId] as number;
      const rate = getCountryConfig(p.countryId, PRESET).usdExchangeRate;
      const regions = [
        { id: p.hqState, anchor: worldGdp[p.countryId] * share },
        { id: "REST", anchor: worldGdp[p.countryId] * (1 - share) },
      ].map((r) => ({ id: r.id, gdp: (r.anchor * 1e9) / rate }));
      let countryBook = 0;
      let countryPool = 0;
      for (const type of CORPORATION_TYPES) {
        const seed = (id: string, gdp: number) =>
          computeUnownedSeedRevenue({
            gdp,
            countryId: p.countryId,
            stateId: id,
            sectorType: type,
            preset: PRESET,
          });
        const pool = regions.reduce((s, r) => s + seed(r.id, r.gdp), 0);
        const hq = seed(regions[0].id, regions[0].gdp);
        const floor =
          foundingStarterUnits(type) * revenuePerCapacityUnit(type, getEraUnitScale(PRESET));
        const cap = applyCap
          ? nppSeedRevenueCap({
              countryPoolRevenue: pool,
              perSectorCount: p.perSectorCount,
              floorRevenue: floor,
            })
          : Infinity;
        countryBook += Math.min(hq * 0.25, cap) * p.perSectorCount;
        countryPool += pool;
      }
      book[p.countryId] = countryBook;
      pools[p.countryId] = countryPool;
    }
    const bookTotal = Object.values(book).reduce((a, b) => a + b, 0);
    const poolTotal = Object.values(pools).reduce((a, b) => a + b, 0);
    return Object.keys(book).map((id) => ({
      id,
      bookShare: (book[id] / bookTotal) * 100,
      gdpShare: (pools[id] / poolTotal) * 100,
    }));
  }

  it("without the cap, capital-heavy economies hold far more than their GDP share", () => {
    const jp = seededShares(false).find((r) => r.id === "JP");
    expect(jp!.bookShare - jp!.gdpShare).toBeGreaterThan(10);
  });

  it("with the cap, every country's capacity share is within 3 points of its GDP share", () => {
    for (const row of seededShares(true)) {
      expect(Math.abs(row.bookShare - row.gdpShare), row.id).toBeLessThan(3);
    }
  });
});
