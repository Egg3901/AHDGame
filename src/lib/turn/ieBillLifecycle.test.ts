import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

// Ireland now runs through the unified engine (configs/ie.ts). These tests are
// the characterization guard: the intended rules (single-chamber Dáil pass →
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

const NOW = new Date("2026-05-28T12:00:00Z");

function makeDailBill(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    countryId: "IE",
    title: "Dáil Bill",
    originChamber: "dail",
    currentChamber: "dail",
    status: "active",
    votesFor: 90,
    votesAgainst: 60,
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

describe("IE bill lifecycle via unified engine (characterization)", () => {
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
    const { IE_NATIONAL_CONFIG } = await import("@/lib/turn/billLifecycle/configs/ie");
    return runBillLifecycleForCountry(IE_NATIONAL_CONFIG, NOW);
  }

  function setPatchFor(billId: ObjectId) {
    const call = db.collectionMocks["bills"]!.updateOne.mock.calls.find((c) =>
      (c[0] as { _id: ObjectId })._id.equals(billId)
    );
    return (call?.[1] as { $set?: Record<string, unknown> })?.$set;
  }

  it("enacts Dáil bills that pass", async () => {
    const bill = makeDailBill();
    wireExpiredBills([bill]);

    const result = await run();

    expect(result.enacted).toBe(1);
    expect(result.failed).toBe(0);
    const patch = setPatchFor(bill._id);
    expect(patch?.status).toBe("signed");
    expect(patch?.enactedAt).toEqual(NOW);
  });

  it("fails Dáil bills that do not pass", async () => {
    const bill = makeDailBill({ votesFor: 40, votesAgainst: 100 });
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
    const bill = makeDailBill({
      votes: {
        [forStaying.toString()]: "for",
        [forDeparted.toString()]: "for",
        [against.toString()]: "against",
      },
      votesFor: 90, // raw would pass
      votesAgainst: 60,
    });
    wireExpiredBills([bill]);
    // Post-election chamber: the departed "for" voter is gone; scoped tally is
    // 10 for / 20 against → fails, unlike the raw aggregate.
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      cursor([
        {
          characterId: forStaying,
          nppId: null,
          countryId: "IE",
          officeType: "dail",
          seatsHeld: 10,
        },
        { characterId: against, nppId: null, countryId: "IE", officeType: "dail", seatsHeld: 20 },
      ])
    );

    const result = await run();

    expect(result.failed).toBe(1);
    expect(setPatchFor(bill._id)?.status).toBe("failed");
  });
});
