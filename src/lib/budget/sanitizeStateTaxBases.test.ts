/**
 * `sanitizeStateTaxBases` — a NaN tax base must not be permanent.
 *
 * NaN is absorbing under multiplication, so once one reaches a state's
 * `taxBases` every growth step carries it forward and it spreads into
 * `revenue.{incomeTax,salesTax,propertyTax,total}`, `balance` and `surplus`.
 * Berlin's live doc had exactly that, and nothing detected it — NaN fails every
 * comparison silently rather than throwing (#1323).
 */
import { describe, it, expect } from "vitest";
import type { StateTaxBases } from "@/lib/db/types/budget";
import { sanitizeStateTaxBases } from "./revenue";

const GDP = 8_158_147_000; // Berlin, full units

const healthy: StateTaxBases = {
  taxableIncome: 1_000,
  taxableSales: 2_000,
  domesticCorporateProfits: 300,
  foreignCorporateProfits: 100,
  propertyValue: 5_000,
};

describe("sanitizeStateTaxBases", () => {
  it("leaves a healthy set untouched, and says so", () => {
    const { bases, repaired } = sanitizeStateTaxBases(healthy, GDP);
    expect(repaired).toEqual([]);
    // Same object identity: callers can treat "no repair" as a cheap no-op.
    expect(bases).toBe(healthy);
  });

  it("re-derives only the non-finite entries from regional GDP", () => {
    const { bases, repaired } = sanitizeStateTaxBases(
      { ...healthy, taxableIncome: Number.NaN, propertyValue: Number.NaN },
      GDP
    );
    expect(repaired.sort()).toEqual(["propertyValue", "taxableIncome"]);
    expect(Number.isFinite(bases.taxableIncome)).toBe(true);
    expect(Number.isFinite(bases.propertyValue)).toBe(true);
    expect(bases.taxableIncome).toBeGreaterThan(0);
    // Untouched entries keep their exact values — this is a repair, not a reset.
    expect(bases.taxableSales).toBe(healthy.taxableSales);
    expect(bases.domesticCorporateProfits).toBe(healthy.domesticCorporateProfits);
  });

  it("repairs Infinity as well as NaN", () => {
    const { repaired } = sanitizeStateTaxBases(
      { ...healthy, taxableSales: Number.POSITIVE_INFINITY },
      GDP
    );
    expect(repaired).toEqual(["taxableSales"]);
  });

  it("leaves bases alone when GDP gives it nothing to re-derive from", () => {
    // Zeroing here would silently delete the region's revenue, which is worse
    // than the NaN it replaces.
    for (const gdp of [0, -1, Number.NaN]) {
      const broken = { ...healthy, taxableIncome: Number.NaN };
      const { bases, repaired } = sanitizeStateTaxBases(broken, gdp);
      expect(repaired).toEqual([]);
      expect(bases).toBe(broken);
    }
  });

  it("produces bases that survive a growth step", () => {
    // The point of the repair: the value must be usable, not merely non-NaN.
    const { bases } = sanitizeStateTaxBases({ ...healthy, taxableIncome: Number.NaN }, GDP);
    const grown = bases.taxableIncome * 1.001;
    expect(Number.isFinite(grown)).toBe(true);
  });
});
