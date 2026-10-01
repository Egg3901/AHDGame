import { describe, expect, it } from "vitest";
import { validateTreasuryReserveTransfer } from "./treasuryReserveTransfer";
const base = {
  amount: 1000,
  annualRevenue: 1000000,
  annualSpending: 900000,
  debtCeiling: 10000000,
};
describe("treasury reserve transfer policy", () => {
  it("retains annual revenue cap and derived debt-ceiling eligibility", () => {
    expect(validateTreasuryReserveTransfer(base)).toBeUndefined();
    expect(validateTreasuryReserveTransfer({ ...base, amount: 5001 })).toMatch(/per-turn cap/);
    expect(validateTreasuryReserveTransfer({ ...base, annualSpending: 11000000 })).toMatch(
      /debt ceiling/
    );
    expect(
      validateTreasuryReserveTransfer({ ...base, annualSpending: 11000000, debtCeiling: null })
    ).toBeUndefined();
  });
  it.each([0, -1, NaN, Infinity])("refuses invalid amount %s", (amount) =>
    expect(validateTreasuryReserveTransfer({ ...base, amount })).toMatch(/positive/)
  );
});
