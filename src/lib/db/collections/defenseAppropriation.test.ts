import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import {
  getDefenseAppropriation,
  applyAppropriationSettlement,
  debitAppropriation,
  creditAppropriation,
  encumberAppropriation,
  releaseEncumbrance,
  settleEncumbrance,
  unsettleEncumbrance,
  uncommittedFrom,
} from "./defenseAppropriation";

interface Capture {
  updates: { filter: Record<string, unknown>; update: Record<string, unknown> }[];
}

/**
 * Emulates the guarded `$inc`. Three filter shapes reach this collection and the stub honours
 * all three, or the guards these tests exist to pin are not being exercised:
 *
 *   1. `$expr` on `balance - encumbered` - a NEW obligation must fit inside the appropriation
 *      that is not already committed to a live contract;
 *   2. explicit `$gte` on balance and/or encumbered - a settlement drawing a commitment down;
 *   3. no guard at all - a refund or a release, which must never be refused.
 */
function stubDb(doc: Record<string, unknown> | null, capture: Capture): Db {
  return {
    collection: () => ({
      findOne: async () => doc,
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        capture.updates.push({ filter, update });
        const p = doc?.defenseAppropriation as { balance: number; encumbered?: number } | undefined;
        const balance = p?.balance ?? 0;
        const encumbered = p?.encumbered ?? 0;

        const expr = filter.$expr as { $gte?: [unknown, number] } | undefined;
        if (expr?.$gte && balance - encumbered < expr.$gte[1]) {
          return { matchedCount: 0, modifiedCount: 0 };
        }
        const needB = (filter["defenseAppropriation.balance"] as { $gte?: number } | undefined)
          ?.$gte;
        if (needB != null && balance < needB) return { matchedCount: 0, modifiedCount: 0 };
        const needE = (filter["defenseAppropriation.encumbered"] as { $gte?: number } | undefined)
          ?.$gte;
        if (needE != null && encumbered < needE) return { matchedCount: 0, modifiedCount: 0 };
        return { matchedCount: 1, modifiedCount: 1 };
      },
    }),
  } as unknown as Db;
}

const pot = (balance: number, encumbered?: number) => ({
  countryId: "US",
  defenseAppropriation: {
    balance,
    accruedThroughTurn: 7,
    arrearsRatio: 0.25,
    ...(encumbered != null ? { encumbered } : {}),
  },
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

  // The guard is now on UNCOMMITTED appropriation, computed inside the update. A read-then-
  // write check would let two concurrent spends both pass against the same balance.
  it("guards on uncommitted appropriation so a spend cannot double-spend or raid a commitment", async () => {
    const capture: Capture = { updates: [] };
    await debitAppropriation(stubDb(pot(1_000), capture), "US", 400);
    expect(capture.updates[0].filter).toHaveProperty("$expr");
  });

  // A recruit or an upgrade must not be able to spend money a procurement contract has
  // already committed. Before encumbrance existed the raw balance was the only limit, so a
  // purchase could quietly eat the budget an open order was relying on.
  it("refuses to spend appropriation already committed to a contract", async () => {
    expect(await debitAppropriation(stubDb(pot(1_000, 900), { updates: [] }), "US", 400)).toBe(
      false
    );
    expect(await debitAppropriation(stubDb(pot(1_000, 500), { updates: [] }), "US", 400)).toBe(
      true
    );
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

/**
 * The encumbrance layer: the guard that closes the appropriation-drain exploit.
 *
 * A minister could order up to a million lots because nothing checked the order against the
 * money until the delivery turn, at which point the appropriation was paid out to the supplier
 * lot by lot as pure profit until it was empty. An obligation is now committed at award, drawn
 * down on delivery, and handed back when it is cancelled.
 */
describe("encumbrance", () => {
  it("reports what is not already committed", () => {
    expect(
      uncommittedFrom({ balance: 1_000, encumbered: 300, accruedThroughTurn: 1, arrearsRatio: 0 })
    ).toBe(700);
    // Absent on any budget written before encumbrance shipped; treated as zero, which
    // reproduces the old arithmetic exactly for a world with no live contracts.
    expect(uncommittedFrom({ balance: 1_000, accruedThroughTurn: 1, arrearsRatio: 0 })).toBe(1_000);
  });

  it("commits money without moving it", async () => {
    const capture: Capture = { updates: [] };
    expect(await encumberAppropriation(stubDb(pot(1_000), capture), "US", 400)).toBe(true);
    expect(capture.updates[0].update).toEqual({
      $inc: { "defenseAppropriation.encumbered": 400 },
    });
  });

  it("refuses to commit more than the uncommitted appropriation", async () => {
    expect(await encumberAppropriation(stubDb(pot(1_000, 800), { updates: [] }), "US", 400)).toBe(
      false
    );
  });

  it("settles a delivery against balance and commitment together", async () => {
    const capture: Capture = { updates: [] };
    expect(await settleEncumbrance(stubDb(pot(1_000, 1_000), capture), "US", 400)).toBe(true);
    expect(capture.updates[0].update).toEqual({
      $inc: {
        "defenseAppropriation.balance": -400,
        "defenseAppropriation.encumbered": -400,
      },
    });
  });

  // Debiting without releasing double-counts the lot; releasing without debiting hands the
  // supplier free money. Both legs are guarded so a partial settlement cannot take more than
  // the contract reserved.
  it("refuses a settlement larger than the commitment it draws on", async () => {
    expect(await settleEncumbrance(stubDb(pot(1_000, 100), { updates: [] }), "US", 400)).toBe(
      false
    );
  });

  it("restores both books when a paid delivery cannot be recorded", async () => {
    const capture: Capture = { updates: [] };
    await unsettleEncumbrance(stubDb(pot(600, 600), capture), "US", 400);
    expect(capture.updates[0].update).toEqual({
      $inc: {
        "defenseAppropriation.balance": 400,
        "defenseAppropriation.encumbered": 400,
      },
    });
  });

  it("releases a cancelled commitment", async () => {
    const capture: Capture = { updates: [] };
    await releaseEncumbrance(stubDb(pot(1_000, 400), capture), "US", 400);
    expect(capture.updates[0].update).toEqual({
      $inc: { "defenseAppropriation.encumbered": -400 },
    });
  });

  // A double release must not drive the commitment negative and mint uncommitted money out of
  // an accounting slip.
  it("never releases more than is actually held", async () => {
    const capture: Capture = { updates: [] };
    await releaseEncumbrance(stubDb(pot(1_000, 100), capture), "US", 400);
    expect(capture.updates[0].update).toEqual({
      $inc: { "defenseAppropriation.encumbered": -100 },
    });
  });

  it("does nothing when there is no commitment to release", async () => {
    const capture: Capture = { updates: [] };
    await releaseEncumbrance(stubDb(pot(1_000), capture), "US", 400);
    expect(capture.updates).toHaveLength(0);
  });
});
