import { describe, it, expect } from "vitest";
import { getEraNominalScale, getEraUnitScale, US_NATIONAL_SEED_GDP_BY_ERA } from "./sectorSeedEra";
import {
  capacityPricePerUnit,
  capacityRescaleRatio,
  laborIntensity,
  revenuePerCapacityUnit,
  revenuePerCapacityUnitForStrategy,
  safeUnitScale,
} from "./capacityEconomy";
import { CORPORATION_TYPES } from "./corporations";
import { SECTOR_STRATEGIES } from "./sectorStrategies";
import { COMMODITY_BASE_PRICES, eraScaledBasePrices, COMMODITY_TYPES } from "./commodities";
import { impliedOutputUnits, seedCapitalStock } from "@/lib/market/capital";
import {
  computeUnownedHeadroomUnits,
  unownedHeadroomUnitsPerAnchor,
} from "@/lib/market/unownedHeadroom";

/**
 * The era unit-basis scale (getEraUnitScale) re-expresses plants-tier capacity
 * units in the era's own prices. These tests pin the two contracts every
 * conversion site relies on:
 *
 *   1. MODERN NO-OP — scale is exactly 1 for every modern preset, alias,
 *      unknown string and absent preset, so every live world is byte-identical.
 *   2. REAL-TERMS INVARIANCE — a 1953 economy whose ₳ figures are the nominal
 *      ratio smaller ends up with the SAME unit counts, the same staffing and
 *      the same build cost as a share of the economy as its modern twin. The
 *      scale moves the DENOMINATION of a unit, never the real quantity.
 */

const SCALE_1953 = getEraUnitScale("1953-default");

describe("getEraUnitScale", () => {
  it("is exactly 1 for modern presets, aliases, unknown and absent presets", () => {
    for (const preset of [
      undefined,
      "2019-default",
      "1991-default",
      "1999-default",
      "2007-default",
      "2023-default",
      "1979-default",
      "empty",
      "no-such-preset",
    ]) {
      expect(getEraUnitScale(preset)).toBe(1);
    }
  });

  it("is the reciprocal of the nominal scale for 1953 (~70x)", () => {
    const nominal = getEraNominalScale("1953-default");
    expect(SCALE_1953).toBeCloseTo(1 / nominal, 10);
    const expected = US_NATIONAL_SEED_GDP_BY_ERA["2019"]! / US_NATIONAL_SEED_GDP_BY_ERA["1953"]!;
    expect(SCALE_1953).toBeCloseTo(expected, 6);
    expect(SCALE_1953).toBeGreaterThan(60);
    expect(SCALE_1953).toBeLessThan(80);
  });
});

describe("safeUnitScale", () => {
  it("passes a positive finite scale through and degrades garbage to 1", () => {
    expect(safeUnitScale(70)).toBe(70);
    expect(safeUnitScale(1)).toBe(1);
    for (const bad of [0, -3, NaN, Infinity, -Infinity, null, undefined]) {
      expect(safeUnitScale(bad as number)).toBe(1);
    }
  });
});

describe("real-terms invariance of the unit basis", () => {
  // A 1953 world's ₳ figures are (1 / SCALE_1953) of the modern twin's. Every
  // conversion below must therefore produce identical REAL quantities.
  const nominal1953 = 1 / SCALE_1953;

  it("impliedOutputUnits: era revenue at era scale = modern revenue at scale 1", () => {
    for (const type of CORPORATION_TYPES) {
      const strategy = SECTOR_STRATEGIES[type]?.[0];
      if (!strategy) continue;
      const modernRevenue = 1_000_000;
      const modern = impliedOutputUnits(modernRevenue, strategy.supply, COMMODITY_BASE_PRICES, 1);
      const era = impliedOutputUnits(
        modernRevenue * nominal1953,
        strategy.supply,
        COMMODITY_BASE_PRICES,
        SCALE_1953
      );
      expect(era).toBeCloseTo(modern, 6);
    }
  });

  it("seedCapitalStock carries the same invariance (flip seeding)", () => {
    const type = CORPORATION_TYPES[0];
    const strategy = SECTOR_STRATEGIES[type][0];
    const modern = seedCapitalStock(500_000, strategy.supply, COMMODITY_BASE_PRICES, 1);
    const era = seedCapitalStock(
      500_000 * nominal1953,
      strategy.supply,
      COMMODITY_BASE_PRICES,
      SCALE_1953
    );
    expect(era).toBeCloseTo(modern, 6);
  });

  it("RPU shrinks by exactly the nominal ratio: one era unit earns era-scale ₳", () => {
    for (const type of CORPORATION_TYPES) {
      const modern = revenuePerCapacityUnit(type, 1);
      if (!(modern > 0)) continue;
      expect(revenuePerCapacityUnit(type, SCALE_1953)).toBeCloseTo(modern * nominal1953, 8);
    }
  });

  it("build cost per REAL unit of economy is era-invariant", () => {
    // capacityPricePerUnit at scale s = modern price × (1/s): a 1953 unit costs
    // 1953 money. Total cost of a fixed REAL capacity (s× more units, each 1/s
    // the price) is the same share of the (1/s-sized) economy.
    for (const type of CORPORATION_TYPES) {
      const modern = capacityPricePerUnit(type, 1953, 1);
      if (!(modern > 0)) continue;
      const era = capacityPricePerUnit(type, 1953, SCALE_1953);
      expect(era).toBeCloseTo(modern * nominal1953, 8);
    }
  });

  it("total staffing for a given real capacity is era-invariant", () => {
    // laborIntensity is workers per unit; era units are SCALE× more numerous,
    // so workers-per-unit must fall by the same factor.
    for (const type of CORPORATION_TYPES) {
      const modern = laborIntensity(type, 1953, 1);
      if (!(modern > 0)) continue;
      expect(laborIntensity(type, 1953, SCALE_1953) * SCALE_1953).toBeCloseTo(modern, 8);
    }
  });

  it("headroom units follow the same law, so market denominators are comparable", () => {
    for (const type of CORPORATION_TYPES) {
      const modern = computeUnownedHeadroomUnits(type, 250_000, 1);
      if (!(modern > 0)) continue;
      const era = computeUnownedHeadroomUnits(type, 250_000 * nominal1953, SCALE_1953);
      expect(era).toBeCloseTo(modern, 6);
    }
  });
});

describe("eraScaledBasePrices", () => {
  it("returns the SAME modern table object at scale 1 (no per-turn allocation, byte-identical)", () => {
    expect(eraScaledBasePrices(1)).toBe(COMMODITY_BASE_PRICES);
    expect(eraScaledBasePrices(NaN)).toBe(COMMODITY_BASE_PRICES);
  });

  it("divides every entry by the scale, floored at a positive price", () => {
    const scaled = eraScaledBasePrices(SCALE_1953);
    for (const commodity of COMMODITY_TYPES) {
      expect(scaled[commodity]).toBeCloseTo(
        Math.max(0.01, COMMODITY_BASE_PRICES[commodity] / SCALE_1953),
        10
      );
      expect(scaled[commodity]).toBeGreaterThan(0);
    }
  });
});

describe("identities that must NOT move with the scale", () => {
  it("units-per-anchor and its reciprocal stay exact inverses at any scale", () => {
    // The pool's two legs (revenue, headroomUnits) are restated through this
    // pair; if it stopped being an exact inverse the legs would drift.
    for (const scale of [1, SCALE_1953]) {
      for (const type of CORPORATION_TYPES) {
        const perAnchor = unownedHeadroomUnitsPerAnchor(type, scale);
        if (!(perAnchor > 0)) continue;
        const revenue = 123_456.789;
        expect((revenue * perAnchor) / perAnchor).toBeCloseTo(revenue, 6);
      }
    }
  });

  it("retool rescale ratios are scale-free (the era factor cancels)", () => {
    // capacityRescaleRatio computes RPU_from / RPU_to internally at scale 1;
    // verify the ratio equals what the era-scaled RPUs would produce.
    for (const type of CORPORATION_TYPES) {
      const strategies = SECTOR_STRATEGIES[type] ?? [];
      if (strategies.length < 2) continue;
      const [a, b] = [strategies[0].id, strategies[1].id];
      const ratio = capacityRescaleRatio(type, a, b);
      const eraFrom = revenuePerCapacityUnitForStrategy(type, a, SCALE_1953);
      const eraTo = revenuePerCapacityUnitForStrategy(type, b, SCALE_1953);
      if (!(eraFrom > 0) || !(eraTo > 0)) continue;
      expect(ratio).toBeCloseTo(eraFrom / eraTo, 8);
    }
  });

  it("nameplate identity: capacity × mixPrice recovers revenue at any scale", () => {
    // sectorTurn's flip identity (revenue === capitalStock × mixPrice), with
    // mixPrice = 1/k at the world's scale.
    const type = CORPORATION_TYPES[0];
    const strategy = SECTOR_STRATEGIES[type][0];
    for (const scale of [1, SCALE_1953]) {
      const revenue = 42_000 / scale;
      const units = impliedOutputUnits(revenue, strategy.supply, COMMODITY_BASE_PRICES, scale);
      const mixPrice = revenuePerCapacityUnitForStrategy(type, strategy.id, scale);
      expect(units * mixPrice).toBeCloseTo(revenue, 6);
    }
  });
});
