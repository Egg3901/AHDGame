import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

// Germany now runs through the unified engine (configs/de.ts). These tests are
// the characterization guard: the intended rules (single-chamber Bundestag pass →
// immediate enact, notification outcome) are preserved, and the one intended
// delta — votes scoped to current seat holders — is asserted.

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));

const NOW = new Date("2026-04-21T12:00:00Z");

function makeBundestagBill(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    countryId: "DE",
    title: "Bundestag Bill",
    originChamber: "bundestag",
    currentChamber: "bundestag",
    status: "active",
    votesFor: 210,
    votesAgainst: 120,
    votesAbstain: 0,
    votes: {},
    votingEndsOnTurn: 5,
    votingEndsAt: new Date(NOW.getTime() - 1000),
    sponsorId: new ObjectId(),
    coSponsors: [],
    ...overrides,
  };
}

const cursor = (rows: unknown[]) => ({
  toArray: vi.fn().mockResolvedValue(rows),
  project: vi.fn().mockReturnThis(),
  sort: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  skip: vi.fn().mockReturnThis(),
});

describe("DE bill lifecycle via unified engine (characterization)", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("bills");
    db.collection("characters");
    db.collection("electedOfficials");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as never);
  });

  function wireExpiredBills(bills: { _id: ObjectId; status: string }[]) {
    db.collectionMocks["bills"]!.find.mockImplementation((filter: Record<string, unknown>) =>
      cursor(filter.status === "active" ? bills : [])
    );
    db.collectionMocks["bills"]!.findOne.mockImplementation((filter: { _id: ObjectId }) =>
      Promise.resolve(bills.find((b) => b._id.equals(filter._id)) ?? null)
    );
  }

  async function run() {
    const { runBillLifecycleForCountry } = await import("@/lib/turn/billLifecycle/dispatch");
    const { DE_NATIONAL_CONFIG } = await import("@/lib/turn/billLifecycle/configs/de");
    return runBillLifecycleForCountry(DE_NATIONAL_CONFIG, NOW);
  }

  function setPatchFor(billId: ObjectId) {
    const call = db.collectionMocks["bills"]!.updateOne.mock.calls.find((c) =>
      (c[0] as { _id: ObjectId })._id.equals(billId)
    );
    return (call?.[1] as { $set?: Record<string, unknown> })?.$set;
  }

  it("enacts Bundestag bills that pass", async () => {
    const bill = makeBundestagBill();
    wireExpiredBills([bill]);

    const result = await run();

    expect(result.enacted).toBe(1);
    expect(result.failed).toBe(0);
    const patch = setPatchFor(bill._id);
    expect(patch?.status).toBe("signed");
    expect(patch?.enactedAt).toEqual(NOW);
  });

  it("fails Bundestag bills that do not pass", async () => {
    const bill = makeBundestagBill({ votesFor: 140, votesAgainst: 180 });
    wireExpiredBills([bill]);

    const result = await run();

    expect(result.enacted).toBe(0);
    expect(result.failed).toBe(1);
    const patch = setPatchFor(bill._id);
    expect(patch?.status).toBe("failed");
    expect(patch?.failedAt).toEqual(NOW);
  });

  it("scopes votes to current seat holders — a raw-passing bill fails once a 'for' voter leaves (#0836)", async () => {
    const forStaying = new ObjectId();
    const forDeparted = new ObjectId();
    const against = new ObjectId();
    const bill = makeBundestagBill({
      votes: {
        [forStaying.toString()]: "for",
        [forDeparted.toString()]: "for",
        [against.toString()]: "against",
      },
      votesFor: 300, // raw would pass
      votesAgainst: 120,
    });
    wireExpiredBills([bill]);
    // Post-election chamber: the departed "for" voter is gone; scoped tally is
    // 100 for / 200 against → fails, unlike the raw aggregate.
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      cursor([
        {
          characterId: forStaying,
          nppId: null,
          countryId: "DE",
          officeType: "bundestag",
          seatsHeld: 100,
        },
        {
          characterId: against,
          nppId: null,
          countryId: "DE",
          officeType: "bundestag",
          seatsHeld: 200,
        },
      ])
    );

    const result = await run();

    expect(result.failed).toBe(1);
    expect(setPatchFor(bill._id)?.status).toBe("failed");
  });
});
