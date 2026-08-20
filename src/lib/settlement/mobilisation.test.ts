import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import { SETTLEMENT_SEATS } from "@/lib/constants/settlementCrisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/budget/treasurySpend", () => ({ spendFromTreasury: vi.fn() }));
vi.mock("@/lib/events/substrate/applyEffects", () => ({ applyCountryApprovalDelta: vi.fn() }));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

describe("levyMobilisation", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    prime(db, "federalBudget").findOne.mockResolvedValue({ treasuryBalance: 1_000_000_000 });
  });

  it("charges nothing when the ladder is not armed", async () => {
    const { levyMobilisation } = await import("./mobilisation");
    const result = await levyMobilisation(db as unknown as Db, { armed: false });
    expect(result).toEqual({ countriesLevied: 0, totalLocalSpent: 0 });
    const { spendFromTreasury } = await import("@/lib/budget/treasurySpend");
    expect(vi.mocked(spendFromTreasury)).not.toHaveBeenCalled();
  });

  it("levies every seat country, not only the two that can arm", async () => {
    const { levyMobilisation } = await import("./mobilisation");
    const result = await levyMobilisation(db as unknown as Db, { armed: true });
    expect(result.countriesLevied).toBe(SETTLEMENT_SEATS.length);
    const { spendFromTreasury } = await import("@/lib/budget/treasurySpend");
    const charged = vi
      .mocked(spendFromTreasury)
      .mock.calls.map((c) => c[1])
      .sort();
    expect(charged).toEqual(["DD", "RU", "UK", "US"]);
  });

  it("takes a share of the balance rather than a flat sum", async () => {
    const { levyMobilisation } = await import("./mobilisation");
    await levyMobilisation(db as unknown as Db, { armed: true });
    const { spendFromTreasury } = await import("@/lib/budget/treasurySpend");
    // 2% of 1,000,000,000.
    for (const call of vi.mocked(spendFromTreasury).mock.calls) {
      expect(call[2]).toBe(20_000_000);
    }
  });

  it("does not charge a treasury already in the red", async () => {
    // Taking a percentage of a debt would grow it without limit and invert the
    // intent — a bankrupt state would pay the most.
    prime(db, "federalBudget").findOne.mockResolvedValue({ treasuryBalance: -5_000_000 });
    const { levyMobilisation } = await import("./mobilisation");
    const result = await levyMobilisation(db as unknown as Db, { armed: true });
    const { spendFromTreasury } = await import("@/lib/budget/treasurySpend");
    expect(vi.mocked(spendFromTreasury)).not.toHaveBeenCalled();
    expect(result.totalLocalSpent).toBe(0);
  });

  it("still costs approval when the treasury is empty", async () => {
    prime(db, "federalBudget").findOne.mockResolvedValue({ treasuryBalance: 0 });
    const { levyMobilisation } = await import("./mobilisation");
    const result = await levyMobilisation(db as unknown as Db, { armed: true });
    const { applyCountryApprovalDelta } = await import("@/lib/events/substrate/applyEffects");
    expect(vi.mocked(applyCountryApprovalDelta)).toHaveBeenCalledTimes(4);
    expect(result.countriesLevied).toBe(4);
  });

  it("charges approval as a loss, never a gain", async () => {
    const { levyMobilisation } = await import("./mobilisation");
    await levyMobilisation(db as unknown as Db, { armed: true });
    const { applyCountryApprovalDelta } = await import("@/lib/events/substrate/applyEffects");
    for (const call of vi.mocked(applyCountryApprovalDelta).mock.calls) {
      expect(call[2]).toBeLessThan(0);
    }
  });

  it("reports what it actually spent", async () => {
    const { levyMobilisation } = await import("./mobilisation");
    const result = await levyMobilisation(db as unknown as Db, { armed: true });
    expect(result.totalLocalSpent).toBe(4 * 20_000_000);
  });
});
