import { describe, expect, it } from "vitest";
import { COMMODITY_TYPES } from "@/lib/constants/commodities";
import {
  COMMODITY_DEMAND_CALIBRATION,
  commodityDemandCalibration,
} from "@/lib/constants/commodityDemandCalibration";

/**
 * The calibration exists because money-to-units demand generators divide by an
 * era-scaled base price, so a rate calibrated in one era misfires in another.
 * These tests pin the two properties that matter: it corrects 1953, and it is
 * provably inert everywhere else.
 */
describe("commodity demand calibration", () => {
  it("is inert for every era without an authored correction", () => {
    for (const era of ["1979", "1991", "1999", "2007", "2019", "2023"]) {
      for (const commodity of COMMODITY_TYPES) {
        expect(commodityDemandCalibration(era, commodity)).toBe(1);
      }
    }
  });

  it("is inert for an unknown or missing era", () => {
    expect(commodityDemandCalibration(undefined, "advertising")).toBe(1);
    expect(commodityDemandCalibration(null, "advertising")).toBe(1);
    expect(commodityDemandCalibration("1861", "advertising")).toBe(1);
  });

  it("only ever damps demand, never amplifies it", () => {
    // An amplifier would be a supply problem wearing a demand fix. Every entry
    // here exists because a money-scaled generator overwhelmed unit-scaled
    // supply, so every entry must be < 1.
    for (const [era, table] of Object.entries(COMMODITY_DEMAND_CALIBRATION)) {
      for (const [commodity, mult] of Object.entries(table)) {
        expect(mult, `${era}/${commodity}`).toBeGreaterThan(0);
        expect(mult, `${era}/${commodity}`).toBeLessThan(1);
      }
    }
  });

  it("corrects the commodities measured as starved in 1953, and no others", () => {
    // Measured on a 400-turn 1953 ledger soak. Correcting a commodity that was
    // not starved would create a glut, so the key set is asserted exactly.
    expect(Object.keys(COMMODITY_DEMAND_CALIBRATION["1953"]).sort()).toEqual(
      ["advertising", "energy", "healthcare_services", "iron", "natural_gas", "oil"].sort()
    );
  });

  it("brings each corrected commodity's measured supply/demand near balance", () => {
    // Raw (pre-correction) supply/demand for each entry, from the calibration
    // basis in commodityDemandCalibration.ts. advertising / natural_gas /
    // healthcare_services were re-measured on live prod flow at t185
    // (2026-08-17): raw = live corrected S/D x live mult (11.2 x 0.035, etc.),
    // because the original 400-turn soak understated live supply and the
    // soak-sized cuts had overshot those three into 5-11x gluts. iron / oil /
    // energy keep the soak measurements their unchanged multipliers were
    // sized against. Applying the multiplier to demand should land each in a
    // sane band — short enough that scarcity still means something, not so
    // short that price runs away.
    const measuredSd: Record<string, number> = {
      advertising: 0.39,
      natural_gas: 0.67,
      healthcare_services: 0.83,
      iron: 0.4,
      oil: 0.5,
      energy: 0.5,
    };
    for (const [commodity, sd] of Object.entries(measuredSd)) {
      const mult = COMMODITY_DEMAND_CALIBRATION["1953"][commodity as never] as number;
      const corrected = sd / mult;
      expect(corrected, `${commodity} corrected S/D`).toBeGreaterThan(0.75);
      expect(corrected, `${commodity} corrected S/D`).toBeLessThan(1.25);
    }
  });

  it("references only real commodities", () => {
    for (const table of Object.values(COMMODITY_DEMAND_CALIBRATION)) {
      for (const commodity of Object.keys(table)) {
        expect(COMMODITY_TYPES).toContain(commodity);
      }
    }
  });
});
