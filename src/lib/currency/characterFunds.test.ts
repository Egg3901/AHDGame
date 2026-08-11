import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character } from "@/lib/db/types";
import {
  getPersonalBalance,
  getSavingsBalance,
  getTotalPersonalWealth,
  getHomeCurrency,
  buildPersonalBalanceInc,
  buildSavingsBalanceInc,
  buildTransferToSavingsInc,
  buildTransferFromSavingsInc,
  buildPersonalBalanceSet,
  buildPersonalBalanceBulkOp,
  buildSavingsBalanceBulkOp,
  buildSavingsInterestAccrualBulkOp,
  loadCharacterFxRate,
} from "./characterFunds";

// Minimal character stub for testing — only fields the helpers read
function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    _id: "test" as never,
    userId: "user" as never,
    name: "Test",
    countryId: "US",
    homeState: "CA",
    funds: 5000,
    cashOnHand: 2000,
    actions: 10,
    donorBaseLevel: 1,
    favorability: 50,
    infamy: 0,
    politicalInfluence: 0,
    party: "independent",
    currentOffice: null,
    policies: { economic: 0, social: 0 },
    ...overrides,
  } as Character;
}

// ── Read helpers ────────────────────────────────────────────────────────────────

describe("getPersonalBalance", () => {
  it("reads from cashOnHand when forex disabled", () => {
    const char = makeCharacter({ cashOnHand: 2000 });
    expect(getPersonalBalance(char, "USD", false)).toBe(2000);
  });

  it("returns 0 when cashOnHand is undefined pre-migration", () => {
    const char = makeCharacter({ cashOnHand: undefined });
    expect(getPersonalBalance(char, "USD", false)).toBe(0);
  });

  it("reads from currencyBalances.personal when forex enabled", () => {
    const char = makeCharacter({
      cashOnHand: 2000,
      currencyBalances: { campaign: 0, personal: { USD: 500, GBP: 300 } },
    });
    expect(getPersonalBalance(char, "USD", true)).toBe(500);
    expect(getPersonalBalance(char, "GBP", true)).toBe(300);
    expect(getPersonalBalance(char, "JPY", true)).toBe(0);
  });
});

describe("getTotalPersonalWealth", () => {
  it("returns cashOnHand + savingsOnHand when forex disabled", () => {
    const char = makeCharacter({ cashOnHand: 2000, savingsOnHand: 500 });
    expect(getTotalPersonalWealth(char, false)).toBe(2500);
  });

  it("returns home currency balance when forex enabled without rates", () => {
    const char = makeCharacter({
      countryId: "US",
      currencyBalances: {
        campaign: 0,
        personal: { USD: 1000, GBP: 500, JPY: 200 },
        savings: { USD: 100 },
      },
    });
    expect(getTotalPersonalWealth(char, true)).toBe(1100);
  });

  it("converts to USD-equivalent when exchange rates provided", () => {
    const char = makeCharacter({
      countryId: "JP",
      currencyBalances: {
        campaign: 0,
        personal: { USD: 100, GBP: 75, JPY: 10600 },
        savings: { JPY: 1060 },
      },
    });
    const rates = { USD: 1.0, GBP: 0.75, JPY: 106.0 };
    // personal: 300 internal; savings JPY: 1060/106 = 10 → 310
    expect(getTotalPersonalWealth(char, true, rates)).toBe(310);
  });

  it("returns negative amounts for deduction paths", () => {
    const char = makeCharacter({ cashOnHand: -500 });
    expect(getTotalPersonalWealth(char, false)).toBe(-500);
  });
});

describe("getSavingsBalance", () => {
  it("reads savingsOnHand in home currency when forex disabled", () => {
    const char = makeCharacter({ savingsOnHand: 300 });
    expect(getSavingsBalance(char, "USD", false)).toBe(300);
    expect(getSavingsBalance(char, "GBP", false)).toBe(0);
  });

  it("reads currencyBalances.savings when forex enabled", () => {
    const char = makeCharacter({
      currencyBalances: {
        campaign: 0,
        personal: { USD: 100 },
        savings: { USD: 50, GBP: 25 },
      },
    });
    expect(getSavingsBalance(char, "USD", true)).toBe(50);
    expect(getSavingsBalance(char, "GBP", true)).toBe(25);
  });
});

describe("getHomeCurrency", () => {
  it("returns USD for US character", () => {
    expect(getHomeCurrency(makeCharacter({ countryId: "US" }))).toBe("USD");
  });

  it("returns GBP for UK character", () => {
    expect(getHomeCurrency(makeCharacter({ countryId: "UK" }))).toBe("GBP");
  });

  it("returns JPY for JP character", () => {
    expect(getHomeCurrency(makeCharacter({ countryId: "JP" }))).toBe("JPY");
  });
});

// ── $inc helpers ────────────────────────────────────────────────────────────────

describe("buildPersonalBalanceInc", () => {
  it("returns { cashOnHand: amount } when forex disabled", () => {
    expect(buildPersonalBalanceInc(500, "GBP", false)).toEqual({ cashOnHand: 500 });
  });

  it("returns currency-specific path when forex enabled", () => {
    expect(buildPersonalBalanceInc(500, "GBP", true)).toEqual({
      "currencyBalances.personal.GBP": 500,
    });
  });

  it("handles JPY correctly", () => {
    expect(buildPersonalBalanceInc(100000, "JPY", true)).toEqual({
      "currencyBalances.personal.JPY": 100000,
    });
  });
});

// ── $set helpers ────────────────────────────────────────────────────────────────

describe("buildPersonalBalanceSet", () => {
  it("returns { cashOnHand: amount } when forex disabled", () => {
    expect(buildPersonalBalanceSet(5000, "USD", false)).toEqual({ cashOnHand: 5000 });
  });

  it("returns currency-specific path when forex enabled", () => {
    expect(buildPersonalBalanceSet(5000, "GBP", true)).toEqual({
      "currencyBalances.personal.GBP": 5000,
    });
  });

  it("handles zero amount", () => {
    expect(buildPersonalBalanceSet(0, "JPY", true)).toEqual({
      "currencyBalances.personal.JPY": 0,
    });
  });
});

// ── Bulk write helpers ──────────────────────────────────────────────────────────

describe("buildSavingsBalanceInc", () => {
  it("returns savingsOnHand when forex disabled", () => {
    expect(buildSavingsBalanceInc(10, "USD", false)).toEqual({ savingsOnHand: 10 });
  });

  it("returns currencyBalances.savings path when forex enabled", () => {
    expect(buildSavingsBalanceInc(10, "JPY", true)).toEqual({
      "currencyBalances.savings.JPY": 10,
    });
  });
});

describe("buildTransferToSavingsInc / buildTransferFromSavingsInc", () => {
  it("moves pre-forex cash to savings", () => {
    expect(buildTransferToSavingsInc(100, "USD", false)).toEqual({
      cashOnHand: -100,
      savingsOnHand: 100,
    });
  });

  it("moves multi-currency savings when forex enabled", () => {
    expect(buildTransferToSavingsInc(50, "GBP", true)).toEqual({
      "currencyBalances.personal.GBP": -50,
      "currencyBalances.savings.GBP": 50,
    });
    expect(buildTransferFromSavingsInc(20, "GBP", true)).toEqual({
      "currencyBalances.personal.GBP": 20,
      "currencyBalances.savings.GBP": -20,
    });
  });
});

describe("buildSavingsBalanceBulkOp", () => {
  it("builds bulk op for savings interest", () => {
    const id = new ObjectId();
    const op = buildSavingsBalanceBulkOp(id, 3.25, "USD", true);
    expect(op).toEqual({
      updateOne: {
        filter: { _id: id },
        update: { $inc: { "currencyBalances.savings.USD": 3.25 } },
      },
    });
  });
});

describe("buildSavingsInterestAccrualBulkOp", () => {
  it("increments savings and interestEarned in forex mode", () => {
    const id = new ObjectId();
    const op = buildSavingsInterestAccrualBulkOp(id, 1.5, "JPY", true);
    expect(op).toEqual({
      updateOne: {
        filter: { _id: id },
        update: {
          $inc: {
            "currencyBalances.savings.JPY": 1.5,
            "currencyBalances.interestEarned.JPY": 1.5,
          },
        },
      },
    });
  });

  it("increments savingsOnHand and savingsInterestEarnedLifetime pre-forex", () => {
    const id = new ObjectId();
    const op = buildSavingsInterestAccrualBulkOp(id, 2, "USD", false);
    expect(op).toEqual({
      updateOne: {
        filter: { _id: id },
        update: { $inc: { savingsOnHand: 2, savingsInterestEarnedLifetime: 2 } },
      },
    });
  });
});

describe("buildPersonalBalanceBulkOp", () => {
  it("builds a bulkWrite-compatible updateOne op (pre-forex)", () => {
    const id = new ObjectId();
    const op = buildPersonalBalanceBulkOp(id, 500, "GBP", false);
    expect(op).toEqual({
      updateOne: {
        filter: { _id: id },
        update: { $inc: { cashOnHand: 500 } },
      },
    });
  });

  it("builds a bulkWrite-compatible updateOne op (post-forex)", () => {
    const id = new ObjectId();
    const op = buildPersonalBalanceBulkOp(id, 500, "GBP", true);
    expect(op).toEqual({
      updateOne: {
        filter: { _id: id },
        update: { $inc: { "currencyBalances.personal.GBP": 500 } },
      },
    });
  });
});

// ── loadCharacterFxRate ─────────────────────────────────────────────────────────

describe("loadCharacterFxRate", () => {
  it("returns the live rate for USD from the DB (no hardcoded 1.0 shortcut)", async () => {
    // USD floats against ₳ post-forex and must use the live rate from exchangeRates.
    const findOneMock = vi.fn().mockResolvedValue({ rate: 1.1377 });
    const mockDb = {
      collection: vi.fn().mockReturnValue({ findOne: findOneMock }),
    };
    const result = await loadCharacterFxRate(mockDb as unknown as Db, "USD");
    expect(result).toEqual({ rate: 1.1377, ok: true });
    expect(findOneMock).toHaveBeenCalledWith({ currencyCode: "USD" }, { projection: { rate: 1 } });
  });

  it("returns the live rate for a non-USD currency", async () => {
    const findOneMock = vi.fn().mockResolvedValue({ rate: 106.0 });
    const mockDb = {
      collection: vi.fn().mockReturnValue({ findOne: findOneMock }),
    };
    const result = await loadCharacterFxRate(mockDb as unknown as Db, "JPY");
    expect(result).toEqual({ rate: 106.0, ok: true });
    expect(findOneMock).toHaveBeenCalledWith({ currencyCode: "JPY" }, { projection: { rate: 1 } });
  });

  it("returns { rate: 1.0, ok: false } when the rate document is not found", async () => {
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(null),
      }),
    };
    const result = await loadCharacterFxRate(mockDb as unknown as Db, "GBP");
    expect(result).toEqual({ rate: 1.0, ok: false });
  });

  it("returns { rate: 1.0, ok: false } when the rate is zero", async () => {
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue({ rate: 0 }),
      }),
    };
    const result = await loadCharacterFxRate(mockDb as unknown as Db, "GBP");
    expect(result).toEqual({ rate: 1.0, ok: false });
  });

  it("returns { rate: 1.0, ok: false } when the rate is negative", async () => {
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue({ rate: -5 }),
      }),
    };
    const result = await loadCharacterFxRate(mockDb as unknown as Db, "GBP");
    expect(result).toEqual({ rate: 1.0, ok: false });
  });
});
