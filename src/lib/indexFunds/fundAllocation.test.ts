import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { computeFundAllocationBreakdown } from "./fundAllocation";
import {
  INDEX_FUND_MAX_EQUITY_ALLOCATION,
  INDEX_FUND_MIN_BOND_RESERVE_ALLOCATION,
} from "./unitAccounting";

describe("computeFundAllocationBreakdown", () => {
  it("blocks new stock buys when equities are above the 75% cap", () => {
    const breakdown = computeFundAllocationBreakdown(
      {
        cashAnchor: 15_000_000,
        holdings: [
          {
            corporationId: new ObjectId(),
            shares: 1000,
            avgCostPerShareAnchor: 60_000,
            lastValueAnchor: 60_000_000,
          },
        ],
      },
      { bondPrincipalAnchor: 0 }
    );

    expect(INDEX_FUND_MAX_EQUITY_ALLOCATION).toBe(0.75);
    expect(INDEX_FUND_MIN_BOND_RESERVE_ALLOCATION).toBe(0.25);
    expect(breakdown.stockPurchaseBudgetAnchor).toBe(0);
    expect(breakdown.reserveShortfallAnchor).toBeCloseTo(3_750_000, 0);
  });

  it("allows stock purchases only within the equity headroom", () => {
    const breakdown = computeFundAllocationBreakdown(
      { cashAnchor: 40_000_000, holdings: [] },
      { bondPrincipalAnchor: 10_000_000 }
    );

    expect(breakdown.equityHeadroomAnchor).toBeCloseTo(37_500_000, 0);
    expect(breakdown.stockPurchaseBudgetAnchor).toBeCloseTo(37_500_000, 0);
  });
});
