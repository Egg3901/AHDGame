import { describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { reconcileAllCoalitionChairs, syncCoalitionChairsForParty } from "./syncCoalitionChair";

interface CoalitionFixture {
  _id: ObjectId;
  chairPartyId: ObjectId;
  chairCharacterId: ObjectId | null;
}

interface PartyFixture {
  _id: ObjectId;
  chairId: ObjectId | null;
}

function makeDb(opts: { coalitions: CoalitionFixture[]; parties: PartyFixture[] }) {
  const updates: Array<{
    collection: string;
    op: "updateMany" | "updateOne" | "bulkWrite";
    filter?: unknown;
    update?: unknown;
    ops?: unknown;
  }> = [];

  const collection = vi.fn().mockImplementation((name: string) => {
    if (name === "coalitions") {
      return {
        find: () => ({
          toArray: vi.fn().mockResolvedValue(opts.coalitions),
        }),
        updateMany: vi.fn().mockImplementation(async (filter: unknown, update: unknown) => {
          updates.push({ collection: name, op: "updateMany", filter, update });
          // Simulate matched coalitions for the partyId-based filter.
          const f = filter as { chairPartyId: ObjectId; chairCharacterId?: unknown };
          const matched = opts.coalitions.filter((c) => c.chairPartyId.equals(f.chairPartyId));
          return { matchedCount: matched.length, modifiedCount: matched.length };
        }),
        bulkWrite: vi.fn().mockImplementation(async (ops: unknown[]) => {
          updates.push({ collection: name, op: "bulkWrite", ops });
          return { modifiedCount: ops.length };
        }),
      };
    }
    if (name === "politicalParties") {
      return {
        findOne: vi.fn().mockImplementation(async (filter: { _id: ObjectId }) => {
          return opts.parties.find((p) => p._id.equals(filter._id)) ?? null;
        }),
        find: () => ({
          toArray: vi.fn().mockResolvedValue(opts.parties),
        }),
      };
    }
    return {};
  });

  return { db: { collection } as unknown as Db, updates };
}

describe("syncCoalitionChairsForParty", () => {
  it("updates coalition chairCharacterId to the party's current chairId", async () => {
    const partyOid = new ObjectId();
    const newChairOid = new ObjectId();
    const { db, updates } = makeDb({
      parties: [{ _id: partyOid, chairId: newChairOid }],
      coalitions: [
        { _id: new ObjectId(), chairPartyId: partyOid, chairCharacterId: new ObjectId() },
      ],
    });
    const modified = await syncCoalitionChairsForParty(db, partyOid);
    expect(modified).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.collection).toBe("coalitions");
    expect(updates[0]!.op).toBe("updateMany");
    const filter = updates[0]!.filter as { chairPartyId: ObjectId };
    expect(filter.chairPartyId).toEqual(partyOid);
  });

  it("clears coalition chairCharacterId to null when the party's chair is vacated", async () => {
    const partyOid = new ObjectId();
    const { db, updates } = makeDb({
      parties: [{ _id: partyOid, chairId: null }],
      coalitions: [
        { _id: new ObjectId(), chairPartyId: partyOid, chairCharacterId: new ObjectId() },
      ],
    });
    await syncCoalitionChairsForParty(db, partyOid);
    const update = updates[0]!.update as { $set: { chairCharacterId: ObjectId | null } };
    expect(update.$set.chairCharacterId).toBeNull();
  });

  it("returns 0 when the party doesn't exist (defensive)", async () => {
    const { db } = makeDb({ parties: [], coalitions: [] });
    const modified = await syncCoalitionChairsForParty(db, new ObjectId());
    expect(modified).toBe(0);
  });

  it("returns 0 when the party leads no coalitions", async () => {
    const partyOid = new ObjectId();
    const { db } = makeDb({
      parties: [{ _id: partyOid, chairId: new ObjectId() }],
      coalitions: [],
    });
    const modified = await syncCoalitionChairsForParty(db, partyOid);
    expect(modified).toBe(0);
  });
});

describe("reconcileAllCoalitionChairs", () => {
  it("updates only the coalitions whose stored chairCharacterId has drifted from the lead party's chairId", async () => {
    const partyA = new ObjectId();
    const partyB = new ObjectId();
    const newChairA = new ObjectId();
    const stableChairB = new ObjectId();
    const staleChairA = new ObjectId();

    const { db, updates } = makeDb({
      parties: [
        { _id: partyA, chairId: newChairA },
        { _id: partyB, chairId: stableChairB },
      ],
      coalitions: [
        // Drift: stored chair is the stale one; lead party's current chair is newChairA
        { _id: new ObjectId(), chairPartyId: partyA, chairCharacterId: staleChairA },
        // In sync: stored chair matches the lead party's current chair
        { _id: new ObjectId(), chairPartyId: partyB, chairCharacterId: stableChairB },
      ],
    });

    const modified = await reconcileAllCoalitionChairs(db);
    expect(modified).toBe(1);
    // Should have one bulkWrite with one update (the drifted coalition).
    const bulkOp = updates.find((u) => u.op === "bulkWrite");
    expect(bulkOp).toBeTruthy();
    expect((bulkOp!.ops as unknown[]).length).toBe(1);
  });

  it("handles vacant chair (null) on both sides without spurious updates", async () => {
    const partyOid = new ObjectId();
    const { db, updates } = makeDb({
      parties: [{ _id: partyOid, chairId: null }],
      coalitions: [{ _id: new ObjectId(), chairPartyId: partyOid, chairCharacterId: null }],
    });
    const modified = await reconcileAllCoalitionChairs(db);
    expect(modified).toBe(0);
    expect(updates.find((u) => u.op === "bulkWrite")).toBeUndefined();
  });

  it("updates when stored chair is non-null but the party's chair is now vacant", async () => {
    const partyOid = new ObjectId();
    const { db, updates } = makeDb({
      parties: [{ _id: partyOid, chairId: null }],
      coalitions: [
        { _id: new ObjectId(), chairPartyId: partyOid, chairCharacterId: new ObjectId() },
      ],
    });
    const modified = await reconcileAllCoalitionChairs(db);
    expect(modified).toBe(1);
    expect(updates.find((u) => u.op === "bulkWrite")).toBeTruthy();
  });

  it("returns 0 when there are no coalitions at all", async () => {
    const { db } = makeDb({ parties: [], coalitions: [] });
    const modified = await reconcileAllCoalitionChairs(db);
    expect(modified).toBe(0);
  });
});
