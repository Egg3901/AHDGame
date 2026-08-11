import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Coalition } from "@/lib/db/types/coalition";

const NOW = new Date("2026-06-04T18:00:00.000Z");

function makeCoalition(over: Partial<Coalition>): Coalition {
  return {
    _id: new ObjectId(),
    sequentialId: 1,
    countryId: "IE",
    name: "Test Coalition",
    abbreviation: "TC",
    color: "#000000",
    chairPartyId: new ObjectId(),
    chairCharacterId: new ObjectId(),
    members: [],
    pendingInvites: [],
    joinRequests: [],
    createdBy: new ObjectId(),
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as Coalition;
}

function mockCoalitionsFind(db: MockDb, coalitions: Coalition[]) {
  db.collectionMocks.coalitions = db.collectionMocks.coalitions ?? db.collection("coalitions");
  db.collectionMocks.coalitions.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(coalitions),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  });
}

describe("absorbPartyIntoCoalitions", () => {
  let db: MockDb;
  const proposingId = new ObjectId();
  const targetId = new ObjectId();
  const targetChairId = new ObjectId();
  const proposing = { _id: proposingId, sequentialId: 1 };
  const target = { _id: targetId, sequentialId: 3, chairId: targetChairId, viceChairId: null };

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  async function run() {
    const { absorbPartyIntoCoalitions } = await import("./absorbParty");
    await absorbPartyIntoCoalitions(db as unknown as Db, {
      countryId: "IE",
      proposingParty: proposing,
      targetParty: target,
      now: NOW,
    });
  }

  it("removes the absorbed party when the target is already a member", async () => {
    const coalition = makeCoalition({
      members: [
        { partyId: targetId, partySequentialId: 3, joinedAt: NOW },
        { partyId: proposingId, partySequentialId: 1, joinedAt: NOW },
        { partyId: new ObjectId(), partySequentialId: 6, joinedAt: NOW },
      ],
    });
    mockCoalitionsFind(db, [coalition]);
    await run();

    const call = db.collectionMocks.coalitions!.updateOne.mock.calls[0];
    const set = (call![1] as { $set: { members: Coalition["members"] } }).$set;
    const seqs = set.members.map((m) => m.partySequentialId);
    expect(seqs).toEqual([3, 6]); // proposing (1) pulled, target (3) retained
  });

  it("replaces the absorbed party with the target when target is not yet a member", async () => {
    const joined = new Date("2026-06-01T00:00:00.000Z");
    const coalition = makeCoalition({
      members: [
        { partyId: proposingId, partySequentialId: 1, joinedAt: joined },
        { partyId: new ObjectId(), partySequentialId: 6, joinedAt: NOW },
      ],
    });
    mockCoalitionsFind(db, [coalition]);
    await run();

    const set = (
      db.collectionMocks.coalitions!.updateOne.mock.calls[0]![1] as {
        $set: { members: Coalition["members"] };
      }
    ).$set;
    const swapped = set.members.find((m) => m.partySequentialId === 3);
    expect(swapped).toBeTruthy();
    expect(swapped!.partyId.equals(targetId)).toBe(true);
    expect(swapped!.joinedAt).toEqual(joined); // joinedAt preserved
    expect(set.members.some((m) => m.partySequentialId === 1)).toBe(false);
  });

  it("reassigns the chair to the target when the absorbed party chaired the coalition", async () => {
    const coalition = makeCoalition({
      chairPartyId: proposingId,
      chairCharacterId: new ObjectId(),
      members: [
        { partyId: targetId, partySequentialId: 3, joinedAt: NOW },
        { partyId: proposingId, partySequentialId: 1, joinedAt: NOW },
      ],
    });
    mockCoalitionsFind(db, [coalition]);
    await run();

    const set = (
      db.collectionMocks.coalitions!.updateOne.mock.calls[0]![1] as {
        $set: { chairPartyId: ObjectId; chairCharacterId: ObjectId };
      }
    ).$set;
    expect(set.chairPartyId.equals(targetId)).toBe(true);
    expect(set.chairCharacterId.equals(targetChairId)).toBe(true);
  });

  it("removes dangling pending invites and join requests to the absorbed party", async () => {
    const coalition = makeCoalition({
      members: [{ partyId: new ObjectId(), partySequentialId: 2, joinedAt: NOW }],
      pendingInvites: [{ partyId: proposingId, invitedBy: new ObjectId(), invitedAt: NOW }],
      joinRequests: [{ partyId: proposingId, requestedBy: new ObjectId(), requestedAt: NOW }],
    });
    mockCoalitionsFind(db, [coalition]);
    await run();

    const set = (
      db.collectionMocks.coalitions!.updateOne.mock.calls[0]![1] as {
        $set: { pendingInvites: unknown[]; joinRequests: unknown[] };
      }
    ).$set;
    expect(set.pendingInvites).toEqual([]);
    expect(set.joinRequests).toEqual([]);
  });

  it("does not write when no coalition references the absorbed party", async () => {
    const coalition = makeCoalition({
      members: [{ partyId: new ObjectId(), partySequentialId: 2, joinedAt: NOW }],
    });
    mockCoalitionsFind(db, [coalition]);
    await run();

    expect(db.collectionMocks.coalitions!.updateOne).not.toHaveBeenCalled();
  });
});
