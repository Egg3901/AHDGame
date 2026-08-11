import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { runBillLifecycle } from "./engine";
import { US_NATIONAL_CONFIG } from "./configs/us";
import type { BillLifecycleConfig } from "./types";

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

const NOW = new Date("2025-06-15T12:00:00Z");

const cursor = (rows: unknown[]) => ({
  toArray: vi.fn().mockResolvedValue(rows),
  project: vi.fn().mockReturnThis(),
  sort: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  skip: vi.fn().mockReturnThis(),
});

/** find() returns `docs` only when the query's `status` matches `whenStatus`. */
function findByStatus(map: Record<string, unknown[]>) {
  return (q: { status?: string }) => cursor(map[q?.status ?? ""] ?? []);
}

describe("runBillLifecycle — chamberVote stages (US)", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("bills");
    db.collection("electedOfficials");
    db.collection("characters");
  });

  function officials(rows: unknown[]) {
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(cursor(rows));
  }
  function lastBillSet() {
    const calls = db.collectionMocks["bills"]!.updateOne.mock.calls;
    return (calls[calls.length - 1]?.[1] as { $set?: Record<string, unknown> })?.$set ?? {};
  }

  it("advances a winning origin (house) bill to the second chamber with a snapshot", async () => {
    const forId = new ObjectId();
    const againstId = new ObjectId();
    const bill = {
      _id: new ObjectId(),
      countryId: "US",
      status: "active",
      originChamber: "house",
      currentChamber: "house",
      votingEndsOnTurn: 5,
      votes: { [forId.toString()]: "for", [againstId.toString()]: "against" },
      votesFor: 10,
      votesAgainst: 3,
      votesAbstain: 0,
      sponsorId: new ObjectId(),
      coSponsors: [],
    };
    db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ active: [bill] }));
    db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
    officials([
      { characterId: forId, nppId: null, countryId: "US", officeType: "house", seatsHeld: 10 },
      { characterId: againstId, nppId: null, countryId: "US", officeType: "house", seatsHeld: 3 },
    ]);

    await runBillLifecycle(db as unknown as Db, US_NATIONAL_CONFIG, NOW, 10);

    const set = lastBillSet();
    expect(set.status).toBe("active_other");
    expect(set.currentChamber).toBe("senate");
    expect(set.votesFor).toBe(10);
    expect(set.voteSnapshot).toBeDefined();
    expect(set.otherChamberVotes).toEqual({});
  });

  it("fails a losing origin bill with a snapshot", async () => {
    const againstId = new ObjectId();
    const bill = {
      _id: new ObjectId(),
      countryId: "US",
      status: "active",
      originChamber: "house",
      currentChamber: "house",
      votingEndsOnTurn: 5,
      votes: { [againstId.toString()]: "against" },
      votesFor: 0,
      votesAgainst: 5,
      votesAbstain: 0,
      sponsorId: new ObjectId(),
      coSponsors: [],
    };
    db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ active: [bill] }));
    db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
    officials([
      { characterId: againstId, nppId: null, countryId: "US", officeType: "house", seatsHeld: 5 },
    ]);

    const res = await runBillLifecycle(db as unknown as Db, US_NATIONAL_CONFIG, NOW, 10);

    const set = lastBillSet();
    expect(set.status).toBe("failed");
    expect(set.voteSnapshot).toBeDefined();
    expect(res.billsFailed).toBe(1);
  });

  it("sends a winning joint bill straight to the President, skipping the second chamber", async () => {
    const forId = new ObjectId();
    const bill = {
      _id: new ObjectId(),
      countryId: "US",
      status: "active",
      originChamber: "joint",
      currentChamber: "joint",
      votingEndsOnTurn: 5,
      votes: { [forId.toString()]: "for" },
      votesFor: 8,
      votesAgainst: 1,
      votesAbstain: 0,
      sponsorId: new ObjectId(),
      coSponsors: [],
    };
    db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ active: [bill] }));
    db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
    officials([
      { characterId: forId, nppId: null, countryId: "US", officeType: "house", seatsHeld: 8 },
    ]);

    await runBillLifecycle(db as unknown as Db, US_NATIONAL_CONFIG, NOW, 10);

    const set = lastBillSet();
    expect(set.status).toBe("enrolled");
    expect(set.voteSnapshot).toBeDefined();
    expect(set.presidentActionDeadline).toBeInstanceOf(Date);
  });

  it("sends a winning second-chamber bill to the President (enrolled)", async () => {
    const forId = new ObjectId();
    const bill = {
      _id: new ObjectId(),
      countryId: "US",
      status: "active_other",
      originChamber: "house",
      currentChamber: "senate",
      otherChamberVotingEndsOnTurn: 5,
      otherChamberVotes: { [forId.toString()]: "for" },
      otherChamberVotesFor: 9,
      otherChamberVotesAgainst: 0,
      otherChamberVotesAbstain: 0,
      votesFor: 10,
      votesAgainst: 3,
      votesAbstain: 0,
      votes: {},
      sponsorId: new ObjectId(),
      coSponsors: [],
    };
    db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ active_other: [bill] }));
    db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
    officials([
      { characterId: forId, nppId: null, countryId: "US", officeType: "senate", seatsHeld: 9 },
    ]);

    await runBillLifecycle(db as unknown as Db, US_NATIONAL_CONFIG, NOW, 10);

    const set = lastBillSet();
    expect(set.status).toBe("enrolled");
    expect(set.otherChamberVoteSnapshot).toBeDefined();
    expect(set.presidentActionDeadline).toBeInstanceOf(Date);
  });

  it("fails a veto override below 2/3 of seats and freezes the display snapshot", async () => {
    const houseFor = new ObjectId();
    const houseAgainst = new ObjectId();
    const senateFor = new ObjectId();
    const bill = {
      _id: new ObjectId(),
      countryId: "US",
      status: "veto_override",
      originChamber: "house",
      currentChamber: "house",
      overrideVotingEndsOnTurn: 5,
      vetoOverrideVotes: {
        [`npp_${houseFor.toString()}`]: "for",
        [`npp_${houseAgainst.toString()}`]: "against",
        [`npp_${senateFor.toString()}`]: "for",
      },
      sponsorId: new ObjectId(),
      coSponsors: [],
    };
    db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ veto_override: [bill] }));
    // House: 18 for / 12 against of 30 seats (18 < 20 threshold → fails). Senate clears.
    officials([
      { nppId: houseFor, characterId: null, countryId: "US", officeType: "house", seatsHeld: 18 },
      {
        nppId: houseAgainst,
        characterId: null,
        countryId: "US",
        officeType: "house",
        seatsHeld: 12,
      },
      { nppId: senateFor, characterId: null, countryId: "US", officeType: "senate", seatsHeld: 3 },
    ]);

    const res = await runBillLifecycle(db as unknown as Db, US_NATIONAL_CONFIG, NOW, 10);

    const set = lastBillSet() as {
      status?: string;
      overrideDisplaySnapshot?: { house: { for: number; seats: number } };
    };
    expect(set.status).toBe("override_failed");
    expect(set.overrideDisplaySnapshot?.house).toEqual({ for: 18, against: 12, seats: 30 });
    expect(res.billsFailed).toBe(1);
  });

  it("pocket-signs an enrolled bill whose presidential window expired", async () => {
    const bill = {
      _id: new ObjectId(),
      countryId: "US",
      status: "enrolled",
      originChamber: "house",
      currentChamber: "senate",
      presidentActionDeadlineOnTurn: 5,
      sponsorId: new ObjectId(),
      coSponsors: [],
    };
    db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ enrolled: [bill] }));

    const res = await runBillLifecycle(db as unknown as Db, US_NATIONAL_CONFIG, NOW, 10);

    const set = lastBillSet();
    expect(set.status).toBe("signed");
    expect(set.presidentAction).toBe("unsigned_law");
    expect(set.enactedAt).toEqual(NOW);
    expect(res.billsPassed).toBe(1);
  });
});

describe("runBillLifecycle — single-chamber terminal enact (UK-shaped)", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("bills");
    db.collection("electedOfficials");
    db.collection("characters");
  });
  function lastBillSet() {
    const calls = db.collectionMocks["bills"]!.updateOne.mock.calls;
    return (calls[calls.length - 1]?.[1] as { $set?: Record<string, unknown> })?.$set ?? {};
  }

  const SINGLE_CHAMBER_CONFIG: BillLifecycleConfig = {
    country: "UK",
    level: "national",
    originChambers: ["commons", "lords"],
    stages: [
      {
        kind: "chamberVote",
        status: "active",
        voteField: "votes",
        officeTypeFor: () => "commons",
        passRule: "simpleMajority",
        onReject: "fail",
        onPassStatus: "signed", // terminal — no next stage → enact directly
        votingDurationHours: 24,
      },
    ],
  };

  it("enacts a winning single-chamber bill directly (Royal Assent)", async () => {
    const forId = new ObjectId();
    const bill = {
      _id: new ObjectId(),
      countryId: "UK",
      status: "active",
      originChamber: "commons",
      currentChamber: "commons",
      votingEndsOnTurn: 5,
      votes: { [forId.toString()]: "for" },
      votesFor: 9,
      votesAgainst: 1,
      votesAbstain: 0,
      category: "market-liberalization",
      sponsorId: new ObjectId(),
      coSponsors: [],
    };
    db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ active: [bill] }));
    db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      cursor([
        { characterId: forId, nppId: null, countryId: "UK", officeType: "commons", seatsHeld: 9 },
      ])
    );

    const res = await runBillLifecycle(db as unknown as Db, SINGLE_CHAMBER_CONFIG, NOW, 10);

    const set = lastBillSet();
    expect(set.status).toBe("signed");
    expect(set.enactedAt).toEqual(NOW);
    expect(set.voteSnapshot).toBeDefined();
    expect(res.billsPassed).toBe(1);
    // Enacted categories are surfaced for the one-party regime drifts (#Phase5).
    expect(res.enactedCategories).toEqual(["market-liberalization"]);
    // Transitions-by-target-status let bespoke dispatchers (JP) derive counters.
    expect(res.transitionedTo.signed).toBe(1);
  });

  it("fails a losing single-chamber bill", async () => {
    const againstId = new ObjectId();
    const bill = {
      _id: new ObjectId(),
      countryId: "UK",
      status: "active",
      originChamber: "commons",
      currentChamber: "commons",
      votingEndsOnTurn: 5,
      votes: { [againstId.toString()]: "against" },
      votesFor: 0,
      votesAgainst: 5,
      votesAbstain: 0,
      sponsorId: new ObjectId(),
      coSponsors: [],
    };
    db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ active: [bill] }));
    db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      cursor([
        {
          characterId: againstId,
          nppId: null,
          countryId: "UK",
          officeType: "commons",
          seatsHeld: 5,
        },
      ])
    );

    const res = await runBillLifecycle(db as unknown as Db, SINGLE_CHAMBER_CONFIG, NOW, 10);

    expect(lastBillSet().status).toBe("failed");
    expect(res.billsFailed).toBe(1);
  });
});

describe("runBillLifecycle — config behaviors (Phase-A, gov-pending, notifier)", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("bills");
    db.collection("electedOfficials");
    db.collection("governmentFormations");
  });

  const base: BillLifecycleConfig = {
    country: "UK",
    level: "national",
    originChambers: ["commons", "lords"],
    stages: [
      {
        kind: "chamberVote",
        status: "active",
        voteField: "votes",
        officeTypeFor: () => "commons",
        passRule: "simpleMajority",
        onReject: "fail",
        onPassStatus: "signed",
        votingDurationHours: 24,
      },
    ],
  };

  it("does NOT activate proposed bills when activateProposed is unset", async () => {
    const proposed = {
      _id: new ObjectId(),
      countryId: "UK",
      status: "proposed",
      originChamber: "commons",
    };
    db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ proposed: [proposed] }));

    await runBillLifecycle(db as unknown as Db, base, NOW, 10);

    // No update transitioning the proposed bill to active.
    const activated = db.collectionMocks["bills"]!.updateOne.mock.calls.some(
      (c) => (c[1] as { $set?: { status?: string } })?.$set?.status === "active"
    );
    expect(activated).toBe(false);
  });

  it("skips the whole phase when skipWhenGovPending and gov is pending", async () => {
    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue({ status: "pending" });
    const bill = {
      _id: new ObjectId(),
      countryId: "UK",
      status: "active",
      originChamber: "commons",
      currentChamber: "commons",
      votingEndsOnTurn: 5,
      votes: {},
      votesFor: 9,
      votesAgainst: 0,
      votesAbstain: 0,
    };
    db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ active: [bill] }));

    const res = await runBillLifecycle(
      db as unknown as Db,
      { ...base, skipWhenGovPending: true },
      NOW,
      10
    );

    expect(db.collectionMocks["bills"]!.updateOne).not.toHaveBeenCalled();
    expect(res.billsProcessed).toBe(0);
  });

  it("invokes a config notifySponsor override instead of the default", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const forId = new ObjectId();
    const bill = {
      _id: new ObjectId(),
      countryId: "UK",
      status: "active",
      originChamber: "commons",
      currentChamber: "commons",
      votingEndsOnTurn: 5,
      votes: { [forId.toString()]: "for" },
      votesFor: 9,
      votesAgainst: 0,
      votesAbstain: 0,
      sponsorId: new ObjectId(),
      coSponsors: [],
    };
    db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ active: [bill] }));
    db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { characterId: forId, nppId: null, countryId: "UK", officeType: "commons", seatsHeld: 9 },
        ]),
      project: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
    });

    await runBillLifecycle(db as unknown as Db, { ...base, notifySponsor: notify }, NOW, 10);

    expect(notify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ _id: bill._id }),
      "signed"
    );
  });
});

describe("runBillLifecycle — chamber re-entry (cabinet→active shape)", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("bills");
    db.collection("electedOfficials");
  });
  function lastBillSet() {
    const calls = db.collectionMocks["bills"]!.updateOne.mock.calls;
    return (calls[calls.length - 1]?.[1] as { $set?: Record<string, unknown> })?.$set ?? {};
  }

  const REENTRY_CONFIG: BillLifecycleConfig = {
    country: "JP",
    level: "national",
    originChambers: ["cabinet", "shugiin", "sangiin"],
    stages: [
      {
        kind: "chamberVote",
        status: "cabinet_review",
        voteField: "votes",
        officeTypeFor: () => "cabinet",
        passRule: "simpleMajority",
        onReject: "fail",
        onPassStatus: "active",
        votingDurationHours: 24,
      },
      {
        kind: "chamberVote",
        status: "active",
        voteField: "votes",
        officeTypeFor: () => "shugiin",
        passRule: "simpleMajority",
        onReject: "fail",
        onPassStatus: "active_other",
        votingDurationHours: 24,
        chamberOnEnter: () => "shugiin",
      },
      {
        kind: "chamberVote",
        status: "active_other",
        voteField: "otherChamberVotes",
        officeTypeFor: () => "sangiin",
        passRule: "simpleMajority",
        onReject: "fail",
        onPassStatus: "signed",
        votingDurationHours: 24,
        chamberOnEnter: () => "sangiin",
      },
    ],
  };

  it("re-enters the 'active' vote (resets votes + window, sets currentChamber) on cabinet pass", async () => {
    const bill = {
      _id: new ObjectId(),
      countryId: "JP",
      status: "cabinet_review",
      originChamber: "cabinet",
      currentChamber: "cabinet",
      votingEndsOnTurn: 5,
      votes: {},
      votesFor: 2,
      votesAgainst: 1,
      votesAbstain: 0,
      sponsorId: new ObjectId(),
      coSponsors: [],
    };
    db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ cabinet_review: [bill] }));
    db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);

    const res = await runBillLifecycle(db as unknown as Db, REENTRY_CONFIG, NOW, 10);

    const set = lastBillSet();
    expect(set.status).toBe("active");
    expect(set.currentChamber).toBe("shugiin");
    expect(set.votes).toEqual({}); // fresh Shūgiin vote
    expect(set.votesFor).toBe(0);
    expect(set.votingEndsOnTurn).toBe(34); // 10 + 24
    expect(res.transitionedTo.active).toBe(1);
  });
});

describe("runBillLifecycle — conditional onReject + onEnter hook (JP-shaped)", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("bills");
    db.collection("electedOfficials");
    db.collection("billWhips");
  });
  function lastBillSet() {
    const calls = db.collectionMocks["bills"]!.updateOne.mock.calls;
    return (calls[calls.length - 1]?.[1] as { $set?: Record<string, unknown> })?.$set ?? {};
  }

  const CONDITIONAL_CONFIG: BillLifecycleConfig = {
    country: "JP",
    level: "national",
    originChambers: ["shugiin", "sangiin"],
    stages: [
      {
        kind: "chamberVote",
        status: "active_other",
        voteField: "otherChamberVotes",
        officeTypeFor: () => "sangiin",
        passRule: "simpleMajority",
        onReject: "fail",
        onRejectFn: (b) =>
          b.originChamber === "sangiin" ? "fail" : { toStatus: "override_shugiin" },
        onPassStatus: "signed",
        votingDurationHours: 24,
        chamberOnEnter: () => "sangiin",
      },
      {
        kind: "chamberVote",
        status: "override_shugiin",
        voteField: "votes",
        officeTypeFor: () => "shugiin",
        passRule: "twoThirdsCast",
        onReject: "fail",
        onPassStatus: "signed",
        votingDurationHours: 24,
        chamberOnEnter: () => "shugiin",
        clearWhippedFrom: true,
        onEnterHook: async (d, bill) => {
          await d
            .collection("billWhips")
            .deleteMany({ targetId: (bill as { _id: unknown })._id, chamber: "shugiin" });
        },
      },
    ],
  };

  function rejectedBill(originChamber: string) {
    return {
      _id: new ObjectId(),
      countryId: "JP",
      status: "active_other",
      originChamber,
      currentChamber: "sangiin",
      otherChamberVotingEndsOnTurn: 5,
      otherChamberVotes: {},
      otherChamberVotesFor: 40,
      otherChamberVotesAgainst: 100, // rejected
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      sponsorId: new ObjectId(),
      coSponsors: [],
    };
  }

  it("routes a Sangiin-origin rejected bill to failed", async () => {
    const bill = rejectedBill("sangiin");
    db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ active_other: [bill] }));
    db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);

    const res = await runBillLifecycle(db as unknown as Db, CONDITIONAL_CONFIG, NOW, 10);

    expect(lastBillSet().status).toBe("failed");
    expect(res.transitionedTo.override_shugiin ?? 0).toBe(0);
  });

  it("routes a Shugiin-origin rejected bill to override_shugiin (reset votes, whip cleanup)", async () => {
    const bill = rejectedBill("shugiin");
    db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ active_other: [bill] }));
    db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);

    const res = await runBillLifecycle(db as unknown as Db, CONDITIONAL_CONFIG, NOW, 10);

    const set = lastBillSet();
    expect(set.status).toBe("override_shugiin");
    expect(set.currentChamber).toBe("shugiin");
    expect(set.votes).toEqual({}); // fresh override vote
    expect(res.transitionedTo.override_shugiin).toBe(1);
    expect(db.collectionMocks["billWhips"]!.deleteMany).toHaveBeenCalled();
  });
});

describe("runBillLifecycle — a war declaration needs two-thirds", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("bills");
    db.collection("electedOfficials");
    db.collection("characters");
  });

  function officials(rows: unknown[]) {
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(cursor(rows));
  }
  function lastBillSet() {
    const calls = db.collectionMocks["bills"]!.updateOne.mock.calls;
    return (calls[calls.length - 1]?.[1] as { $set?: Record<string, unknown> })?.$set ?? {};
  }

  /** A house-stage war declaration with the given tally. */
  function warBill(votesFor: number, votesAgainst: number) {
    return {
      _id: new ObjectId(),
      countryId: "US",
      status: "active",
      originChamber: "house",
      currentChamber: "house",
      votingEndsOnTurn: 5,
      votes: {},
      votesFor,
      votesAgainst,
      votesAbstain: 0,
      sponsorId: new ObjectId(),
      coSponsors: [],
      provisions: [{ type: "declare_war", targetCountry: "CN", warGoal: "punitive" }],
    };
  }

  it("fails a war declaration that only has a simple majority", async () => {
    // 10-3 clears a majority and would pass any ordinary bill, but is short of
    // two-thirds of the 13 votes cast. This is the path that actually decides
    // passage — getBillPassRule alone being right is not enough.
    const bill = warBill(8, 5);
    db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ active: [bill] }));
    db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
    officials([]);

    await runBillLifecycle(db as unknown as Db, US_NATIONAL_CONFIG, NOW, 10);

    expect(lastBillSet().status).toBe("failed");
  });

  it("passes a war declaration that clears two-thirds", async () => {
    const bill = warBill(10, 3);
    db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ active: [bill] }));
    db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
    officials([]);

    await runBillLifecycle(db as unknown as Db, US_NATIONAL_CONFIG, NOW, 10);

    expect(lastBillSet().status).toBe("active_other");
  });

  it("still passes an ordinary bill on a simple majority", async () => {
    const bill = { ...warBill(8, 5), provisions: [] };
    db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ active: [bill] }));
    db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
    officials([]);

    await runBillLifecycle(db as unknown as Db, US_NATIONAL_CONFIG, NOW, 10);

    expect(lastBillSet().status).toBe("active_other");
  });
});
