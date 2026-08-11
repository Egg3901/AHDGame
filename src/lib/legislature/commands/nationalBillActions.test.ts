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
