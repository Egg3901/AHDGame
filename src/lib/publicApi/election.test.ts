import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

describe("queryElectionList", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    ["elections", "electionCandidates", "electionVoteTallies", "politicalParties"].forEach((n) =>
      db.collection(n)
    );
  });

  it("returns empty list when no elections found", async () => {
    db.collectionMocks.elections!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryElectionList } = await import("./election");
    const result = await queryElectionList(db as unknown as Db, { country: "US" });
    expect(result).toEqual({ found: false, elections: [] });
  });

  it("includes finalVotes when election status is ended", async () => {
    const elecId = new ObjectId();
    db.collectionMocks.elections!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: elecId,
          seatId: "US-senate-CA-1",
          electionType: "senate",
          state: "CA",
          status: "ended",
          startTime: new Date("2025-01-01"),
          endTime: new Date("2025-01-08"),
          countryId: "US",
        },
      ]),
    } as never);

    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          characterId: new ObjectId(),
          electionId: elecId,
          characterName: "Jane Smith",
          party: "1",
          isNPP: false,
        },
      ]),
    } as never);

    db.collectionMocks.electionVoteTallies!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          electionId: elecId,
          totalVotes: { char1: 500, char2: 300 },
        },
      ]),
    } as never);

    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryElectionList } = await import("./election");
    const result = await queryElectionList(db as unknown as Db, { country: "US", state: "CA" });

    expect(result.found).toBe(true);
    expect(result.elections[0]).toHaveProperty("finalVotes");
  });
});

describe("queryElectionDetail", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    [
      "elections",
      "electionCandidates",
      "electionVoteTallies",
      "primarySnapshots",
      "politicalParties",
    ].forEach((n) => db.collection(n));
  });

  it("returns null when election not found", async () => {
    db.collectionMocks.elections!.findOne.mockResolvedValue(null);
    const { queryElectionDetail } = await import("./election");
    const result = await queryElectionDetail(db as unknown as Db, new ObjectId().toString());
    expect(result).toBeNull();
  });

  it("returns null incumbent when no winner on record", async () => {
    const elecId = new ObjectId();
    db.collectionMocks
      .elections!.findOne.mockResolvedValueOnce({
        _id: elecId,
        seatId: "US-senate-CA-1",
        electionType: "senate",
        state: "CA",
        stateName: "California",
        countryId: "US",
        cycle: 2,
        status: "active",
        totalSeats: 1,
        startTime: new Date("2025-01-01"),
        endTime: new Date("2025-01-08"),
      })
      .mockResolvedValueOnce(null); // prior cycle lookup

    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.electionVoteTallies!.findOne.mockResolvedValue(null);
    db.collectionMocks.primarySnapshots!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryElectionDetail } = await import("./election");
    const result = await queryElectionDetail(db as unknown as Db, elecId.toString());

    expect(result).not.toBeNull();
    expect(result!.incumbent).toBeNull();
  });

  it("projects primarySnapshots to clean shape (no internal fields)", async () => {
    const elecId = new ObjectId();
    db.collectionMocks.elections!.findOne.mockResolvedValueOnce({
      _id: elecId,
      seatId: "US-house-CA-1",
      electionType: "house",
      state: "CA",
      stateName: "California",
      countryId: "US",
      cycle: 1,
      status: "general",
      totalSeats: 1,
      startTime: new Date("2025-01-01"),
      endTime: new Date("2025-01-08"),
    });
    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.electionVoteTallies!.findOne.mockResolvedValue(null);
    db.collectionMocks.primarySnapshots!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          electionId: elecId,
          recordedAt: new Date("2025-01-05"),
          byParty: {
            "1": [
              {
                candidateId: "char1",
                characterName: "Jane",
                party: "1",
                primaryScore: 80,
                sharePct: 60,
                _internalField: "should_not_appear",
              },
            ],
          },
          _rawDbField: "should_not_appear",
        },
      ]),
    } as never);
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryElectionDetail } = await import("./election");
    const result = await queryElectionDetail(db as unknown as Db, elecId.toString());

    expect(result).not.toBeNull();
    const snap = result!.primarySnapshots[0];
    expect(snap).toHaveProperty("turn", 1);
    expect(snap.candidates[0]).toHaveProperty("name", "Jane");
    expect(snap.candidates[0]).toHaveProperty("sharePct", 60);
    expect(snap.candidates[0]).not.toHaveProperty("_internalField");
    expect(snap).not.toHaveProperty("_rawDbField");
  });
});
