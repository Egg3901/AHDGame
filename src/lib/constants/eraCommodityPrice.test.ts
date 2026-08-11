/**
 * Commodity base prices must be denominated in the era's own money.
 *
 * `COMMODITY_BASE_PRICES` is a single 2019-calibrated table. Seeding it into a
 * 1953 world prices a mid-century economy in modern dollars — the same nominal
 * mismatch the unowned-sector floor had, applied to every commodity market at
 * once.
 *
 * The scaling is deliberately UNIFORM rather than per-commodity history: it
 * moves the price LEVEL and leaves relative prices to the market.
 */
import { describe, expect, it } from "vitest";
import { COMMODITY_BASE_PRICES, COMMODITY_TYPES } from "./commodities";
import { getEraCommodityBasePrice, getEraNominalScale } from "./sectorSeedEra";

describe("getEraCommodityBasePrice", () => {
  it("is a strict no-op for every modern preset, alias and unknown string", () => {
    for (const preset of [
      "2019-default",
      "2023-default",
      "1991-default",
      "1999-default",
      "2007-default",
      "1979-default",
      "empty",
      "2019-no-parties",
      "not-a-real-preset",
      undefined,
    ]) {
      for (const commodity of COMMODITY_TYPES) {
        const modern = COMMODITY_BASE_PRICES[commodity];
        expect(getEraCommodityBasePrice(modern, preset), `${commodity} @ ${preset}`).toBe(modern);
      }
    }
  });

  it("deflates a 1953 world by the era's nominal-money scale", () => {
    const scale = getEraNominalScale("1953-default");
    // Sanity: 1953 really is a far smaller nominal economy.
    expect(scale).toBeLessThan(0.05);
    expect(scale).toBeGreaterThan(0);

    for (const commodity of COMMODITY_TYPES) {
      const modern = COMMODITY_BASE_PRICES[commodity];
      expect(getEraCommodityBasePrice(modern, "1953-default")).toBeCloseTo(modern * scale, 6);
    }
  });

  it("puts 1953 steel and energy in mid-century money", () => {
    // Steel ₳800/ton and energy ₳60/MWh are 2019 numbers. At 1953 nominal
    // scale they land in single/low double digits, which is the point.
    const steel = getEraCommodityBasePrice(COMMODITY_BASE_PRICES.steel, "1953-default");
    const energy = getEraCommodityBasePrice(COMMODITY_BASE_PRICES.energy, "1953-default");
    expect(steel).toBeLessThan(COMMODITY_BASE_PRICES.steel / 20);
    expect(energy).toBeLessThan(COMMODITY_BASE_PRICES.energy / 20);
    expect(steel).toBeGreaterThan(0);
    expect(energy).toBeGreaterThan(0);
  });

  it("preserves RELATIVE prices — the market sets those, not the era table", () => {
    // A uniform deflation must not reorder or reweight commodities against
    // each other. This is what makes it gentle rather than authored history.
    const ratioModern = COMMODITY_BASE_PRICES.steel / COMMODITY_BASE_PRICES.energy;
    const ratio1953 =
      getEraCommodityBasePrice(COMMODITY_BASE_PRICES.steel, "1953-default") /
      getEraCommodityBasePrice(COMMODITY_BASE_PRICES.energy, "1953-default");
    expect(ratio1953).toBeCloseTo(ratioModern, 6);
  });

  it("never rounds a price to zero", () => {
    // Every downstream ratio divides by a unit price.
    for (const preset of ["1953-default", "2019-default"]) {
      for (const commodity of COMMODITY_TYPES) {
        expect(getEraCommodityBasePrice(COMMODITY_BASE_PRICES[commodity], preset)).toBeGreaterThan(
          0
        );
      }
    }
    // Even an absurdly small input stays positive.
    expect(getEraCommodityBasePrice(0.001, "1953-default")).toBeGreaterThan(0);
  });
});
