import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import {
  applyIntelligenceSettlement,
  creditIntelligenceAppropriation,
  debitIntelligenceAppropriation,
  getIntelligenceAppropriation,
} from "./intelligenceAppropriation";

type Pot = { balance: number; accruedThroughTurn: number } | undefined;

/**
 * Emulates the two guards this collection relies on, because they are the whole point of the
 * module: a stub that matched everything would pass these tests while the real guards were
 * gone. Three filter shapes reach it:
 *
 *   1. `$lt` on `accruedThroughTurn` — the once-per-turn settlement;
 *   2. `$gte` on `balance` — a spend that must fit inside the pot, which has no overdraft;
 *   3. `$exists: false` on the pot, or no guard at all — the seed and the refund, which must
 *      never be refused.
 */
function stubDb(doc: Record<string, unknown> | null): Db {
  return {
    collection: () => ({
      findOne: async () => doc,
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        if (!doc) return { matchedCount: 0, modifiedCount: 0 };
        const pot = doc.intelligenceAppropriation as Pot;

        const needTurn = (
          filter["intelligenceAppropriation.accruedThroughTurn"] as { $lt?: number } | undefined
        )?.$lt;
        if (needTurn != null && !(pot && pot.accruedThroughTurn < needTurn)) {
          return { matchedCount: 0, modifiedCount: 0 };
        }
        const needBalance = (
          filter["intelligenceAppropriation.balance"] as { $gte?: number } | undefined
        )?.$gte;
        if (needBalance != null && !(pot && pot.balance >= needBalance)) {
          return { matchedCount: 0, modifiedCount: 0 };
        }
        const needAbsent = (filter.intelligenceAppropriation as { $exists?: boolean } | undefined)
          ?.$exists;
        if (needAbsent === false && pot) return { matchedCount: 0, modifiedCount: 0 };

        const set = update.$set as Record<string, unknown> | undefined;
        const inc = update.$inc as Record<string, number> | undefined;
        if (set?.intelligenceAppropriation) {
          doc.intelligenceAppropriation = { ...(set.intelligenceAppropriation as object) };
        }
        const live = doc.intelligenceAppropriation as Pot;
        if (live) {
          if (inc?.["intelligenceAppropriation.balance"] != null) {
            live.balance += inc["intelligenceAppropriation.balance"];
          }
          if (set?.["intelligenceAppropriation.accruedThroughTurn"] != null) {
            live.accruedThroughTurn = set["intelligenceAppropriation.accruedThroughTurn"] as number;
          }
        }
        return { matchedCount: 1, modifiedCount: 1 };
      },
    }),
  } as unknown as Db;
}

describe("getIntelligenceAppropriation", () => {
  it("seeds an absent pot to ZERO, never to a year's accrual", async () => {
    // The defence pot heals to a full year. Copying that here would fund every
    // country in the world without a vote, which is the bug this avoids.
    const doc: Record<string, unknown> = {
      countryId: "US",
      spending: { byCategory: { intelligence: 4800 } },
    };
    expect(await getIntelligenceAppropriation(stubDb(doc), "US")).toEqual({
      balance: 0,
      accruedThroughTurn: 0,
    });
    expect(doc.intelligenceAppropriation).toEqual({ balance: 0, accruedThroughTurn: 0 });
  });

  it("returns the empty pot for a country with no budget, creating nothing", async () => {
    expect(await getIntelligenceAppropriation(stubDb(null), "ZZ")).toEqual({
      balance: 0,
      accruedThroughTurn: 0,
    });
  });

  it("returns an existing pot untouched", async () => {
    const doc = {
      countryId: "US",
      intelligenceAppropriation: { balance: 900, accruedThroughTurn: 7 },
    };
    expect(await getIntelligenceAppropriation(stubDb(doc), "US")).toEqual({
      balance: 900,
      accruedThroughTurn: 7,
    });
  });
});

describe("applyIntelligenceSettlement", () => {
  it("credits the turn once and refuses the replay", async () => {
    const doc = {
      countryId: "US",
      intelligenceAppropriation: { balance: 0, accruedThroughTurn: 4 },
    };
    const db = stubDb(doc);
    expect(await applyIntelligenceSettlement(db, "US", 5, 100)).toBe(true);
    expect(await applyIntelligenceSettlement(db, "US", 5, 100)).toBe(false);
    expect(doc.intelligenceAppropriation).toEqual({ balance: 100, accruedThroughTurn: 5 });
  });

  it("applies a NET delta, so a turn whose upkeep outruns its accrual draws the pot down", async () => {
    const doc = {
      countryId: "US",
      intelligenceAppropriation: { balance: 500, accruedThroughTurn: 4 },
    };
    expect(await applyIntelligenceSettlement(stubDb(doc), "US", 5, -200)).toBe(true);
    expect(doc.intelligenceAppropriation.balance).toBe(300);
  });

  it("does nothing for a country whose pot has not been seeded", async () => {
    const doc = { countryId: "US" };
    expect(await applyIntelligenceSettlement(stubDb(doc), "US", 5, 100)).toBe(false);
  });
});

describe("debitIntelligenceAppropriation", () => {
  it("refuses a debit the balance cannot cover", async () => {
    const doc = {
      countryId: "US",
      intelligenceAppropriation: { balance: 100, accruedThroughTurn: 1 },
    };
    expect(await debitIntelligenceAppropriation(stubDb(doc), "US", 101)).toBe(false);
    expect(doc.intelligenceAppropriation.balance).toBe(100);
  });

  it("spends down to exactly zero, and no further", async () => {
    const doc = {
      countryId: "US",
      intelligenceAppropriation: { balance: 100, accruedThroughTurn: 1 },
    };
    const db = stubDb(doc);
    expect(await debitIntelligenceAppropriation(db, "US", 100)).toBe(true);
    expect(doc.intelligenceAppropriation.balance).toBe(0);
    expect(await debitIntelligenceAppropriation(db, "US", 1)).toBe(false);
  });

  it("treats a zero or negative charge as free rather than as a credit", async () => {
    const doc = {
      countryId: "US",
      intelligenceAppropriation: { balance: 10, accruedThroughTurn: 1 },
    };
    expect(await debitIntelligenceAppropriation(stubDb(doc), "US", 0)).toBe(true);
    expect(await debitIntelligenceAppropriation(stubDb(doc), "US", -50)).toBe(true);
    expect(doc.intelligenceAppropriation.balance).toBe(10);
  });
});

describe("creditIntelligenceAppropriation", () => {
  it("refunds unguarded, so a failed operation cannot charge the service", async () => {
    const doc = {
      countryId: "US",
      intelligenceAppropriation: { balance: 0, accruedThroughTurn: 1 },
    };
    await creditIntelligenceAppropriation(stubDb(doc), "US", 250);
    expect(doc.intelligenceAppropriation.balance).toBe(250);
  });
});
