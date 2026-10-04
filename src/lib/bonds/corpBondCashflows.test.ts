import { describe, it, expect } from "vitest";
import type { Bond } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  netPerTurnDebtServiceAnchor,
  perTurnBondCouponIncomeAsHolder,
  perTurnIssuerBondInterestExpense,
} from "./corpBondCashflows";

const NO_FX = new Map<CurrencyCode, number>();

function bond(overrides: Partial<Bond>): Bond {
  return {
    couponRate: 12,
    currencyCode: "USD",
    totalIssued: 48_000_000,
    defaulted: false,
    ...overrides,
  } as Bond;
}

describe("perTurnBondCouponIncomeAsHolder", () => {
  it("counts a performing bond's per-turn coupon", () => {
    // 400 units × 1,000 face × 12% / 48 turns = 1,000 per turn.
    expect(perTurnBondCouponIncomeAsHolder([{ bond: bond({}), units: 400 }], NO_FX)).toBe(1_000);
  });

  it("books nothing for a defaulted bond, which the bond turn never pays", () => {
    // A live corp held 1.45M units of a defaulted sovereign. Counting them
    // booked ~70% of its coupon income as phantom, and the corp turn taxed it.
    const positions = [
      { bond: bond({}), units: 400 },
      { bond: bond({ defaulted: true, couponRate: 23 }), units: 1_450_000 },
    ];
    expect(perTurnBondCouponIncomeAsHolder(positions, NO_FX)).toBe(1_000);
  });
});

describe("perTurnIssuerBondInterestExpense", () => {
  it("keeps a defaulted bond's interest: the debt is still owed", () => {
    // Dropping it would let an issuer raise its dividends and share price by
    // defaulting. 48M issued × 12% / 48 turns = 120,000 per turn.
    expect(perTurnIssuerBondInterestExpense([bond({ defaulted: true })], NO_FX)).toBe(120_000);
  });
});

describe("netPerTurnDebtServiceAnchor", () => {
  it("does not let phantom coupons from a defaulted holding offset real interest", () => {
    const debtService = netPerTurnDebtServiceAnchor({
      issuerBonds: [bond({})],
      heldPositions: [{ bond: bond({ defaulted: true }), units: 1_000_000 }],
      fxByCurrency: NO_FX,
      isNationalEnterprise: false,
    });
    expect(debtService).toBe(120_000);
  });
});
