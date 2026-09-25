import { describe, it, expect } from "vitest";
import {
  EUROZONE_2027_MEMBERS,
  convertLegacyToEuro,
  euroAdoptionYear,
  euroConversionFactor,
  isEuroAdopted,
  legacyAnchorValue,
} from "./euroAdoption";

// Authored 2019-table game rates (the table the 2027 seeder uses).
const RATES: Record<string, number> = {
  DE: 0.92,
  FR: 4.2,
  IT: 833,
  ES: 67,
  GR: 37.0,
  AT: 13.4,
  FI: 3.9,
  IE: 0.92,
};

describe("euroAdoption rules", () => {
  it("covers exactly the eight euro members", () => {
    expect([...EUROZONE_2027_MEMBERS].sort()).toEqual(
      ["AT", "DE", "ES", "FI", "FR", "GR", "IE", "IT"].sort()
    );
  });

  it("gates on the 2027 preset only; 1991 and other presets pass through", () => {
    for (const m of EUROZONE_2027_MEMBERS) {
      expect(isEuroAdopted(m, "2027-default")).toBe(true);
      expect(isEuroAdopted(m, "1991-default")).toBe(false);
      expect(isEuroAdopted(m, "2019-default")).toBe(false);
      expect(isEuroAdopted(m, "2023-default")).toBe(false);
    }
    expect(isEuroAdopted("UK", "2027-default")).toBe(false);
    expect(isEuroAdopted("SE", "2027-default")).toBe(false);
    expect(isEuroAdopted("US", "2027-default")).toBe(false);
  });

  it("records adoption years (1999, GR 2001) and null for non-members", () => {
    expect(euroAdoptionYear("DE")).toBe(1999);
    expect(euroAdoptionYear("FI")).toBe(1999);
    expect(euroAdoptionYear("GR")).toBe(2001);
    expect(euroAdoptionYear("UK")).toBeNull();
    expect(euroAdoptionYear("US")).toBeNull();
  });

  it("conserves anchor value at the authored cross rate (no ECB parities)", () => {
    for (const m of EUROZONE_2027_MEMBERS) {
      if (m === "DE") continue; // anchor itself, no conversion
      const legacy = 1_000_000;
      const eur = convertLegacyToEuro(legacy, RATES[m], RATES.DE);
      // Anchor value identical before and after.
      expect(legacyAnchorValue(eur, RATES.DE)).toBeCloseTo(legacyAnchorValue(legacy, RATES[m]), 9);
      // Cross-rate check, not the official ECB parity (FRF 6.55957).
      expect(eur).toBeCloseTo((legacy * RATES.DE) / RATES[m], 9);
    }
    // France lands near real 2019 magnitudes, not shrunk 30% by ECB parity.
    const frEur = convertLegacyToEuro(11_733_333_333_333, RATES.FR, RATES.DE);
    expect(frEur).toBeGreaterThan(2_000_000_000_000);
    expect(frEur).toBeLessThan(3_000_000_000_000);
  });

  it("Ireland converts at factor 1.0 (amounts unchanged, code flips)", () => {
    expect(euroConversionFactor(RATES.IE, RATES.DE)).toBe(1);
    expect(convertLegacyToEuro(12345, RATES.IE, RATES.DE)).toBe(12345);
  });

  it("bad rates pass through instead of zeroing balances", () => {
    expect(euroConversionFactor(0, 0.92)).toBe(1);
    expect(euroConversionFactor(NaN, 0.92)).toBe(1);
    expect(convertLegacyToEuro(500, 0, 0.92)).toBe(500);
  });
});
