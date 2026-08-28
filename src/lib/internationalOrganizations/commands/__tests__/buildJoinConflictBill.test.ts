import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { Bill, JoinConflictProvision } from "@/lib/db/types/legislation";

const notifyChambersVoteOpen = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/turn/billLifecycle/lifecycleHelpers", () => ({
  notifyChambersVoteOpen: (...args: unknown[]) => notifyChambersVoteOpen(...args),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: async () => 100 }));

const { buildJoinConflictBill } = await import("../buildJoinConflictBill");

const PROVISION: JoinConflictProvision = {
  type: "join_conflict",
  theaterId: "507f1f77bcf86cd799439011",
  side: "A",
  organizationId: "NATO",
  resolutionId: "507f1f77bcf86cd799439012",
};

function setup() {
  const db = createMockDb();
  db.collection("bills");
  db.collectionMocks["bills"]!.insertOne.mockResolvedValue({ acknowledged: true });
  return db;
}

const inserted = (db: ReturnType<typeof setup>): Bill =>
  db.collectionMocks["bills"]!.insertOne.mock.calls[0]![0] as Bill;

const run = (db: ReturnType<typeof setup>, countryId: "US" | "UK" | "RU" = "US", isNpp = false) =>
  buildJoinConflictBill({
    db: db as unknown as Db,
    countryId,
    preset: "1953-default",
    sponsor: { characterId: new ObjectId(), characterName: "Foreign Secretary", isNpp },
    conflictName: "Korean War",
    organizationId: "NATO",
    provision: PROVISION,
  });

describe("buildJoinConflictBill", () => {
  beforeEach(() => notifyChambersVoteOpen.mockClear());

  it("stamps BOTH deadline pairs and initialises both vote maps", async () => {
    const db = setup();
    await run(db);
    const doc = inserted(db);

    expect(doc.status).toBe("active_both");
    // The builder inserts directly, so ConcurrentVoteStage's entry logic never runs
    // for these bills — it owns the whole opening state.
    expect(doc.votingEndsOnTurn).toBeDefined();
    expect(doc.otherChamberVotingEndsOnTurn).toBeDefined();
    expect(doc.votingEndsAt).toBeInstanceOf(Date);
    expect(doc.otherChamberVotingEndsAt).toBeInstanceOf(Date);
    expect(doc.otherChamberVotes).toEqual({});
    expect(doc.otherChamberVotesFor).toBe(0);
    expect(doc.otherChamberVotesAgainst).toBe(0);
    expect(doc.otherChamberVotesAbstain).toBe(0);
    // originChamber, or closeConcurrentVoteStage's `$in: config.originChambers`
    // scoping never claims the bill and it never closes.
    expect(doc.originChamber).toBeTruthy();
    expect(doc.currentChamber).toBeTruthy();
    expect(doc.proposalActionCost).toBe(0);
  });

  it("carries the provision and files it in the country's own legislature", async () => {
    const db = setup();
    await run(db);
    const doc = inserted(db);

    expect(doc.countryId).toBe("US");
    expect(doc.provisions).toEqual([PROVISION]);
    expect(doc.category).toBe("foreign policy");
  });

  it("marks an NPP-sponsored ratification for the autonomous force preflight", async () => {
    const db = setup();
    await run(db, "US", true);

    expect(inserted(db).nppSponsored).toBe(true);
  });

  it("files a Soviet bill at su_national, not the id a naive fallback would build", async () => {
    // The bill is spawned in 17 countries; the national-scope map covers 10, and a
    // `${lower}_national` fallback yields "ru_national" — which, per that map's own
    // comment, nothing else reads.
    const db = setup();
    await run(db, "RU");

    expect(inserted(db).stateId).toBe("su_national");
  });

  it("notifies both chambers", async () => {
    // A Join Conflict bill lands UNBIDDEN on a 24-turn clock; buildMembershipBill gets
    // away without a notification because that bill is raised by the country itself.
    const db = setup();
    await run(db);

    expect(notifyChambersVoteOpen).toHaveBeenCalledTimes(2);
    const officeTypes = notifyChambersVoteOpen.mock.calls.map((c) => c[2]);
    expect(new Set(officeTypes).size).toBe(2);
  });

  it("notifies only the one chamber that votes in a unicameral legislature", async () => {
    // The UK Lords do not vote on bills, so a second notice would ping a chamber that
    // has no say — and the close would then wait on a tally nobody can fill.
    const db = setup();
    await run(db, "UK");

    expect(notifyChambersVoteOpen).toHaveBeenCalledTimes(1);
  });
});
