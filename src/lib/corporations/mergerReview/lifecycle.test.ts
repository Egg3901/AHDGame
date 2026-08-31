import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { MergerReview } from "@/lib/db/types/mergerReview";

vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/nationalization/treasury", () => ({
  creditTreasuryProceedsFromAnchor: vi.fn(),
}));
vi.mock("@/lib/financialTxLog/atomicCashGuard", () => ({
  atomicallyDebitCorpLiquidCapital: vi.fn(),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn() }));
vi.mock("@/lib/currency/corporationCapital", () => ({
  anchorToCorpLiquidCapital: (a: number) => a,
  corpLiquidCapitalToAnchor: (a: number) => a,
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  resolveCorpLiquidCurrencyCode: () => "USD",
}));
vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("off"),
  marketAtLeast: () => false,
}));
vi.mock("../corpMarketShare", () => ({ loadIndustryBasis: vi.fn() }));
vi.mock("./divestiture", () => ({
  controlledGroupIds: vi.fn(),
  settleDivestitureIfSatisfied: vi.fn().mockResolvedValue(false),
}));

import { atomicallyDebitCorpLiquidCapital } from "@/lib/financialTxLog/atomicCashGuard";
import { creditTreasuryProceedsFromAnchor } from "@/lib/nationalization/treasury";
import { loadIndustryBasis } from "../corpMarketShare";
import { controlledGroupIds, settleDivestitureIfSatisfied } from "./divestiture";
import {
  attachMergerRemedy,
  decideMergerReview,
  fineOverdueDivestitures,
  resolveDueMergerReviews,
} from "./lifecycle";
import { MERGER_REMEDY_OVERDUE_FINE_RATE, MERGER_REMEDY_TURNS } from "./constants";

const ACQ = new ObjectId();
const SUB = new ObjectId();

function makeReview(over: Partial<MergerReview> = {}): MergerReview {
  return {
    _id: new ObjectId(),
    acquirerCorporationId: ACQ,
    targetCorporationId: new ObjectId(),
    acquirerName: "AcquireCo",
    targetName: "TargetCo",
    countryId: "US",
    authoritySeatId: "attorney_general",
    lawLevel: 2,
    thresholdPercent: 60,
    leadSectorType: "manufacturing",
    combinedSharePercent: 70,
    overlaps: [],
    trigger: "agreedAcquisition",
    status: "pending",
    openedAtTurn: 100,
    decideByTurn: 106,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as MergerReview;
}

function makeDb(opts: { claimed?: boolean; pending?: MergerReview[]; overdue?: unknown[] } = {}) {
  const reviewUpdate = vi.fn().mockResolvedValue({ matchedCount: opts.claimed === false ? 0 : 1 });
  const corpUpdate = vi.fn().mockResolvedValue({ matchedCount: 1 });
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "mergerReviews")
        return {
          updateOne: reviewUpdate,
          find: () => ({ toArray: () => Promise.resolve(opts.pending ?? []) }),
        };
      if (name === "corporations")
        return {
          updateOne: corpUpdate,
          find: () => ({
            toArray: () => Promise.resolve(opts.overdue ?? []),
            project: () => ({ toArray: () => Promise.resolve([]) }),
          }),
        };
      return {};
    }),
  } as unknown as Db;
  return { db, reviewUpdate, corpUpdate };
}

describe("decideMergerReview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stamps an authority decision and always remedies the industry that tripped", async () => {
    const { db, reviewUpdate } = makeDb();
    const decider = new ObjectId();
    const r = await decideMergerReview(db, {
      review: makeReview({ leadSectorType: "steel" as never }),
      decision: "clearedWithRemedy",
      currentTurn: 104,
      decidedByCharacterId: decider,
    });
    expect(r.ok).toBe(true);
    const set = reviewUpdate.mock.calls[0][1].$set;
    expect(set.status).toBe("clearedWithRemedy");
    expect(set.resolvedBy).toBe("authority");
    expect(set.remedySectorType).toBe("steel");
    expect(set.decidedByCharacterId).toBe(decider);
  });

  it("stamps the deadline path as such and names no decider", async () => {
    const { db, reviewUpdate } = makeDb();
    await decideMergerReview(db, { review: makeReview(), decision: "cleared", currentTurn: 106 });
    const set = reviewUpdate.mock.calls[0][1].$set;
    expect(set.resolvedBy).toBe("deadline");
    expect(set.decidedByCharacterId).toBeUndefined();
  });

  it("attaches no remedy to a plain clearance", async () => {
    const { db, reviewUpdate } = makeDb();
    await decideMergerReview(db, { review: makeReview(), decision: "cleared", currentTurn: 104 });
    expect(reviewUpdate.mock.calls[0][1].$set.remedySectorType).toBeUndefined();
  });

  it("refuses to decide a review that is no longer pending", async () => {
    const { db, reviewUpdate } = makeDb();
    const r = await decideMergerReview(db, {
      review: makeReview({ status: "cleared" }),
      decision: "blocked",
      currentTurn: 104,
    });
    expect(r.ok).toBe(false);
    expect(reviewUpdate).not.toHaveBeenCalled();
  });

  it("loses the race rather than double-deciding when the claim does not match", async () => {
    const { db } = makeDb({ claimed: false });
    const r = await decideMergerReview(db, {
      review: makeReview(),
      decision: "blocked",
      currentTurn: 104,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });
});

describe("resolveDueMergerReviews", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves each due referral on the published bands", async () => {
    const pending = [
      makeReview({ combinedSharePercent: 62 }), // +2  → cleared
      makeReview({ combinedSharePercent: 68 }), // +8  → remedy
      makeReview({ combinedSharePercent: 90 }), // +30 → blocked
    ];
    const { db, reviewUpdate } = makeDb({ pending });
    const r = await resolveDueMergerReviews(db, 110);
    expect(r.resolved).toBe(3);
    const statuses = reviewUpdate.mock.calls.map((c) => c[1].$set.status);
    expect(statuses).toEqual(["cleared", "clearedWithRemedy", "blocked"]);
  });
});

describe("attachMergerRemedy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("binds the obligation to the acquirer with the review's own threshold", async () => {
    const { db, corpUpdate } = makeDb();
    const review = makeReview({
      status: "clearedWithRemedy",
      remedySectorType: "steel" as never,
      thresholdPercent: 50,
    });
    await attachMergerRemedy(db, review, ACQ, 200);
    const obligation = corpUpdate.mock.calls[0][1].$set.pendingDivestiture;
    expect(obligation.sectorType).toBe("steel");
    expect(obligation.dueTurn).toBe(200 + MERGER_REMEDY_TURNS);
    expect(obligation.thresholdPercent).toBe(50);
  });

  it("binds nothing when the clearance carried no condition", async () => {
    const { db, corpUpdate } = makeDb();
    await attachMergerRemedy(db, makeReview({ status: "cleared" }), ACQ, 200);
    expect(corpUpdate).not.toHaveBeenCalled();
  });
});

describe("fineOverdueDivestitures", () => {
  const overdueCorp = {
    _id: ACQ,
    name: "AcquireCo",
    liquidCurrencyCode: "USD",
    pendingDivestiture: {
      reviewId: new ObjectId(),
      sectorType: "steel",
      dueTurn: 199,
      thresholdPercent: 60,
      countryId: "US",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settleDivestitureIfSatisfied).mockResolvedValue(false);
    vi.mocked(atomicallyDebitCorpLiquidCapital).mockResolvedValue({ ok: true, newBalance: 0 });
    vi.mocked(controlledGroupIds).mockResolvedValue(new Set([ACQ.toString(), SUB.toString()]));
    vi.mocked(loadIndustryBasis).mockResolvedValue(
      new Map([
        [
          "steel",
          {
            basisByCorp: new Map(),
            // The group's revenue is split across the parent and a controlled
            // subsidiary; an outsider's revenue must not be counted.
            anchorByCorp: new Map([
              [ACQ.toString(), 400],
              [SUB.toString(), 600],
              [new ObjectId().toString(), 9_000],
            ]),
            basisMarket: 10_000,
          },
        ],
      ]) as never
    );
  });

  it("fines on the whole controlled group's revenue, not just the parent's", async () => {
    const { db } = makeDb({ overdue: [overdueCorp] });
    const r = await fineOverdueDivestitures(db, 200);
    expect(r.fined).toBe(1);
    // (400 + 600) × 5% = 50. The unrelated 9,000 is excluded.
    expect(vi.mocked(atomicallyDebitCorpLiquidCapital)).toHaveBeenCalledWith(
      db,
      ACQ,
      1_000 * MERGER_REMEDY_OVERDUE_FINE_RATE
    );
    // The treasury is credited the ANCHOR amount, so the receiving country
    // converts into its own currency rather than banking the payer's local
    // figure verbatim (#808).
    expect(vi.mocked(creditTreasuryProceedsFromAnchor)).toHaveBeenCalledWith(
      db,
      "US",
      50,
      expect.any(Date)
    );
  });

  it("discharges instead of fining when the group has already sold down", async () => {
    vi.mocked(settleDivestitureIfSatisfied).mockResolvedValue(true);
    const { db } = makeDb({ overdue: [overdueCorp] });
    const r = await fineOverdueDivestitures(db, 200);
    expect(r.fined).toBe(0);
    expect(vi.mocked(atomicallyDebitCorpLiquidCapital)).not.toHaveBeenCalled();
  });

  it("leaves the order standing when the corp cannot pay, rather than waiving it", async () => {
    vi.mocked(atomicallyDebitCorpLiquidCapital).mockResolvedValue({
      ok: false,
      error: "Insufficient corporate funds",
    } as never);
    const { db, corpUpdate } = makeDb({ overdue: [overdueCorp] });
    const r = await fineOverdueDivestitures(db, 200);
    expect(r.fined).toBe(0);
    expect(vi.mocked(creditTreasuryProceedsFromAnchor)).not.toHaveBeenCalled();
    // No $unset of the obligation — it is retried next turn.
    expect(corpUpdate).not.toHaveBeenCalled();
  });
});
