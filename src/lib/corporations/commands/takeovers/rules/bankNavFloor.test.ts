import { describe, expect, it } from "vitest";
import { bankEquity } from "@/lib/banking/balanceSheet";
import { applyBankNavFloor, bankNavFloorPerShareAnchor } from "./bankNavFloor";

function charter(overrides: Record<string, number> = {}) {
  return {
    cashReserves: 0,
    totalLoans: 0,
    npcDeposits: 0,
    playerDeposits: 0,
    totalDeposits: 0,
    propBookMarkValue: 0,
    discountWindowDebt: 0,
    discountWindowArrears: 0,
    cbMarginDebt: 0,
    cbMarginArrears: 0,
    interbankDebt: 0,
    ...overrides,
  } as never;
}

describe("bankNavFloorPerShareAnchor", () => {
  it("prices full realizable equity per share", () => {
    expect(bankNavFloorPerShareAnchor({ bankBookEquityAnchor: 52_300_000, totalShares: 1000 }))
      .toBe(52_300);
  });

  it("floors at zero for negative or zero equity", () => {
    expect(bankNavFloorPerShareAnchor({ bankBookEquityAnchor: -1, totalShares: 1000 })).toBe(0);
    expect(bankNavFloorPerShareAnchor({ bankBookEquityAnchor: 0, totalShares: 1000 })).toBe(0);
  });

  it("fails open to zero on unusable share counts or non-finite inputs", () => {
    expect(bankNavFloorPerShareAnchor({ bankBookEquityAnchor: 100, totalShares: 0 })).toBe(0);
    expect(bankNavFloorPerShareAnchor({ bankBookEquityAnchor: 100, totalShares: -5 })).toBe(0);
    expect(
      bankNavFloorPerShareAnchor({ bankBookEquityAnchor: Number.NaN, totalShares: 1000 })
    ).toBe(0);
    expect(
      bankNavFloorPerShareAnchor({ bankBookEquityAnchor: 100, totalShares: Number.NaN })
    ).toBe(0);
  });
});

describe("applyBankNavFloor", () => {
  it("passes the premium market price through when it covers the bank", () => {
    expect(applyBankNavFloor(100, 60)).toEqual({ pricePerShareAnchor: 100, floorApplied: false });
  });

  it("floors a depressed market price at realizable bank NAV per share", () => {
    expect(applyBankNavFloor(12.5, 52_300)).toEqual({
      pricePerShareAnchor: 52_300,
      floorApplied: true,
    });
  });

  it("falls back to a positive floor on a corrupt market print", () => {
    expect(applyBankNavFloor(Number.NaN, 52_300)).toEqual({
      pricePerShareAnchor: 52_300,
      floorApplied: true,
    });
  });

  it("never invents a price when both legs are unusable", () => {
    expect(applyBankNavFloor(Number.NaN, 0).floorApplied).toBe(false);
  });
});

describe("floor input: authoritative bank book equity (issue #1750)", () => {
  it("counts ring-fenced cash and the loan book as realizable assets", () => {
    expect(bankEquity(charter({ cashReserves: 100, totalLoans: 40 }))).toBe(140);
  });

  it("nets cash-backed household deposits as liabilities, not equity", () => {
    expect(bankEquity(charter({ cashReserves: 123_410_000, npcDeposits: 71_110_000 }))).toBe(
      52_300_000
    );
  });

  it("nets every borrowing facility as a liability", () => {
    const base = charter({ cashReserves: 100 });
    expect(bankEquity(base)).toBe(100);
    expect(bankEquity(charter({ cashReserves: 100, discountWindowDebt: 10 }))).toBe(90);
    expect(bankEquity(charter({ cashReserves: 100, discountWindowArrears: 10 }))).toBe(90);
    expect(bankEquity(charter({ cashReserves: 100, cbMarginDebt: 10 }))).toBe(90);
    expect(bankEquity(charter({ cashReserves: 100, cbMarginArrears: 10 }))).toBe(90);
    expect(bankEquity(charter({ cashReserves: 100, interbankDebt: 10 }))).toBe(90);
  });

  it("ignores player pointer deposits: no cash arrived, so no liability", () => {
    const withPointers = charter({
      cashReserves: 100,
      playerDeposits: 1_000_000,
      totalDeposits: 1_000_000,
    });
    expect(bankEquity(withPointers)).toBe(100);
  });

  it("counts player deposits as liabilities once the currency reads authoritative", () => {
    const held = charter({ cashReserves: 100, playerDeposits: 30, totalDeposits: 30 });
    expect(bankEquity(held, { playerDepositsAreLiabilities: true })).toBe(70);
  });

  it("excludes the prop book (even bond positions): marks are not realizable equity", () => {
    const withPropBonds = charter({
      cashReserves: 100,
      npcDeposits: 20,
      propBookMarkValue: 500,
    });
    expect(bankEquity(withPropBonds)).toBe(80);
  });
});
