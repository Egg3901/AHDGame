import { ObjectId, type Db, type Document } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { claimFundCommand, completeFundCommand } from "./playerCommand";

function fixture() {
  const records = new Map<string, Document>();
  const collection = {
    insertOne: vi.fn(async (row: Document) => {
      if (records.has(row._id)) throw Object.assign(new Error("duplicate"), { code: 11000 });
      records.set(row._id, structuredClone(row));
    }),
    findOne: vi.fn(async (filter: Document) => records.get(filter._id) ?? null),
    updateOne: vi.fn(async (filter: Document, update: Document) => {
      const row = records.get(filter._id);
      if (row?.state !== filter.state) return { matchedCount: 0 };
      Object.assign(row, update.$set);
      return { matchedCount: 1 };
    }),
  };
  return { db: { collection: () => collection } as unknown as Db, records, collection };
}
const request = { fundId: new ObjectId().toHexString(), kind: "subscribe" as const, units: 2 };

describe("player fund command receipts", () => {
  it("admits one concurrent caller and preserves the original completed response", async () => {
    const { db } = fixture(),
      actor = new ObjectId(),
      id = crypto.randomUUID();
    const claims = await Promise.all(
      Array.from({ length: 4 }, () => claimFundCommand(db, actor, id, request))
    );
    expect(claims.filter((c) => !c.response)).toHaveLength(1);
    for (const pending of claims.filter((c) => c.response)) {
      expect(pending.response!.status).toBe(409);
      expect(await pending.response!.json()).toMatchObject({ pending: true, operationId: id });
    }
    await completeFundCommand(db, claims[0].key, { success: true, units: 2, nav: 10 });
    await completeFundCommand(db, claims[0].key, { success: true, units: 99, nav: 99 });
    const replay = await claimFundCommand(db, actor, id, request);
    expect(await replay.response!.json()).toEqual({ success: true, units: 2, nav: 10 });
    expect(
      (await claimFundCommand(db, actor, crypto.randomUUID(), request)).response
    ).toBeUndefined();
  });

  it("rejects changed requests and scopes receipts to the authenticated character", async () => {
    const { db } = fixture(),
      actor = new ObjectId(),
      id = crypto.randomUUID();
    await claimFundCommand(db, actor, id, request);
    for (const change of [
      { units: 3 },
      { kind: "redeem" as const },
      { payCurrency: "EUR" },
      { fundId: "other" },
    ]) {
      const changed = await claimFundCommand(db, actor, id, { ...request, ...change });
      expect(changed.response!.status).toBe(409);
      expect((await changed.response!.json()).error).toContain("different fund order");
    }
    expect((await claimFundCommand(db, new ObjectId(), id, request)).response).toBeUndefined();
  });

  it("never expires or blindly reexecutes an interrupted standalone command", async () => {
    const { db, records } = fixture(),
      actor = new ObjectId(),
      id = crypto.randomUUID();
    const claim = await claimFundCommand(db, actor, id, request);
    records.get(claim.key)!.createdAt = new Date(0);
    const retry = await claimFundCommand(db, actor, id, request);
    expect(retry.response!.status).toBe(409);
    expect((await retry.response!.json()).error).toContain("Cash or units may already have moved");
    expect(records.size).toBe(1);
  });

  it("writes the completion receipt in the caller's financial transaction", async () => {
    const { db, collection } = fixture(),
      actor = new ObjectId(),
      id = crypto.randomUUID();
    const claim = await claimFundCommand(db, actor, id, request);
    const session = {} as import("mongodb").ClientSession;
    await completeFundCommand(db, claim.key, { success: true }, 200, session);
    expect(collection.updateOne).toHaveBeenCalledWith(
      { _id: claim.key, state: "pending" },
      expect.anything(),
      { session }
    );
  });
});
