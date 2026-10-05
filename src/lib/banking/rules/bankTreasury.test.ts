import { describe, expect, it } from "vitest";
import type { Bond } from "@/lib/db/types/bond";
import {
  computeBankTreasuryCashFloor,
  computeBankTreasuryDueInterest,
  computeBankTreasuryFundingRatePercent,
  bankTreasuryHolderUnits,
  allocateBankTreasuryHolderLots,
  bankTreasuryAllocatedCostBasis,
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

  it("computes realized sale basis from every allocated lot and fails closed on unknown basis", () => {
    const holders = [
      { bankId: "bank-a", charteredTurn: 10, lotId: "lot-1", units: 3, avgCostPerUnit: 900 },
      { bankId: "bank-a", charteredTurn: 10, lotId: "lot-2", units: 4, avgCostPerUnit: 950 },
    ];
    const allocations = [
      { lotId: "lot-1", units: 2 },
      { lotId: "lot-2", units: 3 },
    ];
    expect(bankTreasuryAllocatedCostBasis(holders, allocations, "USD")).toBe(4_650);
    expect(
      bankTreasuryAllocatedCostBasis(
        [{ ...holders[0] }, { ...holders[1], avgCostPerUnit: undefined }],
        allocations,
        "USD"
      )
    ).toBeNull();
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
        totalDeposits: 500,
        playerDeposits: 0,
        propBookMarkValue: 0,
        discountWindowDebt: 0,
        discountWindowArrears: 0,
        cbMarginDebt: 0,
        cbMarginArrears: 0,
        interbankDebt: 0,
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

  it("rejects a one-turn 7 percent bill quoted at 1010 as negative carry", () => {
    const bond = {
      _id: { toHexString: () => "bond-loss" },
      issuerType: "sovereign",
      countryId: "US",
      currencyCode: "USD",
      marketPrice: 1,
      couponRate: 7,
      maturityTurn: 101,
      matured: false,
      defaulted: false,
      publicFloat: 20,
    } as unknown as Bond;
    const quote = quoteBankTreasuryBond({
      bond,
      currency: "USD",
      currentTurn: 100,
      poolCashLocal: 100_000,
      poolTargetCashLocal: 100_000,
    });
    expect(quote.askPerUnitLocal).toBe(1_010);
    expect(quote.annualizedContractYieldPercent).toBeLessThan(0);
    expect(planBankTreasurySweep([quote], 2_000, 0, 0)).toEqual([]);
    const malformed = quoteBankTreasuryBond({
      bond: { ...bond, couponRate: Number.POSITIVE_INFINITY },
      currency: "USD",
      currentTurn: 100,
      poolCashLocal: 100_000,
      poolTargetCashLocal: 100_000,
    });
    expect(malformed.annualizedContractYieldPercent).toBe(Number.NEGATIVE_INFINITY);
  });

  it("uses zero hurdle without liabilities and ranks positive carry by annual yield", () => {
    const noLiabilities = {
      currency: "USD" as const,
      primeRate: 4,
      inflationRate: 0,
      depositOffset: 0,
      npcDeposits: 0,
      totalDeposits: 0,
      playerDeposits: 0,
      playerDepositsAreLiabilities: true,
      discountWindowDebt: 0,
      cbMarginDebt: 0,
      interbankLoans: [],
    };
    expect(computeBankTreasuryFundingRatePercent(noLiabilities)).toBe(0);
    const quote = (
      bondId: string,
      remainingTurns: number,
      ask: number,
      float: number,
      annualizedContractYieldPercent: number
    ) => ({
      bondId,
      currency: "USD" as const,
      remainingTurns,
      couponRate: 4,
      publicFloatUnits: float,
      bidPerUnitLocal: ask - 1,
      askPerUnitLocal: ask,
      annualizedContractYieldPercent,
      poolCashLocal: 100_000,
      depthUnitsAtBid: 100,
      eligible: true,
    });
    expect(
      planBankTreasurySweep(
        [
          quote("later", 48, 1_000, 50, 3),
          quote("first", 12, 1_000, 2, 6),
          quote("negative", 1, 1_000, 2, 2),
        ],
        5_500,
        2_500,
        2.5
      )
    ).toEqual([
      { bondId: "first", units: 2, askPerUnitLocal: 1_000, costLocal: 2_000 },
      { bondId: "later", units: 1, askPerUnitLocal: 1_000, costLocal: 1_000 },
    ]);
    expect(
      planBankTreasurySweep(
        [quote("expensive-high-yield", 48, 1_100, 1, 9), quote("affordable", 48, 1_000, 1, 5)],
        1_000,
        0,
        4
      )
    ).toEqual([{ bondId: "affordable", units: 1, askPerUnitLocal: 1_000, costLocal: 1_000 }]);
  });

  it("uses the same interest-bearing deposit balances as the liability hurdle", () => {
    const input = {
      currency: "USD" as const,
      primeRate: 4,
      inflationRate: 0,
      depositOffset: 0,
      npcDeposits: 100,
      totalDeposits: 999_999,
      playerDeposits: 100,
      playerDepositsAreLiabilities: true,
      discountWindowDebt: 0,
      cbMarginDebt: 0,
      interbankLoans: [],
    };
    const expected = (computeBankTreasuryDueInterest(input) / 200) * 48 * 100;
    expect(computeBankTreasuryFundingRatePercent(input)).toBe(expected);
    const legacyBalances = {
      ...input,
      totalDeposits: 1_000,
      playerDeposits: 500,
      playerDepositsAreLiabilities: false,
    };
    const legacyExpected = (computeBankTreasuryDueInterest(legacyBalances) / 1_000) * 48 * 100;
    expect(computeBankTreasuryFundingRatePercent(legacyBalances)).toBe(legacyExpected);
    expect(computeBankTreasuryFundingRatePercent({ ...input, primeRate: Number.NaN })).toBe(
      Number.POSITIVE_INFINITY
    );
  });
});
