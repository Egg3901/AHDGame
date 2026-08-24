import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  awardContract,
  advanceContract,
  cancelContract,
  respondToContract,
  stampDeliveryCarry,
} from "./defenceContracts";
import type { DefenceContract } from "@/lib/db/types/defenceContract";

interface Capture {
  inserted: DefenceContract[];
  updates: { filter: Record<string, unknown>; update: Record<string, unknown> }[];
}

function stubDb(doc: Partial<DefenceContract> | null, capture: Capture): Db {
  return {
    collection: () => ({
      // Honours the `status: "active"` filter the real queries carry. A stub that returned
      // the document regardless would let a cancelled contract keep delivering and would
      // report the implementation as broken when it is the stub that is wrong.
      findOne: async (filter?: Record<string, unknown>) => {
        if (filter?.status && doc?.status !== filter.status) return null;
        return doc;
      },
      insertOne: async (d: DefenceContract) => {
        capture.inserted.push(d);
        return { acknowledged: true, insertedId: d._id };
      },
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        capture.updates.push({ filter, update });
        // Mirrors the status guards the real filters carry, INCLUDING `$in` — modelling
        // only the scalar form would make every `$in`-guarded write match unconditionally
        // and quietly stop testing the guard at all.
        const want = (filter as { status?: string | { $in?: string[] } }).status;
        const matched =
          want == null
            ? true
            : typeof want === "string"
              ? doc?.status === want
              : (want.$in ?? []).includes(doc?.status as string);
        return { matchedCount: matched ? 1 : 0, modifiedCount: matched ? 1 : 0 };
      },
      find: () => ({ sort: () => ({ toArray: async () => [] }), toArray: async () => [] }),
    }),
  } as unknown as Db;
}

const active = (over: Partial<DefenceContract> = {}): Partial<DefenceContract> => ({
  _id: new ObjectId(),
  countryId: "US",
  corporationId: new ObjectId(),
  pricePerLot: 1_000,
  lotsOrdered: 100,
  lotsDelivered: 0,
  status: "active",
  ...over,
});

describe("awardContract", () => {
  // An award is an offer, not an order: the supplying CEO has to accept before anything is
  // built or any money moves.
  it("starts undelivered and pending the supplier's answer", async () => {
    const capture: Capture = { inserted: [], updates: [] };
    const c = await awardContract(stubDb(null, capture), {
      countryId: "US",
      corporationId: new ObjectId(),
      sectorId: new ObjectId(),
      component: "ground",
      lotsOrdered: 50,
      pricePerLot: 1000,
      awardedTurn: 7,
    });
    expect(c.lotsDelivered).toBe(0);
    expect(c.status).toBe("pending");
    expect(capture.inserted).toHaveLength(1);
  });

  it("can start active when the buyer is contracting its own state industry", async () => {
    const capture: Capture = { inserted: [], updates: [] };
    const c = await awardContract(stubDb(null, capture), {
      countryId: "RU",
      corporationId: new ObjectId(),
      sectorId: new ObjectId(),
      component: "ground",
      lotsOrdered: 50,
      pricePerLot: 1000,
      awardedTurn: 7,
      activateImmediately: true,
    });
    expect(c.status).toBe("active");
    expect(capture.inserted[0].status).toBe("active");
  });

  it("orders at least one lot and never a fractional price", async () => {
    const c = await awardContract(stubDb(null, { inserted: [], updates: [] }), {
      countryId: "US",
      corporationId: new ObjectId(),
      sectorId: new ObjectId(),
      component: "naval",
      lotsOrdered: 0,
      pricePerLot: 10.7,
      awardedTurn: 1,
    });
    expect(c.lotsOrdered).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(c.pricePerLot)).toBe(true);
  });
});

describe("advanceContract", () => {
  // The delivered figure is what the buyer is billed against, so it must never exceed the
  // order however many lots the sector's revenue would have produced.
  it("clamps delivery to what remains on the order", async () => {
    const capture: Capture = { inserted: [], updates: [] };
    const doc = active({ lotsOrdered: 100, lotsDelivered: 90 });
    expect(await advanceContract(stubDb(doc, capture), doc._id!, 40)).toBe(10);
    expect(capture.updates[0].update).toMatchObject({ $inc: { lotsDelivered: 10 } });
  });

  it("completes the contract on the final lot", async () => {
    const capture: Capture = { inserted: [], updates: [] };
    const doc = active({ lotsOrdered: 100, lotsDelivered: 90 });
    await advanceContract(stubDb(doc, capture), doc._id!, 10);
    expect((capture.updates[0].update.$set as Record<string, unknown>).status).toBe("complete");
  });

  it("does not complete a contract that still has lots outstanding", async () => {
    const capture: Capture = { inserted: [], updates: [] };
    const doc = active({ lotsOrdered: 100, lotsDelivered: 0 });
    await advanceContract(stubDb(doc, capture), doc._id!, 10);
    expect((capture.updates[0].update.$set as Record<string, unknown>).status).toBeUndefined();
  });

  it("delivers nothing against a cancelled or complete contract", async () => {
    const doc = active({ status: "cancelled" });
    expect(await advanceContract(stubDb(doc, { inserted: [], updates: [] }), doc._id!, 10)).toBe(0);
  });

  it("closes an already-filled contract still marked active rather than looping forever", async () => {
    const capture: Capture = { inserted: [], updates: [] };
    const doc = active({ lotsOrdered: 100, lotsDelivered: 100 });
    expect(await advanceContract(stubDb(doc, capture), doc._id!, 10)).toBe(0);
    expect((capture.updates[0].update.$set as Record<string, unknown>).status).toBe("complete");
  });

  it("is a no-op for a zero or negative delivery", async () => {
    const capture: Capture = { inserted: [], updates: [] };
    const doc = active();
    expect(await advanceContract(stubDb(doc, capture), doc._id!, 0)).toBe(0);
    expect(await advanceContract(stubDb(doc, capture), doc._id!, -5)).toBe(0);
    expect(capture.updates).toHaveLength(0);
  });

  it("guards on active status so two turns cannot both deliver the last lot", async () => {
    const capture: Capture = { inserted: [], updates: [] };
    const doc = active({ lotsOrdered: 10, lotsDelivered: 0 });
    await advanceContract(stubDb(doc, capture), doc._id!, 5);
    expect(capture.updates[0].filter).toMatchObject({ status: "active" });
  });
});

describe("cancelContract", () => {
  it("cancels an active contract and returns the state it was cancelled in", async () => {
    const doc = active({ lotsOrdered: 10, lotsDelivered: 3 });
    const cancelled = await cancelContract(stubDb(doc, { inserted: [], updates: [] }), doc._id!);
    // The snapshot is what the caller prices a break fee against, so it has to come back.
    expect(cancelled).toMatchObject({ lotsOrdered: 10, lotsDelivered: 3 });
  });

  it("is idempotent — cancelling a closed contract is not an error", async () => {
    const doc = active({ status: "cancelled" });
    expect(await cancelContract(stubDb(doc, { inserted: [], updates: [] }), doc._id!)).toBeNull();
  });

  // A minister must be able to withdraw an offer the supplier has not answered, not only a
  // live order — otherwise a mistaken award is unrecallable until the CEO responds.
  it("withdraws an offer the supplier has not answered yet", async () => {
    const doc = active({ status: "pending" });
    expect(
      await cancelContract(stubDb(doc, { inserted: [], updates: [] }), doc._id!)
    ).not.toBeNull();
  });

  // The loop this closes: cancel a rival mid-window, get the quota back, re-award it to your
  // own plant. A convenience termination leaves the tranche spent.
  it("keeps the window quota spent when the termination is not a withdrawal or for cause", async () => {
    const capture: Capture = { inserted: [], updates: [] };
    const doc = active({ allocationWindowId: "US:5", allocatedLots: 10, lotsDelivered: 2 });
    await cancelContract(stubDb(doc, capture), doc._id!, { releaseQuota: false });
    const quotaWrites = capture.updates.filter((u) =>
      JSON.stringify(u.update).includes("countryAmount")
    );
    expect(quotaWrites).toHaveLength(0);
  });

  it("hands the quota back when the offer was never accepted", async () => {
    const capture: Capture = { inserted: [], updates: [] };
    const doc = active({
      status: "pending",
      allocationWindowId: "US:5",
      allocatedLots: 10,
      lotsDelivered: 0,
    });
    await cancelContract(stubDb(doc, capture), doc._id!, { releaseQuota: true });
    const quotaWrites = capture.updates.filter((u) =>
      JSON.stringify(u.update).includes("countryAmount")
    );
    expect(quotaWrites.length).toBeGreaterThan(0);
  });

  it("records how the contract ended on the order book", async () => {
    const capture: Capture = { inserted: [], updates: [] };
    const doc = active({ lotsOrdered: 8, lotsDelivered: 1 });
    await cancelContract(stubDb(doc, capture), doc._id!, {
      releaseQuota: false,
      termination: {
        basis: "convenience",
        fee: 1_000,
        lotsCancelled: 7,
        favorabilityPenalty: 2.4,
        turn: 40,
      },
    });
    expect(capture.updates[0].update).toMatchObject({
      $set: expect.objectContaining({
        termination: expect.objectContaining({ basis: "convenience", fee: 1_000 }),
      }),
    });
  });
});

describe("stampDeliveryCarry supplier-fault streak", () => {
  /** Every write the streak logic performed, in order. */
  function streakWrites(capture: Capture) {
    return capture.updates.filter((u) => JSON.stringify(u.update).includes("supplierFaultTurns"));
  }

  it("counts a turn the plant produced nothing", async () => {
    const capture: Capture = { inserted: [], updates: [] };
    await stampDeliveryCarry(stubDb(active(), capture), new ObjectId(), 0, "no_output", 12);
    expect(streakWrites(capture)[0].update).toMatchObject({ $inc: { supplierFaultTurns: 1 } });
  });

  // A blind $inc would double-count: one delivery turn legitimately stamps a contract more
  // than once, and a minister must not get a free cancellation a turn early.
  it("guards the increment on the turn so one turn cannot count twice", async () => {
    const capture: Capture = { inserted: [], updates: [] };
    await stampDeliveryCarry(stubDb(active(), capture), new ObjectId(), 0, "no_output", 12);
    expect(streakWrites(capture)[0].filter).toMatchObject({
      $or: [
        { supplierFaultThroughTurn: { $exists: false } },
        { supplierFaultThroughTurn: { $lt: 12 } },
      ],
    });
  });

  // Underfunding your own appropriation must never buy you a free cancellation.
  it("clears the streak when the failure was the buyer's", async () => {
    const capture: Capture = { inserted: [], updates: [] };
    await stampDeliveryCarry(
      stubDb(active({ supplierFaultTurns: 2 }), capture),
      new ObjectId(),
      0,
      "appropriation_short",
      12
    );
    expect(streakWrites(capture)[0].update).toMatchObject({ $set: { supplierFaultTurns: 0 } });
  });

  it("clears the streak on a turn that shipped everything it built", async () => {
    const capture: Capture = { inserted: [], updates: [] };
    await stampDeliveryCarry(
      stubDb(active({ supplierFaultTurns: 2 }), capture),
      new ObjectId(),
      0,
      undefined,
      12
    );
    expect(streakWrites(capture)[0].update).toMatchObject({ $set: { supplierFaultTurns: 0 } });
  });
});

describe("respondToContract", () => {
  it("accepts a pending offer into an active order", async () => {
    const doc = active({ status: "pending" });
    const capture: Capture = { inserted: [], updates: [] };
    expect(await respondToContract(stubDb(doc, capture), doc._id!, true)).toBe(true);
    expect(capture.updates[0].update).toMatchObject({
      $set: expect.objectContaining({ status: "active" }),
    });
  });

  it("declines into a distinct status, not the minister's cancellation", async () => {
    const doc = active({ status: "pending" });
    const capture: Capture = { inserted: [], updates: [] };
    // Returns true because the transition SUCCEEDED — the answer itself was 'no'.
    expect(await respondToContract(stubDb(doc, capture), doc._id!, false)).toBe(true);
    expect(capture.updates[0].update).toMatchObject({
      $set: expect.objectContaining({ status: "declined" }),
    });
  });

  // Two clicks, or an accept racing the minister's cancel, must resolve to one winner
  // rather than reviving a withdrawn order.
  it("refuses an offer that is no longer pending", async () => {
    const doc = active({ status: "cancelled" });
    const capture: Capture = { inserted: [], updates: [] };
    expect(await respondToContract(stubDb(doc, capture), doc._id!, true)).toBe(false);
  });

  it("cannot revive a contract already complete", async () => {
    const doc = active({ status: "complete" });
    const capture: Capture = { inserted: [], updates: [] };
    expect(await respondToContract(stubDb(doc, capture), doc._id!, true)).toBe(false);
  });
});
