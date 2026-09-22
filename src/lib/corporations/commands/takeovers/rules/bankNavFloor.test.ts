import { describe, expect, it } from "vitest";
import { bankEquity } from "@/lib/banking/balanceSheet";
import { applyBankNavFloor, bankNavFloorPerShareAnchor, takeoverBankNav } from "./bankNavFloor";

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
  it("prices full realizable NAV per share", () => {
    expect(bankNavFloorPerShareAnchor({ bankNavAnchor: 52_300_000, totalShares: 1000 })).toBe(
      52_300
    );
  });

  it("floors at zero for negative or zero NAV", () => {
    expect(bankNavFloorPerShareAnchor({ bankNavAnchor: -1, totalShares: 1000 })).toBe(0);
    expect(bankNavFloorPerShareAnchor({ bankNavAnchor: 0, totalShares: 1000 })).toBe(0);
  });

  it("fails open to zero on unusable share counts or non-finite inputs", () => {
    expect(bankNavFloorPerShareAnchor({ bankNavAnchor: 100, totalShares: 0 })).toBe(0);
    expect(bankNavFloorPerShareAnchor({ bankNavAnchor: 100, totalShares: -5 })).toBe(0);
    expect(bankNavFloorPerShareAnchor({ bankNavAnchor: Number.NaN, totalShares: 1000 })).toBe(0);
    expect(bankNavFloorPerShareAnchor({ bankNavAnchor: 100, totalShares: Number.NaN })).toBe(0);
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

  it("bankEquity itself still excludes the prop book: marks are not distributable equity", () => {
    const withPropBonds = charter({
      cashReserves: 100,
      npcDeposits: 20,
      propBookMarkValue: 500,
    });
    expect(bankEquity(withPropBonds)).toBe(80);
  });
});

describe("takeoverBankNav: realizable value the acquirer inherits (issue #1750)", () => {
  it("covers cash plus the marked bond/prop book net of deposit liabilities", () => {
    // The issue's acceptance criterion: a bank subsidiary cannot be bought
    // below cash plus its bond/prop book net of liabilities.
    expect(
      takeoverBankNav(
        charter({
          cashReserves: 123_410_000,
          propBookMarkValue: 300_000_000,
          npcDeposits: 71_110_000,
        })
      )
    ).toBe(123_410_000 + 300_000_000 - 71_110_000);
  });

  it("nets every borrowing facility alongside deposits", () => {
    expect(
      takeoverBankNav(
        charter({
          cashReserves: 100,
          totalLoans: 40,
          propBookMarkValue: 500,
          npcDeposits: 20,
          discountWindowDebt: 10,
          discountWindowArrears: 5,
          cbMarginDebt: 4,
          cbMarginArrears: 3,
          interbankDebt: 2,
        })
      )
    ).toBe(100 + 40 + 500 - 20 - 10 - 5 - 4 - 3 - 2);
  });

  it("counts the marked book exactly once: a prop buy is a reclass, not new value", () => {
    // Before the buy the bank holds 600 cash against 20 of deposits.
    const before = charter({ cashReserves: 600, npcDeposits: 20 });
    // The buy debits cash into the mark: 100 cash left, 500 marked.
    const after = charter({ cashReserves: 100, npcDeposits: 20, propBookMarkValue: 500 });
    expect(takeoverBankNav(after)).toBe(takeoverBankNav(before));
    expect(takeoverBankNav(after)).toBe(100 + 500 - 20);
  });

  it("matches bankEquity when there is no prop book", () => {
    const plain = charter({ cashReserves: 100, totalLoans: 40, npcDeposits: 20 });
    expect(takeoverBankNav(plain)).toBe(bankEquity(plain));
  });

  it("ignores player pointer deposits but nets them once authoritative", () => {
    const pointers = charter({
      cashReserves: 100,
      propBookMarkValue: 500,
      playerDeposits: 1_000_000,
      totalDeposits: 1_000_000,
    });
    expect(takeoverBankNav(pointers)).toBe(600);
    expect(takeoverBankNav(pointers, { playerDepositsAreLiabilities: true })).toBe(600 - 1_000_000);
  });

  it("treats malformed marks as zero: a corrupt cache shrinks the floor, never invents value", () => {
    const base = { cashReserves: 100, npcDeposits: 20 };
    expect(takeoverBankNav(charter(base))).toBe(80);
    expect(takeoverBankNav(charter({ ...base, propBookMarkValue: Number.NaN }))).toBe(80);
    expect(takeoverBankNav(charter({ ...base, propBookMarkValue: Number.POSITIVE_INFINITY }))).toBe(
      80
    );
    expect(takeoverBankNav(charter({ ...base, propBookMarkValue: -500 }))).toBe(80);
    expect(takeoverBankNav({ ...base, propBookMarkValue: "500" } as never)).toBe(80);
    expect(takeoverBankNav({ cashReserves: 100, npcDeposits: 20 } as never)).toBe(80);
    expect(takeoverBankNav(null)).toBe(0);
  });
});
