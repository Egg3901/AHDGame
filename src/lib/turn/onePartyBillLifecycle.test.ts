import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb, assertSetFields } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 5 }),
}));
vi.mock("@/lib/turn/rulingPartyConfidenceTurn", () => ({
  processRulingPartyConfidenceTurn: vi.fn().mockResolvedValue(null),
}));

import {
  processCNBillLifecycle,
  processOnePartyBillLifecycle,
  processOnePartyBillLifecycleForCountry,
} from "./onePartyBillLifecycle";
import { getDb } from "@/lib/mongodb";
import { processRulingPartyConfidenceTurn } from "@/lib/turn/rulingPartyConfidenceTurn";

function mockBills(db: MockDb) {
  return db.collection("bills");
}

/**
 * MockDb's default find() returns an empty cursor. processCNBillLifecycle
 * calls `find(filter).toArray()` twice on bills (the initial query for
 * expired bills + a fresh re-fetch). Wire it to return the given docs
 * for any bill find, leaving non-bill collections to the default empty
 * behavior.
 */
function stubBillFind(db: MockDb, bills: Record<string, unknown>[]) {
  const coll = mockBills(db);
  coll.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(bills),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  });
}

function makeBill(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    title: "Test Bill",
    countryId: "CN",
    originChamber: "npc",
    status: "active",
    votesFor: 5,
    votesAgainst: 3,
    sponsorId: new ObjectId(),
    ...overrides,
  };
}

/**
 * Pre-populate the countryState collection with a one-party CN row so
 * `getCountryState(db, "CN")` resolves to onePartyState. Without this,
 * the new runtime guard in `processOnePartyBillLifecycleForCountry`
 * would throw on every test (Phase-1b migration).
 */
function stubCountryStateOnePartyCN(db: MockDb) {
  db.collection("countryState");
  db.collectionMocks.countryState.findOne.mockResolvedValue({
    _id: "CN",
    countryId: "CN",
    governmentType: "onePartyState",
    rulingPartyId: 1,
    opsVoteMultipliers: null,
    hasLeaderConfidenceModel: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("processCNBillLifecycle", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    stubCountryStateOnePartyCN(db);
  });

  it("enacts a bill that passes", async () => {
    const bill = makeBill({ status: "active", votesFor: 10, votesAgainst: 2 });
    stubBillFind(db, [bill]);

    const result = await processCNBillLifecycle(new Date());
    expect(result.enacted).toBe(1);
    expect(result.failed).toBe(0);
    assertSetFields(mockBills(db).updateOne, { status: "signed" });
  });

  it("marks a bill as failed if it does not pass", async () => {
    const bill = makeBill({ status: "active", votesFor: 2, votesAgainst: 10 });
    stubBillFind(db, [bill]);

    const result = await processCNBillLifecycle(new Date());
    expect(result.enacted).toBe(0);
    expect(result.failed).toBe(1);
    assertSetFields(mockBills(db).updateOne, { status: "failed" });
  });

  it("enacts a tied bill (didPass requires >50%)", async () => {
    const bill = makeBill({ status: "active", votesFor: 5, votesAgainst: 5 });
    stubBillFind(db, [bill]);

    const result = await processCNBillLifecycle(new Date());
    expect(result.enacted).toBe(0);
    expect(result.failed).toBe(1);
    assertSetFields(mockBills(db).updateOne, { status: "failed" });
  });

  it("ignores non-CN bills", async () => {
    // Default MockDb find() returns []; no override needed.
    const result = await processCNBillLifecycle(new Date());
    expect(result.enacted).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("scopes votes to current seat holders — a raw-passing bill fails once a 'for' delegate leaves (#0836)", async () => {
    const forStaying = new ObjectId();
    const forDeparted = new ObjectId();
    const against = new ObjectId();
    const bill = makeBill({
      status: "active",
      currentChamber: "npc",
      votes: {
        [forStaying.toString()]: "for",
        [forDeparted.toString()]: "for",
        [against.toString()]: "against",
      },
      votesFor: 30, // raw aggregate would pass
      votesAgainst: 10,
    });
    stubBillFind(db, [bill]);
    // Post-election NPC: the departed "for" delegate is gone; scoped tally is
    // 10 for / 20 against → fails, unlike the raw aggregate. NPC delegates hold
    // officeType "npcDelegate" (the chamber-key mapping exception).
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          characterId: forStaying,
          nppId: null,
          countryId: "CN",
          officeType: "npcDelegate",
          seatsHeld: 10,
        },
        {
          characterId: against,
          nppId: null,
          countryId: "CN",
          officeType: "npcDelegate",
          seatsHeld: 20,
        },
      ]),
      project: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
    });

    const result = await processCNBillLifecycle(new Date());
    expect(result.enacted).toBe(0);
    expect(result.failed).toBe(1);
    assertSetFields(mockBills(db).updateOne, { status: "failed" });
  });

  it("ignores non-NPC chamber bills in CN", async () => {
    // Default empty find() — the filter has originChamber: "npc", so a cppcc
    // bill would be excluded by the real query anyway.
    const result = await processCNBillLifecycle(new Date());
    expect(result.enacted).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("processes multiple bills independently", async () => {
    const passingBill = makeBill({ status: "active", votesFor: 10, votesAgainst: 1 });
    const failingBill = makeBill({ status: "active", votesFor: 1, votesAgainst: 10 });
    stubBillFind(db, [passingBill, failingBill]);

    const result = await processCNBillLifecycle(new Date());
    expect(result.enacted).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("only processes active bills", async () => {
    // Default empty find() — the filter has status: "active", so a signed bill
    // would be excluded.
    const result = await processCNBillLifecycle(new Date());
    expect(result.enacted).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("invokes CPC confidence drift with this turn's enacted categories and queued purges", async () => {
    const now = new Date();
    const enacted = makeBill({
      status: "active",
      votesFor: 10,
      votesAgainst: 1,
      category: "market-liberalization",
    });
    const failing = makeBill({ status: "active", votesFor: 1, votesAgainst: 10 });
    stubBillFind(db, [enacted, failing]);

    const purge = {
      _id: "purge-1",
      countryId: "CN",
      severity: "minor",
      reason: "test",
      turn: 4,
      processed: false,
      createdAt: now,
    };
    db.collection("rulingPartyPurgeEvents").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([purge]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    await processCNBillLifecycle(now);

    expect(processRulingPartyConfidenceTurn).toHaveBeenCalledTimes(1);
    const [, countryId, currentTurn, policyCategories, purgeEvents] = vi.mocked(
      processRulingPartyConfidenceTurn
    ).mock.calls[0];
    expect(countryId).toBe("CN");
    expect(currentTurn).toBe(5);
    expect(policyCategories).toEqual(["market-liberalization"]);
    expect(purgeEvents).toHaveLength(1);
    expect(purgeEvents?.[0]?._id).toBe("purge-1");
  });
});

describe("runtime governmentType gating (Phase 1b)", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("skips a country whose countryState governmentType is no longer onePartyState", async () => {
    // CN's countryState was flipped to parliamentaryRepublic (post-Stage 4
    // conversion). The per-country lifecycle MUST short-circuit even
    // though COUNTRY_CONFIGS.CN still seeds governmentType: "onePartyState".
    db.collection("countryState");
    db.collectionMocks.countryState.findOne.mockResolvedValue({
      _id: "CN",
      countryId: "CN",
      governmentType: "parliamentaryRepublic",
      rulingPartyId: 1,
      opsVoteMultipliers: null,
      hasLeaderConfidenceModel: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await processOnePartyBillLifecycleForCountry("CN", new Date());

    expect(result).toEqual({ enacted: 0, failed: 0 });
    // Should not even touch bills if gated out
    expect(db.collectionMocks.bills).toBeUndefined();
  });

  it("iterates the countryState collection (not COUNTRY_CONFIGS) for the multi-country path", async () => {
    // No countries are currently one-party in the runtime state.
    db.collection("countryState");
    db.collectionMocks.countryState.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const result = await processOnePartyBillLifecycle(new Date());

    expect(result).toEqual({ enacted: 0, failed: 0 });
    // The countryState filter must explicitly query for onePartyState
    expect(db.collectionMocks.countryState.find).toHaveBeenCalledWith({
      governmentType: "onePartyState",
    });
  });
});
