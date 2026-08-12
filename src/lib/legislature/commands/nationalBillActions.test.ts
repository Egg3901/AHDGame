import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { AuthUser } from "@/lib/auth";
import type { Bill, Character } from "@/lib/db/types";

vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 5 }),
}));
vi.mock("@/lib/countryState", () => ({
  // Non-one-party so the banned-party guard short-circuits without DB lookups.
  getCountryState: vi.fn().mockResolvedValue({ governmentType: "republic" }),
}));

import { performNationalBillAction } from "./nationalBillActions";

/**
 * Regression guard: CN delegates carry officeType "npcDelegate" while the bill's
 * chamber key is "npc". The vote and cosponsor eligibility lookups queried the
 * raw chamber key, so once CN bills became visible no CN delegate could vote on
 * or co-sponsor them (403 "Only … members can…"). The lookup must resolve the
 * chamber key to the office type. CN is the only country where they differ.
 */
describe("performNationalBillAction — CN chamber/office eligibility", () => {
  let db: MockDb;
  const characterId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  const character = {
    _id: characterId,
    name: "Kamier Teng",
    party: undefined,
  } as unknown as Character;
  const authUser = { userId: new ObjectId().toString(), isAdmin: false } as AuthUser;

  function cnBill(overrides: Partial<Bill> = {}): Bill {
    return {
      _id: new ObjectId(),
      title: "Public Security Act",
      summary: "Summary",
      originChamber: "npc",
      currentChamber: "npc",
      sponsorId: new ObjectId(),
      sponsorName: "Sponsor",
      status: "active",
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      countryId: "CN",
      votingEndsOnTurn: 999,
      proposedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    } as Bill;
  }

  function officialsFilter() {
    const call = db.collectionMocks["electedOfficials"]!.findOne.mock.calls[0];
    expect(call).toBeDefined();
    return call![0] as { officeType?: unknown; countryId?: string };
  }

  it("resolves the vote eligibility lookup to officeType 'npcDelegate'", async () => {
    // findOne → null forces the early 403, sidestepping the vote-recording path;
    // the assertion targets the query the route issued, which is where the bug lived.
    db.collection("electedOfficials").findOne.mockResolvedValue(null);

    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character,
      bill: cnBill(),
      countryId: "CN",
      input: { action: "vote", vote: "for" },
    });

    expect(result.status).toBe(403);
    expect(officialsFilter().officeType).toBe("npcDelegate");
    expect(officialsFilter().countryId).toBe("CN");
  });

  it("resolves the cosponsor eligibility lookup to officeType 'npcDelegate'", async () => {
    db.collection("electedOfficials").findOne.mockResolvedValue(null);

    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character,
      bill: cnBill(),
      countryId: "CN",
      input: { action: "cosponsor" },
    });

    expect(result.status).toBe(403);
    expect(officialsFilter().officeType).toEqual({ $in: ["npcDelegate"] });
    expect(officialsFilter().countryId).toBe("CN");
  });
});

/**
 * Concurrent (active_both) voting: both chambers are live at once, so every fork that
 * keyed on bill.status has to key on the VOTER's chamber instead.
 */
describe("performNationalBillAction - active_both", () => {
  let db: MockDb;
  const characterId = new ObjectId();
  const character = { _id: characterId, name: "Rep", party: undefined } as unknown as Character;
  const authUser = { userId: new ObjectId().toString(), isAdmin: false } as AuthUser;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  function usBill(overrides: Partial<Bill> = {}): Bill {
    return {
      _id: new ObjectId(),
      title: "Entry into the Vietnam War (NATO)",
      summary: "Summary",
      originChamber: "house",
      currentChamber: "house",
      sponsorId: new ObjectId(),
      sponsorName: "Sponsor",
      status: "active_both",
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      otherChamberVotes: {},
      countryId: "US",
      votingEndsOnTurn: 999,
      otherChamberVotingEndsOnTurn: 999,
      proposedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as Bill;
  }

  function seatedAs(officeType: string) {
    db.collection("electedOfficials").findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId,
      countryId: "US",
      officeType,
      seatsHeld: 1,
    });
    db.collection("bills").updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  }

  function billUpdate() {
    const call = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
    expect(call).toBeDefined();
    return {
      filter: call![0] as Record<string, unknown>,
      update: call![1] as unknown,
    };
  }

  /** The `$set` body of the vote write's aggregation pipeline. */
  function setStage(): Record<string, unknown> {
    const pipeline = billUpdate().update as Array<{ $set?: Record<string, unknown> }>;
    expect(Array.isArray(pipeline)).toBe(true);
    return pipeline[0]!.$set ?? {};
  }

  it("accepts a lower-chamber member into votes", async () => {
    seatedAs("house");
    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character,
      bill: usBill(),
      countryId: "US",
      input: { action: "vote", vote: "for" },
    });
    expect(result.status).toBe(200);
    expect(billUpdate().filter).toMatchObject({ status: "active_both" });
    // The write is an aggregation pipeline: [{ $set: { votes: {$mergeObjects...}, ... } }]
    const set = setStage();
    expect(Object.keys(set)).toContain("votes");
    expect(Object.keys(set)).toContain("votesFor");
    expect(Object.keys(set)).not.toContain("otherChamberVotes");
  });

  it("accepts an upper-chamber member into otherChamberVotes", async () => {
    seatedAs("senate");
    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character,
      bill: usBill(),
      countryId: "US",
      input: { action: "vote", vote: "for" },
    });
    expect(result.status).toBe(200);
    // Both filters must accept active_both, or half the chamber gets a 409.
    expect(billUpdate().filter).toMatchObject({ status: "active_both" });
    const set = setStage();
    expect(Object.keys(set)).toContain("otherChamberVotes");
    expect(Object.keys(set)).toContain("otherChamberVotesFor");
    expect(Object.keys(set)).not.toContain("votes");
  });

  it("queries BOTH chambers office types for eligibility", async () => {
    db.collection("electedOfficials").findOne.mockResolvedValue(null);
    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character,
      bill: usBill(),
      countryId: "US",
      input: { action: "vote", vote: "for" },
    });
    expect(result.status).toBe(403);
    const filter = db.collectionMocks["electedOfficials"]!.findOne.mock.calls[0]![0] as {
      officeType: { $in: string[] };
    };
    expect(filter.officeType.$in).toEqual(expect.arrayContaining(["house", "senate"]));
  });

  it("refuses a vote past the UPPER chamber deadline", async () => {
    // Under active_both all three status flags are false, so BOTH deadline guards were
    // skipped and late votes were accepted until the engine happened to close the bill.
    seatedAs("senate");
    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character,
      bill: usBill({ otherChamberVotingEndsOnTurn: 1 }),
      countryId: "US",
      input: { action: "vote", vote: "for" },
    });
    expect(result.status).toBe(409);
    expect(db.collectionMocks["bills"]!.updateOne).not.toHaveBeenCalled();
  });

  it("does not refuse an upper voter for the LOWER chamber deadline", async () => {
    seatedAs("senate");
    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character,
      bill: usBill({ votingEndsOnTurn: 1 }),
      countryId: "US",
      input: { action: "vote", vote: "for" },
    });
    expect(result.status).toBe(200);
  });

  it("refuses a filibuster with a reason that names the concurrent vote", async () => {
    // The generic refusal below this one says the bill is not being voted on,
    // which on a concurrent bill is plainly untrue and reads as a bug.
    seatedAs("senate");
    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character,
      bill: usBill({ currentChamber: "senate" }),
      countryId: "US",
      input: { action: "filibuster" },
    });

    expect(result.status).toBe(409);
    expect((result.body as { error: string }).error).toMatch(/both chambers/i);
  });
});
