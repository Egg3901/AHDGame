/**
 * JP Diet lifecycle now runs through the unified engine (configs/jp.ts). These
 * tests are the characterization guard: the Diet state machine (Shūgiin → Sangiin
 * → override_shugiin, cabinet review) and the four counters
 * {enacted, failed, overrides, cabinetPassed} are preserved; the intended delta —
 * votes scoped to current seat holders — is asserted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
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
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));

const NOW = new Date("2026-04-17T12:00:00Z");

function makeSangiinOriginBill(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    countryId: "JP",
    title: "Sangiin Bill",
    originChamber: "sangiin",
    currentChamber: "sangiin",
    status: "active_other",
    votesFor: 0,
    votesAgainst: 0,
    votes: {},
    otherChamberVotes: {},
    otherChamberVotesFor: 40,
    otherChamberVotesAgainst: 100, // Shugiin rejects
    otherChamberVotingEndsOnTurn: 5,
    otherChamberVotingEndsAt: new Date(NOW.getTime() - 1000),
    sponsorId: new ObjectId(),
    coSponsors: [],
    ...overrides,
  };
}

function makeShugiinOriginBill(overrides: Record<string, unknown> = {}) {
  return makeSangiinOriginBill({
    title: "Shugiin Bill",
    originChamber: "shugiin",
    otherChamberVotesFor: 80,
    otherChamberVotesAgainst: 130, // Sangiin rejects
    ...overrides,
  });
}

function makeCabinetReviewBill(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    countryId: "JP",
    title: "Cabinet Bill",
    originChamber: "cabinet",
    currentChamber: "shugiin",
    status: "cabinet_review",
    votes: {},
    votesFor: 2,
    votesAgainst: 1,
    votesAbstain: 0,
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

describe("JP Diet lifecycle via unified engine (characterization)", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("bills");
    db.collection("characters");
    db.collection("electedOfficials");
    db.collection("billWhips");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as never);
  });

  function wireBillFind(byStatus: Record<string, { _id: ObjectId }[]>) {
    db.collectionMocks["bills"]!.find.mockImplementation((filter: Record<string, unknown>) =>
      cursor(byStatus[(filter.status as string) ?? ""] ?? [])
    );
    db.collectionMocks["bills"]!.findOne.mockImplementation((filter: { _id: ObjectId }) => {
      for (const docs of Object.values(byStatus)) {
        const found = docs.find((d) => d._id.equals(filter._id));
        if (found) return Promise.resolve(found);
      }
      return Promise.resolve(null);
    });
  }

  async function run() {
    const { runBillLifecycleForJP } = await import("@/lib/turn/billLifecycle/dispatch");
    return runBillLifecycleForJP(NOW);
  }

  function setPatchFor(billId: ObjectId) {
    const call = db.collectionMocks["bills"]!.updateOne.mock.calls.find((c) =>
      (c[0] as { _id: ObjectId })._id.equals(billId)
    );
    return (call?.[1] as { $set?: Record<string, unknown> })?.$set;
  }

  it("Sangiin-origin bill rejected by Shugiin goes to failed, NOT override_shugiin", async () => {
    const bill = makeSangiinOriginBill();
    wireBillFind({ active_other: [bill] });

    const result = await run();

    expect(result.failed).toBe(1);
    expect(result.overrides).toBe(0);
    expect(setPatchFor(bill._id)?.status).toBe("failed");
  });

  it("Shugiin-origin bill rejected by Sangiin goes to override_shugiin", async () => {
    const bill = makeShugiinOriginBill();
    wireBillFind({ active_other: [bill] });

    const result = await run();

    expect(result.overrides).toBe(1);
    expect(result.failed).toBe(0);
    const set = setPatchFor(bill._id);
    expect(set?.status).toBe("override_shugiin");
    expect(set?.currentChamber).toBe("shugiin");
  });

  it("Cabinet-origin bill rejected by Sangiin goes to override_shugiin", async () => {
    const bill = makeShugiinOriginBill({ originChamber: "cabinet" });
    wireBillFind({ active_other: [bill] });

    const result = await run();

    expect(result.overrides).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("Sangiin-origin bill passed by Shugiin enacts as signed", async () => {
    const bill = makeSangiinOriginBill({ otherChamberVotesFor: 200, otherChamberVotesAgainst: 50 });
    wireBillFind({ active_other: [bill] });

    const result = await run();

    expect(result.enacted).toBe(1);
    expect(setPatchFor(bill._id)?.status).toBe("signed");
  });

  it("cabinet review passes on a simple majority of votes cast", async () => {
    const bill = makeCabinetReviewBill({ votesFor: 2, votesAgainst: 1, votesAbstain: 7 });
    wireBillFind({ cabinet_review: [bill] });

    const result = await run();

    expect(result.cabinetPassed).toBe(1);
    const set = setPatchFor(bill._id);
    expect(set?.status).toBe("active");
    expect(set?.currentChamber).toBe("shugiin");
  });

  it("cabinet review fails on a tie", async () => {
    const bill = makeCabinetReviewBill({ votesFor: 1, votesAgainst: 1 });
    wireBillFind({ cabinet_review: [bill] });

    const result = await run();

    expect(result.cabinetPassed).toBe(0);
    expect(result.failed).toBe(1);
    expect(setPatchFor(bill._id)?.status).toBe("failed");
  });

  it("scopes Sangiin votes — a raw-passing Shūgiin-origin bill is overridden once a 'for' councillor leaves (#0836)", async () => {
    const forStaying = new ObjectId();
    const forDeparted = new ObjectId();
    const against = new ObjectId();
    const bill = makeShugiinOriginBill({
      otherChamberVotes: {
        [forStaying.toString()]: "for",
        [forDeparted.toString()]: "for",
        [against.toString()]: "against",
      },
      otherChamberVotesFor: 200, // raw aggregate would pass the Sangiin
      otherChamberVotesAgainst: 50,
    });
    wireBillFind({ active_other: [bill] });
    // Post-election Sangiin: the departed "for" councillor is gone → scoped 10/20
    // → Sangiin rejects → Shūgiin (origin) gets a 2/3 override.
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      cursor([
        {
          characterId: forStaying,
          nppId: null,
          countryId: "JP",
          officeType: "sangiin",
          seatsHeld: 10,
        },
        {
          characterId: against,
          nppId: null,
          countryId: "JP",
          officeType: "sangiin",
          seatsHeld: 20,
        },
      ])
    );

    const result = await run();

    expect(result.overrides).toBe(1);
    expect(result.enacted).toBe(0);
    expect(setPatchFor(bill._id)?.status).toBe("override_shugiin");
  });
});
