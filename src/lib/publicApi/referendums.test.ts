import { ObjectId, type Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

describe("public referendum queries", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    ["referendums", "states", "politicalParties"].forEach((name) => db.collection(name));
  });

  it("publishes polling and results while withholding cohort and spend internals", async () => {
    const row = {
      _id: new ObjectId("507f1f77bcf86cd799439011"),
      countryId: "UK",
      regionId: "SCO",
      kind: "independence",
      targetCountryId: null,
      status: "completed",
      requestedTurn: 1,
      grantedTurn: 2,
      campaignOpenTurn: 3,
      campaignCloseTurn: 10,
      conversionDeadlineTurn: null,
      yesShare: 52,
      campaignBaseYesShare: 48,
      pollHistory: [{ turn: 3, yesShare: 48 }],
      partyPositions: [
        { partyId: "7", side: "yes", declaredByCharacterId: new ObjectId(), declaredTurn: 4 },
      ],
      campaignSpendUnits: { yes: 99, no: 80 },
      cohortBaseline: [{ groupId: "secret", share: 1, turnout: 1, yesLean: 1 }],
      result: { finalYesShare: 52, turnout: 70, passed: true, resolvedTurn: 10 },
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    };
    db.collectionMocks.referendums!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([row]),
    } as never);
    db.collectionMocks.states!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "SCO", name: "Scotland" }]),
    } as never);
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ countryId: "UK", sequentialId: 7, name: "Scottish Party" }]),
    } as never);

    const { queryReferendums } = await import("./referendums");
    const result = await queryReferendums(db as unknown as Db, {
      country: "UK",
      status: "completed",
    });

    expect(result.referendums[0]).toMatchObject({
      region: { id: "SCO", name: "Scotland" },
      campaign: {
        yesShare: 52,
        partyPositions: [expect.objectContaining({ partyName: "Scottish Party" })],
      },
      result: { yesShare: 52, noShare: 48, passed: true },
    });
    expect(result.referendums[0]).not.toHaveProperty("campaignSpendUnits");
    expect(result.referendums[0]).not.toHaveProperty("cohortBaseline");
  });

  it("does not query Mongo for malformed detail ids", async () => {
    const { queryReferendum } = await import("./referendums");
    expect(await queryReferendum(db as unknown as Db, "bad-id")).toBeNull();
    expect(db.collectionMocks.referendums!.findOne).not.toHaveBeenCalled();
  });
});
