import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { JoinConflictProvision } from "@/lib/db/types/legislation";

vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn(),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(new ObjectId()),
}));

const { runBillLifecycle } = await import("../engine");
const { US_NATIONAL_CONFIG } = await import("../configs/us");

const NOW = new Date("2025-06-15T12:00:00Z");

const cursor = (rows: unknown[]) => ({
  toArray: vi.fn().mockResolvedValue(rows),
  project: vi.fn().mockReturnThis(),
  sort: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  skip: vi.fn().mockReturnThis(),
});

const PROVISION: JoinConflictProvision = {
  type: "join_conflict",
  theaterId: "korea-1953",
  side: "A",
  organizationId: "NATO",
  resolutionId: "507f1f77bcf86cd799439012",
};

/**
 * The seam between PR2's concurrent stage and PR3's provision.
 *
 * The US config DOES carry an executiveAction stage, and the concurrent stage sets
 * `execActionCheckOnPass`, so what decides whether a passed bill reaches the
 * President is `billRequiresExecutiveAction` — i.e. the provision itself. The
 * control case below is what makes this discriminating: the same bill, same
 * chambers, same votes, differing only in its provisions.
 */
describe("a passed concurrent bill and the President", () => {
  let db: MockDb;
  const houseAye = new ObjectId();
  const senateAye = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    db.collection("bills");
    db.collection("electedOfficials");
    db.collection("characters");
    db.collection("gameState");
  });

  function runWith(provisions: unknown[]) {
    const bill = {
      _id: new ObjectId(),
      countryId: "US",
      stateId: "federal",
      status: "active_both",
      originChamber: "house",
      currentChamber: "house",
      title: "Entry into the Korean War (NATO)",
      provisions,
      votes: { [houseAye.toString()]: "for" },
      otherChamberVotes: { [senateAye.toString()]: "for" },
      votingEndsOnTurn: 1,
      otherChamberVotingEndsOnTurn: 1,
    };
    db.collectionMocks["bills"]!.find.mockImplementation(
      (q: { status?: string }) => cursor(q?.status === "active_both" ? [bill] : []) as never
    );
    db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      cursor([
        { characterId: houseAye, countryId: "US", officeType: "house", seatsHeld: 1 },
        { characterId: senateAye, countryId: "US", officeType: "senate", seatsHeld: 1 },
      ]) as never
    );
    db.collectionMocks["bills"]!.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    return runBillLifecycle(db as unknown as Db, US_NATIONAL_CONFIG, NOW, 10);
  }

  const lastStatus = () => {
    const calls = db.collectionMocks["bills"]!.updateOne.mock.calls;
    const set = (calls[calls.length - 1]?.[1] as { $set?: Record<string, unknown> })?.$set ?? {};
    return set.status;
  };

  it("sends an ordinary bill to the President's desk", async () => {
    // The control. Without this the assertion below would pass even if the
    // executive stage were simply unreachable.
    await runWith([]);
    expect(lastStatus()).toBe("enrolled");
  });

  it("enacts a join-conflict bill outright, skipping the President", async () => {
    await runWith([PROVISION]);
    expect(lastStatus()).toBe("signed");
  });
});
