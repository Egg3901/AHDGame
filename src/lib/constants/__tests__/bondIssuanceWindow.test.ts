import { describe, it, expect } from "vitest";
import {
  effectiveBondIssuanceWindow,
  MIN_BOND_ISSUANCE,
  BOND_ISSUANCE_MIN_HEADROOM,
} from "@/lib/constants/bonds";

// The per-issuance cap is huge in practice ($500M floor), so the 2x-equity
// leverage headroom is the binding limit for small corps.
const BIG_CAP = 500_000_000;

describe("effectiveBondIssuanceWindow", () => {
  it("ticket #1083: a corp whose 2x-equity headroom is below the flat minimum is NOT locked out", () => {
    // equity 48,500 -> 2x = 97,000 headroom, under the flat 100,000 minimum.
    const w = effectiveBondIssuanceWindow({
      maxPerIssuance: BIG_CAP,
      totalEquity: 48_500,
      existingDebt: 0,
    });
    expect(w.maxAllowed).toBe(97_000);
    expect(w.available).toBe(true);
    // Minimum clamps down to the ceiling, so [effectiveMin, maxAllowed] is non-empty.
    expect(w.effectiveMin).toBe(97_000);
    expect(w.effectiveMin).toBeLessThanOrEqual(w.maxAllowed);
  });

  it("keeps the flat minimum when the corp can afford it", () => {
    const w = effectiveBondIssuanceWindow({
      maxPerIssuance: BIG_CAP,
      totalEquity: 10_000_000,
      existingDebt: 0,
    });
    expect(w.effectiveMin).toBe(MIN_BOND_ISSUANCE);
    expect(w.maxAllowed).toBe(20_000_000);
    expect(w.available).toBe(true);
  });

  it("subtracts existing debt from the leverage headroom", () => {
    const w = effectiveBondIssuanceWindow({
      maxPerIssuance: BIG_CAP,
      totalEquity: 1_000_000,
      existingDebt: 1_500_000,
    });
    // 2x * 1,000,000 - 1,500,000 = 500,000 headroom left.
    expect(w.maxAllowed).toBe(500_000);
    expect(w.effectiveMin).toBe(MIN_BOND_ISSUANCE);
  });

  it("marks bonds unavailable below the dust floor", () => {
    const w = effectiveBondIssuanceWindow({
      maxPerIssuance: BIG_CAP,
      totalEquity: 4_000, // 2x = 8,000, under the dust floor
      existingDebt: 0,
    });
    expect(w.maxAllowed).toBe(8_000);
    expect(w.maxAllowed).toBeLessThan(BOND_ISSUANCE_MIN_HEADROOM);
    expect(w.available).toBe(false);
  });

  it("floors a corp already over its debt limit at zero and unavailable", () => {
    const w = effectiveBondIssuanceWindow({
      maxPerIssuance: BIG_CAP,
      totalEquity: 100_000,
      existingDebt: 500_000, // debt already far past 2x equity
    });
    expect(w.maxAllowed).toBe(0);
    expect(w.available).toBe(false);
    expect(w.effectiveMin).toBe(0);
  });

  it("respects the per-issuance cap when it is the binding limit", () => {
    const w = effectiveBondIssuanceWindow({
      maxPerIssuance: 250_000,
      totalEquity: 100_000_000, // enormous leverage headroom
      existingDebt: 0,
    });
    expect(w.maxAllowed).toBe(250_000);
    expect(w.effectiveMin).toBe(MIN_BOND_ISSUANCE);
  });
});
