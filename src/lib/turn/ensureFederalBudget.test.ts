/**
 * Tests for ensureFederalBudget — the self-heal for a country that has a
 * live centralBanks doc but no federalBudget doc (see sandbox-seed-audit-t101:
 * a partial seed path left US with a central bank and zero budget history).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

let db: MockDb;
beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
});

describe("ensureFederalBudget", () => {
  it("returns the existing budget untouched when one is already present", async () => {
    const existing = { _id: "federal", countryId: "US", economicFactors: { inflationRate: 3 } };
    db.collection("federalBudget");
    db.collectionMocks["federalBudget"]!.findOne = vi.fn().mockResolvedValue(existing);

    const { ensureFederalBudget } = await import("./ensureFederalBudget");
    const result = await ensureFederalBudget(db as unknown as Db, "US", "1953-default");

    expect(result).toEqual(existing);
    expect(db.collectionMocks["federalBudget"]!.updateOne).not.toHaveBeenCalled();
  });

  it("seeds a preset default and returns it when the budget is missing", async () => {
    let findOneCalls = 0;
    db.collection("federalBudget");
    db.collectionMocks["federalBudget"]!.findOne = vi.fn().mockImplementation(() => {
      findOneCalls += 1;
      if (findOneCalls === 1) return Promise.resolve(null); // existence check
      return Promise.resolve({ _id: "federal", countryId: "US" }); // re-fetch after upsert
    });

    const { ensureFederalBudget } = await import("./ensureFederalBudget");
    const result = await ensureFederalBudget(db as unknown as Db, "US", "1953-default");

    expect(db.collectionMocks["federalBudget"]!.updateOne).toHaveBeenCalledWith(
      { _id: "federal" },
      expect.objectContaining({ $setOnInsert: expect.objectContaining({ countryId: "US" }) }),
      { upsert: true }
    );
    expect(result).toEqual({ _id: "federal", countryId: "US" });
  });

  it("returns null without writing when the preset has no seed config for the country", async () => {
    db.collection("federalBudget");
    db.collectionMocks["federalBudget"]!.findOne = vi.fn().mockResolvedValue(null);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { ensureFederalBudget } = await import("./ensureFederalBudget");
    // "ZZ" is not a real country in any preset's seed configs.
    const result = await ensureFederalBudget(db as unknown as Db, "ZZ" as never, "1953-default");

    expect(result).toBeNull();
    expect(db.collectionMocks["federalBudget"]!.updateOne).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("findCountriesMissingFederalBudget", () => {
  it("returns countries whose centralBanks doc has no matching federalBudget", async () => {
    db.collection("centralBanks");
    db.collectionMocks["centralBanks"]!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ countryId: "US" }, { countryId: "UK" }]),
    });
    db.collection("federalBudget");
    db.collectionMocks["federalBudget"]!.countDocuments = vi
      .fn()
      .mockImplementation((filter: { _id: string }) =>
        Promise.resolve(filter._id === "UK" ? 1 : 0)
      );

    const { findCountriesMissingFederalBudget } = await import("./ensureFederalBudget");
    const result = await findCountriesMissingFederalBudget(db as unknown as Db);

    expect(result).toEqual(["US"]);
  });

  it("returns an empty array when every central bank has a matching budget", async () => {
    db.collection("centralBanks");
    db.collectionMocks["centralBanks"]!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ countryId: "UK" }]),
    });
    db.collection("federalBudget");
    db.collectionMocks["federalBudget"]!.countDocuments = vi.fn().mockResolvedValue(1);

    const { findCountriesMissingFederalBudget } = await import("./ensureFederalBudget");
    const result = await findCountriesMissingFederalBudget(db as unknown as Db);

    expect(result).toEqual([]);
  });
});

describe("findFederalBudgetCountryMismatches", () => {
  // Regression test for sandbox-seed-audit-t101: the sandbox's `_id: "federal"`
  // budget (US's, by the legacy-id convention) was actively updated every turn
  // while carrying `countryId: "BAL"` — silently misattributing it to the
  // wrong country for any consumer that trusts `budget.countryId`.
  it("flags a budget whose countryId doesn't match its _id convention", async () => {
    db.collection("federalBudget");
    db.collectionMocks["federalBudget"]!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "federal", countryId: "BAL" },
        { _id: "IE", countryId: "IE" },
      ]),
    });

    const { findFederalBudgetCountryMismatches } = await import("./ensureFederalBudget");
    const result = await findFederalBudgetCountryMismatches(db as unknown as Db);

    expect(result).toEqual([
      { budgetId: "federal", expectedCountryId: "US", actualCountryId: "BAL" },
    ]);
  });

  it("returns an empty array when every budget's countryId matches its _id", async () => {
    db.collection("federalBudget");
    db.collectionMocks["federalBudget"]!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "federal", countryId: "US" },
        { _id: "UK", countryId: "UK" },
      ]),
    });

    const { findFederalBudgetCountryMismatches } = await import("./ensureFederalBudget");
    const result = await findFederalBudgetCountryMismatches(db as unknown as Db);

    expect(result).toEqual([]);
  });
});
