import { describe, expect, it } from "vitest";
import type { Bond } from "@/lib/db/types/bond";
import {
  computeBankTreasuryCashFloor,
  computeBankTreasuryDueInterest,
  bankTreasuryHolderUnits,
  allocateBankTreasuryHolderLots,
  planBankTreasurySweep,
  quoteBankTreasuryBond,
} from "./bankTreasury";
import { bankBalanceSheet, bankEquity, regulatoryCapital } from "./balanceSheet";
import { assessCapital } from "./capitalAdequacy";

describe("bank treasury rules", () => {
  it("sums and allocates settled positions by bank charter epoch", () => {
    const holders = [
      { bankId: "bank-a", charteredTurn: 10, lotId: "lot-1", units: 3 },
      { bankId: "bank-a", charteredTurn: 10, lotId: "lot-2", units: 4 },
      { bankId: "bank-a", charteredTurn: 10, tradeId: "pending", units: 2 },
      { bankId: "bank-a", charteredTurn: 9, lotId: "old", units: 8 },
      { bankId: "bank-b", charteredTurn: 10, lotId: "other", units: 9 },
    ];
    expect(bankTreasuryHolderUnits(holders, "bank-a", 10)).toBe(7);
    expect(allocateBankTreasuryHolderLots(holders, "bank-a", 10, 6)).toEqual([
      { lotId: "lot-1", units: 3 },
      { lotId: "lot-2", units: 3 },
    ]);
  });

  it("keeps cash purchases on equity, prices spread loss, and excludes bills from reserve cash", () => {
    const before = { cashReserves: 1_000, totalLoans: 1_000, npcDeposits: 500, totalDeposits: 500 };
    const afterPurchase = { ...before, cashReserves: 800, sovereignTreasuryMarkValue: 200 };
    expect(bankEquity(afterPurchase)).toBe(bankEquity(before));
    expect(bankEquity({ ...afterPurchase, sovereignTreasuryMarkValue: 180 })).toBe(
      bankEquity(before) - 20
    );
    expect(regulatoryCapital(afterPurchase)).toBe(1_000);
    expect(
      assessCapital({
        cashReserves: afterPurchase.cashReserves,
        sovereignTreasuryMarkValue: 200,
        totalLoans: 1_000,
        borrowings: {},
      }).riskAssetsAnchor
    ).toBe(1_200);
    const sheet = bankBalanceSheet({
      charter: {
        ...afterPurchase,
        type: "retail",
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        postedCapital: 0,
        depositOffset: 0,
        lendingOffset: 0,
        capitalStanding: "adequate",
      },
      reserveRatio: 0.1,
    });
    expect(sheet.requiredReserves).toBe(50);
    expect(sheet.reserveCoverRatio).toBe(16);
    expect(sheet.reserveCoverRatio).not.toBe(20);
  });

  it("does not inherit a prior epoch's mark on recharter", () => {
    const priorEpoch = {
      cashReserves: 0,
      totalLoans: 0,
      npcDeposits: 0,
      sovereignTreasuryMarkValue: 500,
    };
    const newEpoch = { cashReserves: 0, totalLoans: 0, npcDeposits: 0 };
    expect(bankEquity(priorEpoch)).toBe(500);
    expect(bankEquity(newEpoch)).toBe(0);
  });

  it("prices the next interest reserve from current prime and funded borrowing terms", () => {
    expect(
      computeBankTreasuryDueInterest({
        currency: "USD",
        primeRate: 4,
        inflationRate: 2,
        depositOffset: -1,
        npcDeposits: 1_000_000,
        totalDeposits: 1_100_000,
        playerDeposits: 0,
        playerDepositsAreLiabilities: false,
        discountWindowDebt: 48_000,
        cbMarginDebt: 24_000,
        interbankLoans: [{ outstanding: 10_000, ratePercent: 6 }],
      })
    ).toBe(776.67);
    expect(
      computeBankTreasuryDueInterest({
        currency: "USD",
        primeRate: 4,
        inflationRate: 2,
        depositOffset: -1,
        npcDeposits: 1_000_000,
        totalDeposits: 1_100_000,
        playerDeposits: 100_000,
        playerDepositsAreLiabilities: true,
        discountWindowDebt: 0,
        cbMarginDebt: 0,
        interbankLoans: [],
      })
    ).toBe(687.5);
  });

  it("keeps required reserves, the 2.5 percent NPC outflow, and due interest in cash", () => {
    expect(
      computeBankTreasuryCashFloor({
        cashBackedDeposits: 1_000_000,
        npcDeposits: 800_000,
        reserveRatio: 0.2,
        nextTurnDueInterest: 2_500,
      })
    ).toEqual({
      requiredReserves: 200_000,
      withdrawalBufferLocal: 20_000,
      nextTurnDueInterest: 2_500,
      floorLocal: 222_500,
    });
  });

  it("quotes only same-currency sovereign public float within 48 turns", () => {
    const bond = {
      _id: { toHexString: () => "bond-short" },
      issuerType: "sovereign",
      countryId: "US",
      currencyCode: "USD",
      marketPrice: 0.9,
      couponRate: 4,
      maturityTurn: 148,
      matured: false,
      defaulted: false,
      publicFloat: 20,
    } as unknown as Bond;
    expect(
      quoteBankTreasuryBond({
        bond,
        currency: "USD",
        currentTurn: 100,
        poolCashLocal: 500_000,
        poolTargetCashLocal: 1_000_000,
      })
    ).toMatchObject({ eligible: true, remainingTurns: 48, publicFloatUnits: 20 });
    expect(
      quoteBankTreasuryBond({
        bond: { ...bond, currencyCode: "GBP" },
        currency: "USD",
        currentTurn: 100,
        poolCashLocal: 500_000,
        poolTargetCashLocal: 1_000_000,
      }).eligible
    ).toBe(false);
  });

  it("sweeps only above the cash floor, nearest maturity first, bounded by float", () => {
    const quote = (bondId: string, remainingTurns: number, ask: number, float: number) => ({
      bondId,
      currency: "USD" as const,
      remainingTurns,
      couponRate: 4,
      publicFloatUnits: float,
      bidPerUnitLocal: ask - 1,
      askPerUnitLocal: ask,
      poolCashLocal: 100_000,
      depthUnitsAtBid: 100,
      eligible: true,
    });
    expect(
      planBankTreasurySweep(
        [quote("later", 48, 1_000, 50), quote("first", 12, 1_000, 2)],
        5_500,
        2_500
      )
    ).toEqual([
      { bondId: "first", units: 2, askPerUnitLocal: 1_000, costLocal: 2_000 },
      { bondId: "later", units: 1, askPerUnitLocal: 1_000, costLocal: 1_000 },
    ]);
  });
});
