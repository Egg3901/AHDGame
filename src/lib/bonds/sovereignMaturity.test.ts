import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { settleSovereignBondMaturity } from "./sovereign";

function setup(treasuryBalance = 100000, principal = 3000) {
  const memory = createInMemoryDb();
  memory.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      currencyCode: "USD",
      treasuryBalance,
      debt: { principal },
      spending: { total: 100, debtInterest: 0 },
      revenue: { total: 100 },
      gdp: 100000,
    },
  ]);
  return memory;
}
const bond = { countryId: "US", currencyCode: "USD", totalIssued: 3000, couponRate: 0 } as const;

describe("sovereign maturity cash and debt", () => {
  it("pays principal from cash and retires the independent debt stock", async () => {
    const memory = setup();
    expect(await settleSovereignBondMaturity(memory as unknown as Db, bond)).toEqual({
      amountLocal: 3000,
      currencyCode: "USD",
    });
    const row = memory.collection("federalBudget").docs[0];
    expect(row.treasuryBalance).toBe(97000);
    expect(row.debt).toMatchObject({ principal: 0 });
  });
  it("excludes the bank-held share for a separate guarded journal transfer", async () => {
    const memory = setup();
    expect(await settleSovereignBondMaturity(memory as unknown as Db, bond, 3000, 1200)).toEqual({
      amountLocal: 3000,
      currencyCode: "USD",
    });
    const row = memory.collection("federalBudget").docs[0];
    expect(row.treasuryBalance).toBe(98_200);
    expect(row.debt).toMatchObject({ principal: 0 });
  });
  it("preserves full-face holder redemption while retiring haircut-adjusted debt", async () => {
    const memory = setup(100000, 1800);
    await settleSovereignBondMaturity(memory as unknown as Db, {
      ...bond,
      restructureHaircutPercent: 0.4,
    });
    expect(memory.collection("federalBudget").docs[0]).toMatchObject({
      treasuryBalance: 97000,
      debt: { principal: 0 },
    });
  });
  it("allows the existing signed treasury to finance redemption without inventing debt", async () => {
    const memory = setup(100, 3000);
    await settleSovereignBondMaturity(memory as unknown as Db, bond);
    expect(memory.collection("federalBudget").docs[0]).toMatchObject({
      treasuryBalance: -2900,
      debt: { principal: 0 },
    });
  });
  it("does not claim a payment when the budget is missing", async () => {
    const memory = createInMemoryDb();
    expect(await settleSovereignBondMaturity(memory as unknown as Db, bond)).toBeNull();
    expect(memory.collection("federalBudget").docs).toHaveLength(0);
  });
  it("rejects a mismatched currency or invalid amount before changing cash or debt", async () => {
    const memory = setup();
    await expect(
      settleSovereignBondMaturity(memory as unknown as Db, { ...bond, currencyCode: "GBP" })
    ).rejects.toThrow("currency");
    await expect(settleSovereignBondMaturity(memory as unknown as Db, bond, NaN)).rejects.toThrow(
      "finite"
    );
    expect(memory.collection("federalBudget").docs[0]).toMatchObject({
      treasuryBalance: 100000,
      debt: { principal: 3000 },
    });
  });
});
