import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import {
  getDefenseAppropriation,
  applyAppropriationSettlement,
  debitAppropriation,
  creditAppropriation,
} from "./defenseAppropriation";

interface Capture {
  updates: { filter: Record<string, unknown>; update: Record<string, unknown> }[];
}

/**
 * Emulates the guarded `$inc`: the update only matches when the document's balance
 * satisfies the filter's `$gte`, which is the whole point of the movers below.
 */
function stubDb(doc: Record<string, unknown> | null, capture: Capture): Db {
  return {
    collection: () => ({
      findOne: async () => doc,
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        capture.updates.push({ filter, update });
        const need = (filter["defenseAppropriation.balance"] as { $gte?: number } | undefined)
          ?.$gte;
        const pot = doc?.defenseAppropriation as { balance: number } | undefined;
        const matched = need == null || (pot?.balance ?? 0) >= need;
        return { matchedCount: matched ? 1 : 0, modifiedCount: matched ? 1 : 0 };
      },
    }),
  } as unknown as Db;
}

const pot = (balance: number) => ({
  countryId: "US",
  defenseAppropriation: { balance, accruedThroughTurn: 7, arrearsRatio: 0.25 },
});

describe("getDefenseAppropriation", () => {
  it("returns the stored pot untouched", async () => {
    const capture: Capture = { updates: [] };
    expect(await getDefenseAppropriation(stubDb(pot(500), capture), "US")).toEqual({
      balance: 500,
      accruedThroughTurn: 7,
      arrearsRatio: 0.25,
    });
    expect(capture.updates).toHaveLength(0);
  });

  // A silent zero would refuse every purchase for a country the migration missed — a dead
  // button rather than a diagnosable gap.
  it("heals an unmigrated budget to one year's accrual instead of reporting zero", async () => {
    const capture: Capture = { updates: [] };
    const db = stubDb(
      { countryId: "US", gdp: 1_000, spending: { byCategory: { defense: 480 } } },
      capture
    );
    const healed = await getDefenseAppropriation(db, "US");
    expect(healed).toEqual({ balance: 480, accruedThroughTurn: 0, arrearsRatio: 0 });
    // Guarded so two concurrent readers cannot both seed it.
    expect(capture.updates[0].filter).toMatchObject({
      defenseAppropriation: { $exists: false },
    });
  });

  it("heals through the same cascade the envelope uses when nothing is enacted", async () => {
    const capture: Capture = { updates: [] };
    const db = stubDb({ countryId: "ZZ", gdp: 1_000 }, capture);
    // gdp fallback = 3% of GDP.
    expect((await getDefenseAppropriation(db, "ZZ")).balance).toBe(30);
  });

  it("returns an empty pot, and creates nothing, when there is no budget at all", async () => {
    const capture: Capture = { updates: [] };
    expect(await getDefenseAppropriation(stubDb(null, capture), "ZZ")).toEqual({
      balance: 0,
      accruedThroughTurn: 0,
      arrearsRatio: 0,
    });
    expect(capture.updates).toHaveLength(0);
  });
});

describe("debitAppropriation", () => {
  it("succeeds and decrements when the balance covers the amount", async () => {
    const capture: Capture = { updates: [] };
    expect(await debitAppropriation(stubDb(pot(1_000), capture), "US", 400)).toBe(true);
    expect(capture.updates[0].update).toEqual({
      $inc: { "defenseAppropriation.balance": -400 },
    });
  });

  // Procurement gets NO overdraft — that is reserved for upkeep obligations.
  it("refuses rather than overdrawing when the balance is short", async () => {
    expect(await debitAppropriation(stubDb(pot(100), { updates: [] }), "US", 400)).toBe(false);
  });

  it("guards with $gte so a concurrent order cannot double-spend the same balance", async () => {
    const capture: Capture = { updates: [] };
    await debitAppropriation(stubDb(pot(1_000), capture), "US", 400);
    expect(capture.updates[0].filter).toMatchObject({
      "defenseAppropriation.balance": { $gte: 400 },
    });
  });

  it("treats a zero or negative amount as a no-op success", async () => {
    const capture: Capture = { updates: [] };
    const db = stubDb(pot(0), capture);
    expect(await debitAppropriation(db, "US", 0)).toBe(true);
    expect(await debitAppropriation(db, "US", -5)).toBe(true);
    expect(capture.updates).toHaveLength(0);
  });
});

describe("creditAppropriation", () => {
  // A refused rollback would leave a player charged for a unit they never received.
  it("returns money unconditionally, with no balance guard", async () => {
    const capture: Capture = { updates: [] };
    await creditAppropriation(stubDb(pot(0), capture), "US", 400);
    expect(capture.updates[0].filter).toEqual({ countryId: "US" });
    expect(capture.updates[0].update).toEqual({
      $inc: { "defenseAppropriation.balance": 400 },
    });
  });

  it("is a no-op for a non-positive amount", async () => {
    const capture: Capture = { updates: [] };
    await creditAppropriation(stubDb(pot(0), capture), "US", 0);
    expect(capture.updates).toHaveLength(0);
  });
});

describe("applyAppropriationSettlement", () => {
  // The balance moves by an $inc of the turn's NET change, never a $set of the closing
  // figure: a player's recruit landing between the sweep's read and this write must survive,
  // not be reverted into a free unit.
  it("increments by the delta and sets the replay guard and arrears ratio", async () => {
    const capture: Capture = { updates: [] };
    await applyAppropriationSettlement(stubDb(pot(0), capture), "US", 42, {
      balance: -1_234.6,
      delta: -600.4,
      paid: 10,
      overdraftDrawn: 5,
      arrearsRatio: 0.5,
    });
    expect(capture.updates[0].update).toEqual({
      $inc: { "defenseAppropriation.balance": -600 },
      $set: {
        "defenseAppropriation.accruedThroughTurn": 42,
        "defenseAppropriation.arrearsRatio": 0.5,
      },
    });
  });

  // Idempotency has to hold at the database, not only in the caller's pre-check, or two
  // overlapping turn passes both credit the accrual.
  it("refuses a turn already booked", async () => {
    const capture: Capture = { updates: [] };
    await applyAppropriationSettlement(stubDb(pot(0), capture), "US", 42, {
      balance: 0,
      delta: 0,
      paid: 0,
      overdraftDrawn: 0,
      arrearsRatio: 0,
    });
    expect(capture.updates[0].filter).toMatchObject({
      countryId: "US",
      "defenseAppropriation.accruedThroughTurn": { $lt: 42 },
    });
  });
});
