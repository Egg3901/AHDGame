import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { mergeEconomicRegime } from "./mergeEconomicRegime";
import {
  getStoredMarketizationLevel,
  clearStoredMarketizationLevels,
  isCommandEconomy,
  commandEconomySoeSectors,
} from "@/lib/constants/commandEconomy";
import { commandEconomyOffices } from "@/lib/constants/commandEconomyOffices";

describe("mergeEconomicRegime", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    clearStoredMarketizationLevels();
    db = createMockDb();
  });
  afterEach(() => clearStoredMarketizationLevels());

  const args = { fromCountryId: "DD" as const, toCountryId: "DE" as const, currentYear: 1963 };

  it("carries a more-planned absorbed regime onto the survivor, registry included", async () => {
    db.collection("federalBudget")
      .findOne.mockResolvedValueOnce({
        _id: "DD",
        economicFactors: { marketizationLevel: 0, gosbankDirective: { creditAggressiveness: 0.8 } },
      })
      .mockResolvedValueOnce({ _id: "DE", economicFactors: {} });

    const res = await mergeEconomicRegime(db as unknown as Db, args);

    expect(res).toEqual({ regimeCarried: true, survivorLevel: 0 });
    const [filter, update] = db.collectionMocks["federalBudget"].updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: "DE" });
    expect(update.$set["economicFactors.marketizationLevel"]).toBe(0);
    expect(update.$set["economicFactors.gosbankDirective"]).toEqual({ creditAggressiveness: 0.8 });
    expect(getStoredMarketizationLevel("DE")).toBe(0);
  });

  it("falls back to the era schedule when the absorbed side has no stored level", async () => {
    // 1963 DD schedule level is 10 (command through 1990); DE reads market (100).
    db.collection("federalBudget")
      .findOne.mockResolvedValueOnce({ _id: "DD", economicFactors: {} })
      .mockResolvedValueOnce({ _id: "DE", economicFactors: {} });

    const res = await mergeEconomicRegime(db as unknown as Db, args);

    expect(res.regimeCarried).toBe(true);
    expect(res.survivorLevel).toBe(10);
  });

  it("never reforms the survivor: an absorbed MARKET economy carries nothing", async () => {
    db.collection("federalBudget")
      .findOne.mockResolvedValueOnce({ _id: "DE", economicFactors: { marketizationLevel: 100 } })
      .mockResolvedValueOnce({ _id: "DD", economicFactors: { marketizationLevel: 0 } });

    const res = await mergeEconomicRegime(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentYear: 1963,
    });

    expect(res).toEqual({ regimeCarried: false, survivorLevel: 0 });
    expect(db.collection("federalBudget").updateOne).not.toHaveBeenCalled();
    expect(getStoredMarketizationLevel("DD")).toBeUndefined();
  });
});

describe("the compiled DE command-economy wiring", () => {
  afterEach(() => clearStoredMarketizationLevels());

  it("exists, and stays inert while DE reads as a market economy", () => {
    expect(commandEconomySoeSectors("DE").length).toBeGreaterThan(0);
    expect(commandEconomyOffices("DE")).toEqual({
      plannerCabinetId: "economy_minister",
      bankCabinetId: "finance_minister",
    });
    // No stored level, no schedule entry: DE must NOT read as command even
    // with the feature enabled — the maps alone change nothing.
    clearStoredMarketizationLevels();
    expect(isCommandEconomy("DE", 1963, true)).toBe(false);
  });
});
