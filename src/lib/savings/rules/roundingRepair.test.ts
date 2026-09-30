import { describe, expect, it } from "vitest";
import { savingsRoundingRepair } from "./roundingRepair";
import type { SavingsAccountSnapshot } from "./accounts";
const account: SavingsAccountSnapshot = {
  id: "a".repeat(24),
  ownerType: "character",
  ownerId: "b".repeat(24),
  currency: "USD",
  holder: "centralBank",
  balance: -3e-12,
  status: "open",
  version: 1,
  accruedInterest: 0,
  interestEarned: 0,
  openedTurn: 1,
};
describe("legacy withdrawal rounding repair", () => {
  it("journals the exact representational adjustment without cash legs", () => {
    const result = savingsRoundingRepair(account, "US", 3);
    expect(result?.legs).toEqual([]);
    expect(result?.event.meta).toEqual({ roundingAdjustment: 3e-12, cashMoved: 0 });
    expect(result?.projections[2].filter).toMatchObject({ balance: -3e-12, version: 1 });
    expect(result?.projections[2].update).toMatchObject({ $set: { balance: 0 } });
  });
  it.each([-1, -0.001, -1e-8, 0, 1, NaN, Infinity])(
    "refuses a balance outside the original float tolerance: %s",
    (balance) => {
      expect(savingsRoundingRepair({ ...account, balance }, "US", 3)).toBeNull();
    }
  );
  it("refuses a frozen account", () => {
    expect(savingsRoundingRepair({ ...account, status: "frozen" }, "US", 3)).toBeNull();
  });
});
