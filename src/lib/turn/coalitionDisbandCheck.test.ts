import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveExpiredDisbandVotes } from "./coalitionDisbandCheck";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 100 }),
}));

import { getDb } from "@/lib/mongodb";
import { createNotifications } from "@/lib/notifications";

describe("coalitionDisbandCheck", () => {
  let mockDb: Db;
  let mockCollection: ReturnType<typeof vi.fn>;
  let mockUpdateOne: ReturnType<typeof vi.fn>;
  let mockUpdateMany: ReturnType<typeof vi.fn>;
  let mockDeleteOne: ReturnType<typeof vi.fn>;
  let mockBulkWrite: ReturnType<typeof vi.fn>;

  const createMockChain = (result: any[]) => ({
    find: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(result),
  });

  beforeEach(() => {
    mockUpdateOne = vi.fn();
    mockUpdateMany = vi.fn();
    mockDeleteOne = vi.fn();
    mockBulkWrite = vi.fn();
    mockCollection = vi.fn().mockImplementation(() => ({
      find: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn(),
      updateOne: mockUpdateOne,
      updateMany: mockUpdateMany,
      deleteOne: mockDeleteOne,
      bulkWrite: mockBulkWrite,
    }));

    mockDb = {
      collection: mockCollection,
    } as unknown as Db;

    vi.mocked(getDb).mockResolvedValue(mockDb);
    vi.clearAllMocks();
  });

  describe("resolveExpiredDisbandVotes", () => {
    const createCoalition = (overrides?: Partial<any>) => ({
      _id: "coalition-1" as any,
      sequentialId: 1,
      name: "Test Coalition",
      countryId: "US" as const,
      members: [
        { partyId: "party-1" as any, joinedAt: new Date() },
        { partyId: "party-2" as any, joinedAt: new Date() },
      ],
      disbandVote: {
        expiresAt: new Date(Date.now() - 1000), // Expired
        votes: [
          { partyId: "party-1" as any, vote: "yes" as const },
          { partyId: "party-2" as any, vote: "no" as const },
        ],
      },
      ...overrides,
    });

    const createParty = (id: string, chairId?: ObjectId) => ({
      _id: id as any,
      sequentialId: 1,
      name: "Test Party",
      chairId,
      countryId: "US" as const,
    });

    const createCharacter = (id: ObjectId, userId: string) => ({
      _id: id,
      userId,
      name: "Test Chair",
    });

    it("returns 0 when no expired coalitions exist", async () => {
      mockCollection.mockReturnValueOnce(createMockChain([]));

      const result = await resolveExpiredDisbandVotes();

      expect(result).toEqual({ resolved: 0, disbanded: 0 });
      expect(mockUpdateOne).not.toHaveBeenCalled();
      expect(mockDeleteOne).not.toHaveBeenCalled();
    });

    it("disbands coalition when majority votes yes", async () => {
      const party1Id = "party-1" as any;
      const party2Id = "party-2" as any;
      const chair1Id = new ObjectId();
      const chair2Id = new ObjectId();

      const coalition = createCoalition({
        disbandVote: {
          expiresAt: new Date(Date.now() - 1000),
          votes: [
            { partyId: party1Id, vote: "yes" as const },
            { partyId: party2Id, vote: "yes" as const },
          ],
        },
      });

      // Call 1: find expired coalitions
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([coalition]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 2: updateMany on parties (clear coalitionId)
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn(),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 3: find parties for notification
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi
          .fn()
          .mockResolvedValue([createParty(party1Id, chair1Id), createParty(party2Id, chair2Id)]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 4: find characters for chairs
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi
          .fn()
          .mockResolvedValue([
            createCharacter(chair1Id, "user-1"),
            createCharacter(chair2Id, "user-2"),
          ]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 5: deleteOne on coalition
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn(),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });

      const result = await resolveExpiredDisbandVotes();

      expect(result).toEqual({ resolved: 1, disbanded: 1 });

      // Coalition should be deleted
      expect(mockDeleteOne).toHaveBeenCalledWith({ _id: coalition._id });

      // updateMany clears coalitionId only on parties whose coalitionId actually
      // points at this coalition (defensive against pre-fix data corruption).
      expect(mockUpdateMany).toHaveBeenCalledWith(
        { _id: { $in: [party1Id, party2Id] }, coalitionId: coalition._id },
        { $set: { coalitionId: null } }
      );

      // Notifications should be created for both chairs (single batched call)
      expect(createNotifications).toHaveBeenCalledTimes(1);
      const batched = vi.mocked(createNotifications).mock.calls[0][0];
      expect(batched).toHaveLength(2);
      expect(batched).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: "user-1",
            type: "coalition_disbanded",
            title: "Test Coalition Disbanded",
          }),
        ])
      );
    });

    it("clears disbandVote when majority votes no", async () => {
      const party1Id = "party-1" as any;
      const party2Id = "party-2" as any;

      const coalition = createCoalition({
        disbandVote: {
          expiresAt: new Date(Date.now() - 1000),
          votes: [
            { partyId: party1Id, vote: "yes" as const },
            { partyId: party2Id, vote: "no" as const },
          ],
        },
      });

      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([coalition]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });

      const result = await resolveExpiredDisbandVotes();

      expect(result).toEqual({ resolved: 1, disbanded: 0 });

      // disbandVote should be cleared, coalition remains
      expect(mockUpdateOne).toHaveBeenCalledWith(
        { _id: coalition._id },
        { $set: { disbandVote: null, updatedAt: expect.any(Date) } }
      );
      expect(mockDeleteOne).not.toHaveBeenCalled();
    });

    it("handles tie vote (no majority for disband)", async () => {
      const coalition = createCoalition({
        members: [
          { partyId: "party-1" as any, joinedAt: new Date() },
          { partyId: "party-2" as any, joinedAt: new Date() },
          { partyId: "party-3" as any, joinedAt: new Date() },
          { partyId: "party-4" as any, joinedAt: new Date() },
        ],
        disbandVote: {
          expiresAt: new Date(Date.now() - 1000),
          votes: [
            { partyId: "party-1" as any, vote: "yes" as const },
            { partyId: "party-2" as any, vote: "yes" as const },
            { partyId: "party-3" as any, vote: "no" as const },
            { partyId: "party-4" as any, vote: "no" as const },
          ],
        },
      });

      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([coalition]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });

      const result = await resolveExpiredDisbandVotes();

      // 2 yes votes out of 4 members, majority threshold is 3 (floor(4/2) + 1)
      expect(result).toEqual({ resolved: 1, disbanded: 0 });
      expect(mockUpdateOne).toHaveBeenCalledWith(
        { _id: coalition._id },
        { $set: { disbandVote: null, updatedAt: expect.any(Date) } }
      );
    });

    it("handles coalition with null disbandVote gracefully", async () => {
      const coalition = {
        _id: "coalition-1" as any,
        sequentialId: 1,
        name: "Test Coalition",
        countryId: "US" as const,
        members: [],
        disbandVote: null,
      };

      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([coalition]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });

      const result = await resolveExpiredDisbandVotes();

      // Should skip coalitions with null disbandVote
      expect(result).toEqual({ resolved: 0, disbanded: 0 });
    });

    it("calculates majority threshold correctly for odd number of members", async () => {
      const party1Id = "party-1" as any;
      const party2Id = "party-2" as any;
      const party3Id = "party-3" as any;
      const chair1Id = new ObjectId();
      const chair2Id = new ObjectId();
      const chair3Id = new ObjectId();

      const coalition = createCoalition({
        members: [
          { partyId: party1Id, joinedAt: new Date() },
          { partyId: party2Id, joinedAt: new Date() },
          { partyId: party3Id, joinedAt: new Date() },
        ],
        disbandVote: {
          expiresAt: new Date(Date.now() - 1000),
          votes: [
            { partyId: party1Id, vote: "yes" as const },
            { partyId: party2Id, vote: "yes" as const },
            { partyId: party3Id, vote: "no" as const },
          ],
        },
      });

      // Call 1: find expired coalitions
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([coalition]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 2: updateMany on parties
      mockUpdateMany.mockResolvedValue({ modifiedCount: 1 });
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn(),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 3: find parties for notification
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi
          .fn()
          .mockResolvedValue([
            createParty(party1Id, chair1Id),
            createParty(party2Id, chair2Id),
            createParty(party3Id, chair3Id),
          ]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 4: find characters
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi
          .fn()
          .mockResolvedValue([
            createCharacter(chair1Id, "user-1"),
            createCharacter(chair2Id, "user-2"),
            createCharacter(chair3Id, "user-3"),
          ]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 5: deleteOne on coalition
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn(),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });

      const result = await resolveExpiredDisbandVotes();

      // 2 yes votes out of 3 members, majority threshold is 2 (floor(3/2) + 1)
      expect(result).toEqual({ resolved: 1, disbanded: 1 });
      expect(mockDeleteOne).toHaveBeenCalledWith({ _id: coalition._id });
    });

    it("handles coalition where some members didnt vote", async () => {
      const coalition = createCoalition({
        members: [
          { partyId: "party-1" as any, joinedAt: new Date() },
          { partyId: "party-2" as any, joinedAt: new Date() },
          { partyId: "party-3" as any, joinedAt: new Date() },
        ],
        disbandVote: {
          expiresAt: new Date(Date.now() - 1000),
          votes: [
            { partyId: "party-1" as any, vote: "yes" as const },
            // party-2 and party-3 didnt vote
          ],
        },
      });

      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([coalition]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });

      const result = await resolveExpiredDisbandVotes();

      // 1 yes vote out of 3 members, majority threshold is 2
      expect(result).toEqual({ resolved: 1, disbanded: 0 });
      expect(mockUpdateOne).toHaveBeenCalledWith(
        { _id: coalition._id },
        { $set: { disbandVote: null, updatedAt: expect.any(Date) } }
      );
    });

    it("clears party coalitionId on successful disband", async () => {
      const party1Id = "party-1" as any;
      const party2Id = "party-2" as any;
      const chair1Id = new ObjectId();
      const chair2Id = new ObjectId();

      const coalition = createCoalition({
        disbandVote: {
          expiresAt: new Date(Date.now() - 1000),
          votes: [
            { partyId: party1Id, vote: "yes" as const },
            { partyId: party2Id, vote: "yes" as const },
          ],
        },
      });

      // Call 1: find expired coalitions
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([coalition]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 2: updateMany on parties
      mockUpdateMany.mockResolvedValue({ modifiedCount: 1 });
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn(),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 3: find parties for notification
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi
          .fn()
          .mockResolvedValue([createParty(party1Id, chair1Id), createParty(party2Id, chair2Id)]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 4: find characters
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi
          .fn()
          .mockResolvedValue([
            createCharacter(chair1Id, "user-1"),
            createCharacter(chair2Id, "user-2"),
          ]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 5: deleteOne on coalition
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn(),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });

      await resolveExpiredDisbandVotes();

      // Should clear coalitionId on member parties via updateMany — only for parties
      // whose coalitionId actually points at this coalition.
      expect(mockUpdateMany).toHaveBeenCalledWith(
        { _id: { $in: [party1Id, party2Id] }, coalitionId: coalition._id },
        { $set: { coalitionId: null } }
      );
    });

    it("handles party without chair gracefully", async () => {
      const party1Id = "party-1" as any;

      // Coalition with only 1 member, so 1 yes vote is a majority (floor(1/2) + 1 = 1)
      const coalition = createCoalition({
        members: [{ partyId: party1Id, joinedAt: new Date() }],
        disbandVote: {
          expiresAt: new Date(Date.now() - 1000),
          votes: [{ partyId: party1Id, vote: "yes" as const }],
        },
      });

      // Call 1: coalitions.find() - find expired coalitions
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([coalition]),
        updateOne: mockUpdateOne,
        updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        bulkWrite: mockBulkWrite,
      });
      // Call 2: parties.updateMany() - clear coalitionId
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn(),
        updateOne: mockUpdateOne,
        updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        bulkWrite: mockBulkWrite,
      });
      // Call 3: parties.find().project().toArray() - get parties for notification
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([createParty(party1Id, undefined)]),
        updateOne: mockUpdateOne,
        updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        bulkWrite: mockBulkWrite,
      });
      // Call 4: characters.find().project().toArray() - get characters
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
        updateOne: mockUpdateOne,
        updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        bulkWrite: mockBulkWrite,
      });
      // Call 5: coalitions.deleteOne() - delete coalition
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn(),
        updateOne: mockUpdateOne,
        updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        bulkWrite: mockBulkWrite,
      });

      const result = await resolveExpiredDisbandVotes();

      expect(result).toEqual({ resolved: 1, disbanded: 1 });
      // Should not crash when party has no chair — batch flushes with []
      const batched = vi.mocked(createNotifications).mock.calls[0]?.[0] ?? [];
      expect(batched).toEqual([]);
    });

    it("processes multiple expired coalitions", async () => {
      const party1Id = "party-1" as any;
      const chair1Id = new ObjectId();

      const coalition1 = createCoalition({
        _id: "coalition-1" as any,
        name: "Coalition 1",
        members: [{ partyId: party1Id, joinedAt: new Date() }],
        disbandVote: {
          expiresAt: new Date(Date.now() - 1000),
          votes: [{ partyId: party1Id, vote: "yes" as const }],
        },
      });

      const coalition2 = createCoalition({
        _id: "coalition-2" as any,
        name: "Coalition 2",
        disbandVote: {
          expiresAt: new Date(Date.now() - 1000),
          votes: [{ partyId: "party-2" as any, vote: "no" as const }],
        },
      });

      // Call 1: find expired coalitions
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([coalition1, coalition2]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 2: updateMany for coalition1
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn(),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 3: parties for coalition1 (disband)
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([createParty(party1Id, chair1Id)]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 4: characters for coalition1
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([createCharacter(chair1Id, "user-1")]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 5: deleteOne for coalition1
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn(),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 6: updateOne for coalition2 (vote failed)
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn(),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });

      const result = await resolveExpiredDisbandVotes();

      expect(result.resolved).toBe(2);
      expect(result.disbanded).toBe(1); // Only coalition1 disbanded
    });

    it("uses correct notification metadata", async () => {
      const party1Id = "party-1" as any;
      const chairId = new ObjectId();
      const coalition = createCoalition({
        _id: "coalition-1" as any,
        sequentialId: 42,
        name: "Test Coalition",
        countryId: "US" as const,
        members: [{ partyId: party1Id, joinedAt: new Date() }],
        disbandVote: {
          expiresAt: new Date(Date.now() - 1000),
          votes: [{ partyId: party1Id, vote: "yes" as const }],
        },
      });

      // Call 1: find expired coalitions
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([coalition]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 2: updateMany on parties
      mockUpdateMany.mockResolvedValue({ modifiedCount: 1 });
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn(),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 3: find parties for notification
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([createParty(party1Id, chairId)]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 4: find characters
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([createCharacter(chairId, "user-1")]),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });
      // Call 5: deleteOne on coalition
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn(),
        updateOne: mockUpdateOne,
        updateMany: mockUpdateMany,
        deleteOne: mockDeleteOne,
        bulkWrite: mockBulkWrite,
      });

      await resolveExpiredDisbandVotes();

      expect(createNotifications).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            metadata: expect.objectContaining({
              coalitionId: coalition._id,
              coalitionSequentialId: 42,
              coalitionName: "Test Coalition",
              countryId: "US",
            }),
          }),
        ])
      );
    });
  });
});
