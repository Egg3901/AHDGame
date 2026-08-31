import { describe, it, expect } from "vitest";
import {
  effectiveBondIssuanceWindow,
  MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION,
  MIN_BOND_ISSUANCE,
  BOND_ISSUANCE_MIN_HEADROOM,
} from "@/lib/constants/bonds";

// The per-issuance cap is huge in practice ($500M floor), so the 2x-equity
// leverage headroom is the binding limit for small corps.
const BIG_CAP = 500_000_000;

// Exit equity large enough never to bind, for the cases that are about the
// other two constraints. Cases that exercise the exit cap set it explicitly.
const AMPLE_EXIT = 1e15;

describe("effectiveBondIssuanceWindow", () => {
  it("ticket #1083: a corp whose 2x-equity headroom is below the flat minimum is NOT locked out", () => {
    // equity 48,500 -> 2x = 97,000 headroom, under the flat 100,000 minimum.
    const w = effectiveBondIssuanceWindow({
      maxPerIssuance: BIG_CAP,
      totalEquity: 48_500,
      existingDebt: 0,
      exitEquity: AMPLE_EXIT,
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
      exitEquity: AMPLE_EXIT,
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
      exitEquity: AMPLE_EXIT,
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
      exitEquity: AMPLE_EXIT,
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
      exitEquity: AMPLE_EXIT,
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
      exitEquity: AMPLE_EXIT,
    });
    expect(w.maxAllowed).toBe(250_000);
    expect(w.effectiveMin).toBe(MIN_BOND_ISSUANCE);
    expect(w.limitedBy).toBe("perIssuance");
  });

  describe("ticket #1198: exit-equity cap", () => {
    it("caps headroom at realizable assets when going-concern equity is far larger", () => {
      const w = effectiveBondIssuanceWindow({
        maxPerIssuance: BIG_CAP,
        totalEquity: 100_000_000, // 2x = 200,000,000 of going-concern headroom
        existingDebt: 0,
        exitEquity: 3_000_000, // but only 3,000,000 could actually be realized
      });
      expect(w.maxAllowed).toBe(3_000_000);
      expect(w.limitedBy).toBe("exitEquity");
    });

    it("names the leverage limit when it binds before the exit cap", () => {
      const w = effectiveBondIssuanceWindow({
        maxPerIssuance: BIG_CAP,
        totalEquity: 1_000_000, // 2x = 2,000,000
        existingDebt: 0,
        exitEquity: 10_000_000,
      });
      expect(w.maxAllowed).toBe(2_000_000);
      expect(w.limitedBy).toBe("leverage");
    });

    it("subtracts existing debt from the exit headroom too", () => {
      const w = effectiveBondIssuanceWindow({
        maxPerIssuance: BIG_CAP,
        totalEquity: 100_000_000,
        existingDebt: 2_500_000,
        exitEquity: 3_000_000,
      });
      expect(w.maxAllowed).toBe(500_000);
      expect(w.limitedBy).toBe("exitEquity");
    });

    it("offers nothing to a corp whose debt already exceeds what it could realize", () => {
      const w = effectiveBondIssuanceWindow({
        maxPerIssuance: BIG_CAP,
        totalEquity: 100_000_000, // still enormous on the going-concern basis
        existingDebt: 5_000_000,
        exitEquity: 3_000_000,
      });
      expect(w.maxAllowed).toBe(0);
      expect(w.available).toBe(false);
      expect(w.limitedBy).toBe("exitEquity");
    });

    it("reproduces corporation #624: a ~75x basis gap collapses to the realizable figure", () => {
      // Live figures at turn 415, in ₳.
      const goingConcernEquity = 234_449_153_037;
      const exitEquity = 4_913_167_095;
      const w = effectiveBondIssuanceWindow({
        maxPerIssuance: 1e12, // revenue cap was not the binding limit for #624
        totalEquity: goingConcernEquity,
        existingDebt: 0,
        exitEquity,
      });
      // Pre-fix this quoted 2 x 234bn = ~468bn of headroom. The corp drew
      // ₳4.52bn of it and was declared insolvent two turns later.
      expect(w.maxAllowed).toBe(exitEquity);
      expect(w.limitedBy).toBe("exitEquity");
      // The debt it actually took is still legal under the new ceiling, so the
      // fix does not retroactively strand it.
      expect(4_522_737_824).toBeLessThanOrEqual(w.maxAllowed);
    });

    it("INVARIANT: the minimum never exceeds the ceiling, even in the dust band", () => {
      // A corp whose exit headroom lands between the dust floor and the flat
      // minimum must still have a legal issuance to make. The Bonds tab relies
      // on this: it renders `minIssuance` and `maxAllowedIssuance` as the two
      // ends of one slider, so min > max would leave it unable to issue at all.
      for (const exitEquity of [10_000, 10_400, 12_345, 99_999, 100_001, 250_000]) {
        const w = effectiveBondIssuanceWindow({
          maxPerIssuance: BIG_CAP,
          totalEquity: 1e9,
          existingDebt: 0,
          exitEquity,
        });
        expect(w.effectiveMin).toBeLessThanOrEqual(w.maxAllowed);
        expect(w.limitedBy).toBe("exitEquity");
      }
    });

    it("INVARIANT: borrowing the full window can never leave debt above exit equity", () => {
      // This property is the whole point of the cap: `filterInsolventCorps`
      // declares insolvency at `exitEquity < debt`, so a corp that stays inside
      // its quoted ceiling must never be able to reach that condition.
      const cases = [
        { totalEquity: 1e9, existingDebt: 0, exitEquity: 5_000_000 },
        { totalEquity: 1e9, existingDebt: 4_000_000, exitEquity: 5_000_000 },
        { totalEquity: 500, existingDebt: 0, exitEquity: 1e9 },
        { totalEquity: 1e9, existingDebt: 0, exitEquity: 0 },
        { totalEquity: 0, existingDebt: 0, exitEquity: 0 },
        { totalEquity: 1e9, existingDebt: 9_000_000, exitEquity: 5_000_000 },
      ];
      for (const c of cases) {
        const w = effectiveBondIssuanceWindow({ maxPerIssuance: BIG_CAP, ...c });
        const debtAfterMaxDraw = c.existingDebt + w.maxAllowed;
        // Already-over-ceiling corps are the one case where debt can exceed
        // exit equity, and only because it did so BEFORE this issuance: the
        // window correctly offers them zero.
        if (c.existingDebt <= c.exitEquity * MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION) {
          expect(debtAfterMaxDraw).toBeLessThanOrEqual(
            c.exitEquity * MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION
          );
        } else {
          expect(w.maxAllowed).toBe(0);
        }
      }
    });
  });
});
