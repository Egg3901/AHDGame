import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { electionStatusBlocksFurtherEntry, findBlockingActiveCandidacy } from "./activeCandidacy";
import type { Election } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

describe("electionStatusBlocksFurtherEntry", () => {
  it("treats completed elections as blocking (awaiting resolution)", () => {
    expect(electionStatusBlocksFurtherEntry("completed" satisfies Election["status"])).toBe(true);
  });

  it("does not block after resolution or cancellation", () => {
    expect(electionStatusBlocksFurtherEntry("resolved" satisfies Election["status"])).toBe(false);
    expect(electionStatusBlocksFurtherEntry("cancelled" satisfies Election["status"])).toBe(false);
  });
});

describe("findBlockingActiveCandidacy", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    // Trigger lazy collection creation so collectionMocks entries are available.
    db.collection("electionCandidates");
    db.collection("elections");
  });

  it("returns null when character has no active candidacies", async () => {
    db.collectionMocks["electionCandidates"].find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const result = await findBlockingActiveCandidacy(db as unknown as Db, new ObjectId());
    expect(result).toBeNull();
  });

  it("returns null when all active candidacies are in non-blocking elections", async () => {
    const electionId = new ObjectId();
    const characterId = new ObjectId();
    db.collectionMocks["electionCandidates"].find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: new ObjectId(), electionId, characterId, status: "active" }]),
    });
    db.collectionMocks["elections"].find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: electionId, status: "resolved" }]),
    });

    const result = await findBlockingActiveCandidacy(db as unknown as Db, characterId);
    expect(result).toBeNull();
  });

  it("returns the candidate and election when a blocking election is found", async () => {
    const electionId = new ObjectId();
    const characterId = new ObjectId();
    const candidate = { _id: new ObjectId(), electionId, characterId, status: "active" as const };
    const election = { _id: electionId, status: "active", countryId: "US" };

    db.collectionMocks["electionCandidates"].find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([candidate]),
    });
    db.collectionMocks["elections"].find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([election]),
    });

    const result = await findBlockingActiveCandidacy(db as unknown as Db, characterId);
    expect(result).not.toBeNull();
    expect(result?.candidate).toBe(candidate);
    expect(result?.election).toBe(election);
  });

  it("skips the excluded election and returns null", async () => {
    const excludedId = new ObjectId();
    const characterId = new ObjectId();
    db.collectionMocks["electionCandidates"].find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { _id: new ObjectId(), electionId: excludedId, characterId, status: "active" },
        ]),
    });

    const result = await findBlockingActiveCandidacy(db as unknown as Db, characterId, excludedId);
    expect(result).toBeNull();
    // Election collection should not be queried when all candidates are excluded
    expect(db.collectionMocks["elections"].find).not.toHaveBeenCalled();
  });

  it("issues a single batched query for multiple candidacies", async () => {
    const characterId = new ObjectId();
    const id1 = new ObjectId();
    const id2 = new ObjectId();
    db.collectionMocks["electionCandidates"].find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: new ObjectId(), electionId: id1, characterId, status: "active" },
        { _id: new ObjectId(), electionId: id2, characterId, status: "active" },
      ]),
    });
    db.collectionMocks["elections"].find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: id1, status: "resolved" },
        { _id: id2, status: "active" },
      ]),
    });

    const result = await findBlockingActiveCandidacy(db as unknown as Db, characterId);
    expect(result?.candidate.electionId).toEqual(id2);
    // One batched query, not N individual findOne calls
    expect(db.collectionMocks["elections"].find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks["elections"].findOne).not.toHaveBeenCalled();
  });
});
