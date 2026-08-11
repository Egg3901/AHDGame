/**
 * Unit tests for processBanPartyEffects / processUnbanPartyEffects.
 *
 * Banning a party in a one-party state:
 *   - Flips the party's regimeStatus to "banned" (with audit fields).
 *   - Deletes all ElectedOfficial docs for the party (mirrors resign).
 *   - Clears currentOffice on every affected Character / NPP.
 *   - Clears autoRunForReelection on affected characters so the next
 *     auto-reelection turn does not silently re-enter them.
 *   - Returns { officialsVacated, seatsVacated }.
 *
 * Unbanning flips regimeStatus to "approved" with no automatic seat
 * restoration.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { processBanPartyEffects, processUnbanPartyEffects } from "@/lib/onePartyState/banFlow";

function makeCursor(docs: unknown[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

describe("processBanPartyEffects", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties");
    db.collection("electedOfficials");
    db.collection("characters");
    db.collection("npps");
  });

  it("flips party status and vacates all of its officials", async () => {
    const partyId = new ObjectId();
    const charId = new ObjectId();
    const nppId = new ObjectId();

    const officialA = {
      _id: new ObjectId(),
      characterId: charId,
      party: "2",
      seatsHeld: 1,
      countryId: "CN",
    };
    const officialB = {
      _id: new ObjectId(),
      nppId,
      party: "2",
      seatsHeld: 3,
      countryId: "CN",
    };

    db.collectionMocks.electedOfficials.find.mockReturnValue(makeCursor([officialA, officialB]));

    const result = await processBanPartyEffects(db as unknown as Db, {
      countryId: "CN",
      partyId,
      partySeqId: 2,
      reason: "admin action",
      currentTurn: 100,
    });

    expect(result.officialsVacated).toBe(2);
    expect(result.seatsVacated).toBe(4);

    const partyUpdate = db.collectionMocks.politicalParties.updateOne.mock.calls.find(
      (c: unknown[]) => (c[0] as { _id?: ObjectId })._id?.equals?.(partyId)
    );
    expect((partyUpdate?.[1] as { $set?: { regimeStatus?: string } }).$set?.regimeStatus).toBe(
      "banned"
    );
    expect((partyUpdate?.[1] as { $set?: { bannedAt?: Date } }).$set?.bannedAt).toBeInstanceOf(
      Date
    );

    expect(db.collectionMocks.electedOfficials.deleteOne).toHaveBeenCalledTimes(2);
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalled();
    expect(db.collectionMocks.npps.updateOne).toHaveBeenCalled();

    // Character update should also clear autoRunForReelection so the
    // banned member is not re-entered into next cycle's primary.
    const charUpdate = db.collectionMocks.characters.updateOne.mock.calls.find((c: unknown[]) =>
      (c[0] as { _id?: ObjectId })._id?.equals?.(charId)
    );
    const charSet = (charUpdate?.[1] as { $set?: Record<string, unknown> }).$set;
    expect(charSet?.currentOffice).toBeNull();
    expect(charSet?.autoRunForReelection).toBe(false);
  });

  it("returns zero counts when the party has no officials", async () => {
    db.collectionMocks.electedOfficials.find.mockReturnValue(makeCursor([]));

    const result = await processBanPartyEffects(db as unknown as Db, {
      countryId: "CN",
      partyId: new ObjectId(),
      partySeqId: 99,
      reason: "test",
      currentTurn: 100,
    });

    expect(result.officialsVacated).toBe(0);
    expect(result.seatsVacated).toBe(0);
    expect(db.collectionMocks.electedOfficials.deleteOne).not.toHaveBeenCalled();
    // Party status is still flipped even with no officials.
    expect(db.collectionMocks.politicalParties.updateOne).toHaveBeenCalled();
  });
});

describe("processUnbanPartyEffects", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties");
  });

  it("flips the status to approved and does not touch officials", async () => {
    const partyId = new ObjectId();
    await processUnbanPartyEffects(db as unknown as Db, {
      partyId,
      reason: "rehabilitated",
    });

    const partyUpdate = db.collectionMocks.politicalParties.updateOne.mock.calls.find(
      (c: unknown[]) => (c[0] as { _id?: ObjectId })._id?.equals?.(partyId)
    );
    expect((partyUpdate?.[1] as { $set?: { regimeStatus?: string } }).$set?.regimeStatus).toBe(
      "approved"
    );
    // No seat restoration: electedOfficials collection never accessed.
    expect(db.collectionMocks.electedOfficials).toBeUndefined();
  });
});
