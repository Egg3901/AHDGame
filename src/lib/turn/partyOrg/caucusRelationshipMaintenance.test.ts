import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Caucus, CaucusMembership, NPPRelationship } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function cursor<T>(items: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(items),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("processCaucusRelationshipMaintenance", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("nppRelationships");
    db.collection("caucusMemberships");
    db.collection("caucuses");
    db.collection("npps");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("decays relationships toward neutral and ejects caucus NPPs once the chair score falls below 20", async () => {
    const chairId = new ObjectId();
    const caucusId = new ObjectId();
    const nppId = new ObjectId();
    const now = new Date("2026-04-29T12:00:00.000Z");

    const relationships: NPPRelationship[] = [
      {
        _id: `${chairId.toString()}_${nppId.toString()}`,
        characterId: chairId,
        nppId,
        relationshipScore: 20,
        totalAttempts: 0,
        successfulAttempts: 0,
        lastAttemptTurn: 10,
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
      {
        _id: `${new ObjectId().toString()}_${new ObjectId().toString()}`,
        characterId: new ObjectId(),
        nppId: new ObjectId(),
        relationshipScore: -10,
        totalAttempts: 0,
        successfulAttempts: 0,
        lastAttemptTurn: 10,
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    ];
    const memberships: CaucusMembership[] = [
      {
        _id: new ObjectId(),
        caucusId,
        countryId: "US",
        partyId: "1",
        memberType: "npp",
        memberId: nppId,
        role: "member",
        status: "active",
        invitedAt: null,
        joinedAt: new Date("2026-04-10T00:00:00.000Z"),
        leftAt: null,
        complianceScore: -1,
        createdAt: new Date("2026-04-10T00:00:00.000Z"),
        updatedAt: new Date("2026-04-10T00:00:00.000Z"),
      },
    ];
    const caucuses: Caucus[] = [
      {
        _id: caucusId,
        slug: "test-caucus",
        previousSlugs: [],
        countryId: "US",
        partyId: "1",
        name: "Test Caucus",
        description: "desc",
        color: "#000000",
        chairId,
        viceChairId: null,
        whipMode: "soft",
        treasury: 0,
        taxRate: 0,
        lastElectedTurn: null,
        nextElectionTurn: null,
        termsServed: 0,
        disbandedAt: null,
        createdBy: chairId,
        createdAt: now,
        updatedAt: now,
      },
    ];

    db.collectionMocks["nppRelationships"]!.find.mockReturnValue(cursor(relationships));
    db.collectionMocks["caucusMemberships"]!.find.mockReturnValue(cursor(memberships));
    db.collectionMocks["caucuses"]!.find.mockReturnValue(cursor(caucuses));

    const { processCaucusRelationshipMaintenance } =
      await import("./caucusRelationshipMaintenance");
    const result = await processCaucusRelationshipMaintenance(now);

    expect(result).toEqual({
      relationshipsDecayed: 2,
      caucusMembershipsRemoved: 1,
    });
    expect(db.collectionMocks["nppRelationships"]!.bulkWrite).toHaveBeenCalledOnce();
    expect(db.collectionMocks["caucusMemberships"]!.bulkWrite).toHaveBeenCalledOnce();
    expect(db.collectionMocks["npps"]!.bulkWrite).toHaveBeenCalledOnce();

    const relationshipOps = db.collectionMocks["nppRelationships"]!.bulkWrite.mock.calls[0][0];
    expect(relationshipOps[0].updateOne.update.$set.relationshipScore).toBe(19.9);
    expect(relationshipOps[1].updateOne.update.$set.relationshipScore).toBe(-9.9);

    const membershipOps = db.collectionMocks["caucusMemberships"]!.bulkWrite.mock.calls[0][0];
    expect(membershipOps[0].updateOne.update.$set).toMatchObject({
      status: "left",
      leftAt: now,
      updatedAt: now,
    });
  });

  it("keeps caucus NPPs when the post-decay chair relationship remains above the retention floor", async () => {
    const chairId = new ObjectId();
    const caucusId = new ObjectId();
    const nppId = new ObjectId();
    const now = new Date("2026-04-29T12:00:00.000Z");

    db.collectionMocks["nppRelationships"]!.find.mockReturnValue(
      cursor([
        {
          _id: `${chairId.toString()}_${nppId.toString()}`,
          characterId: chairId,
          nppId,
          relationshipScore: 60,
          totalAttempts: 0,
          successfulAttempts: 0,
          lastAttemptTurn: 10,
          createdAt: now,
          updatedAt: now,
        } satisfies NPPRelationship,
      ])
    );
    db.collectionMocks["caucusMemberships"]!.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          caucusId,
          countryId: "US",
          partyId: "1",
          memberType: "npp",
          memberId: nppId,
          role: "member",
          status: "active",
          invitedAt: null,
          joinedAt: now,
          leftAt: null,
          complianceScore: -1,
          createdAt: now,
          updatedAt: now,
        } satisfies CaucusMembership,
      ])
    );
    db.collectionMocks["caucuses"]!.find.mockReturnValue(
      cursor([
        {
          _id: caucusId,
          slug: "test-caucus",
          previousSlugs: [],
          countryId: "US",
          partyId: "1",
          name: "Test Caucus",
          description: "desc",
          color: "#000000",
          chairId,
          viceChairId: null,
          whipMode: "soft",
          treasury: 0,
          taxRate: 0,
          lastElectedTurn: null,
          nextElectionTurn: null,
          termsServed: 0,
          disbandedAt: null,
          createdBy: chairId,
          createdAt: now,
          updatedAt: now,
        } satisfies Caucus,
      ])
    );

    const { processCaucusRelationshipMaintenance } =
      await import("./caucusRelationshipMaintenance");
    const result = await processCaucusRelationshipMaintenance(now);

    expect(result).toEqual({
      relationshipsDecayed: 1,
      caucusMembershipsRemoved: 0,
    });
    expect(db.collectionMocks["caucusMemberships"]!.bulkWrite).not.toHaveBeenCalled();
    expect(db.collectionMocks["npps"]!.bulkWrite).not.toHaveBeenCalled();
  });
});
