import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { IndexFund } from "@/lib/db/types";
import {
  NPP_ARCHETYPE_TARGET_FUND_SHARE,
  NPP_FUND_REDEMPTION_MAX_FRACTION_PER_TURN,
  nppTargetFundShare,
  planNppFundRedemptions,
  processNppFundRedemptions,
} from "./nppRedemption";

const FUND_ID = new ObjectId();
const NPP_ID = new ObjectId();

function fund(id: ObjectId = FUND_ID): IndexFund {
  return {
    _id: id,
    slug: "test-fund",
    name: "Test Fund",
    tickerSymbol: "TF",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 1_000_000,
    reserveUnits: 0,
    cashAnchor: 0,
    targetConstituents: [],
    holdings: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("planNppFundRedemptions — pure rules", () => {
  it("returns nothing when the NPP holds no positions", () => {
    expect(
      planNppFundRedemptions({ archetype: "conservative", cashAnchor: 0, positions: [] })
    ).toEqual([]);
  });

  it("returns nothing when the fund share is at or below the archetype target", () => {
    // conservative target 0.55; realized share 1000/(1000+1000) = 0.5 < 0.55.
    const plan = planNppFundRedemptions({
      archetype: "conservative",
      cashAnchor: 1000,
      positions: [{ fundId: FUND_ID, units: 10, quotedNav: 100 }],
    });
    expect(plan).toEqual([]);
  });

  it("caps a single position at the per-turn fraction", () => {
    // 20 units, 10% fraction cap => at most 2 units this turn even though the
    // overweight value is far larger.
    const plan = planNppFundRedemptions({
      archetype: "conservative",
      cashAnchor: 0,
      positions: [{ fundId: FUND_ID, units: 20, quotedNav: 100 }],
    });
    expect(plan).toEqual([{ fundId: FUND_ID, units: 2 }]);
  });

  it("never plans more units than the position holds", () => {
    for (const units of [1, 5, 9, 10, 11, 100]) {
      const plan = planNppFundRedemptions({
        archetype: "aggressive",
        cashAnchor: 0,
        positions: [{ fundId: FUND_ID, units, quotedNav: 1 }],
      });
      const total = plan.reduce((sum, i) => sum + i.units, 0);
      expect(total).toBeLessThanOrEqual(units);
    }
  });

  it("decays deterministically regardless of the input ordering", () => {
    const fundA = new ObjectId();
    const fundB = new ObjectId();
    const positions = [
      { fundId: fundA, units: 30, quotedNav: 100 },
      { fundId: fundB, units: 10, quotedNav: 100 },
    ];
    const forward = planNppFundRedemptions({
      archetype: "conservative",
      cashAnchor: 0,
      positions,
    });
    const reversed = planNppFundRedemptions({
      archetype: "conservative",
      cashAnchor: 0,
      positions: [...positions].reverse(),
    });
    expect(forward).toEqual(reversed);
    // Largest position first, capped at 10% each.
    expect(forward).toEqual([
      { fundId: fundA, units: 3 },
      { fundId: fundB, units: 1 },
    ]);
  });

  it("is strictly bounded per turn by the fraction constant", () => {
    const plan = planNppFundRedemptions({
      archetype: "aggressive",
      cashAnchor: 0,
      positions: [{ fundId: FUND_ID, units: 1000, quotedNav: 1 }],
    });
    const total = plan.reduce((sum, i) => sum + i.units, 0);
    expect(total).toBeLessThanOrEqual(Math.floor(1000 * NPP_FUND_REDEMPTION_MAX_FRACTION_PER_TURN));
  });

  it("ignores non-finite or non-positive position inputs", () => {
    expect(
      planNppFundRedemptions({
        archetype: "conservative",
        cashAnchor: 0,
        positions: [
          { fundId: FUND_ID, units: Number.NaN, quotedNav: 100 },
          { fundId: new ObjectId(), units: 10, quotedNav: 0 },
        ],
      })
    ).toEqual([]);
  });

  it("exposes a monotonic target share per archetype", () => {
    expect(nppTargetFundShare("conservative")).toBeLessThan(nppTargetFundShare("moderate"));
    expect(nppTargetFundShare("moderate")).toBeLessThan(nppTargetFundShare("aggressive"));
    for (const share of Object.values(NPP_ARCHETYPE_TARGET_FUND_SHARE)) {
      expect(share).toBeGreaterThan(0);
      expect(share).toBeLessThan(1);
    }
  });
});

describe("processNppFundRedemptions — gating", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
  });

  it("is a read-only no-op when the flag is absent", async () => {
    db.collection("gameConfig").findOne.mockResolvedValue({ ledgerShadow: true });

    const result = await processNppFundRedemptions(db as unknown as Db, {
      currentTurn: 8,
      activeFunds: [fund()],
      archetypesByNppId: new Map([[NPP_ID.toString(), "conservative"]]),
    });

    expect(result).toEqual({ redemptionsQueued: 0, unitsRedeemed: 0, errors: [] });
    // Nothing past the config read is touched — no positions, no queue.
    expect(db.collectionMocks["indexFundPositions"]).toBeUndefined();
    expect(db.collectionMocks["indexFundRedemptionQueue"]).toBeUndefined();
  });

  it("is a read-only no-op when the flag is explicitly false", async () => {
    db.collection("gameConfig").findOne.mockResolvedValue({ nppFundRedemptionEnabled: false });

    const result = await processNppFundRedemptions(db as unknown as Db, {
      currentTurn: 8,
      activeFunds: [fund()],
      archetypesByNppId: new Map([[NPP_ID.toString(), "conservative"]]),
    });

    expect(result.redemptionsQueued).toBe(0);
    expect(db.collectionMocks["indexFundPositions"]).toBeUndefined();
    expect(db.collectionMocks["indexFundRedemptionQueue"]).toBeUndefined();
  });

  it("queues a bounded redemption through the shared enqueueRedemption path when enabled", async () => {
    db.collection("gameConfig").findOne.mockResolvedValue({ nppFundRedemptionEnabled: true });
    // NPP holds 20 units, no cash → overweight; planner caps at 2 units.
    db.collection("indexFundPositions").find.mockReturnValue({
      toArray: async () => [{ nppId: NPP_ID, fundId: FUND_ID, units: 20 }],
    });
    db.collection("npps").find.mockReturnValue({
      toArray: async () => [{ _id: NPP_ID, nppInvestmentCashAnchor: 0 }],
    });
    // debitFundPosition reads the PRE-image (returnDocument: "before").
    db.collection("indexFundPositions").findOneAndUpdate.mockResolvedValue({
      _id: new ObjectId(),
      fundId: FUND_ID,
      holderKind: "npp",
      nppId: NPP_ID,
      units: 20,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await processNppFundRedemptions(db as unknown as Db, {
      currentTurn: 8,
      activeFunds: [fund()],
      archetypesByNppId: new Map([[NPP_ID.toString(), "conservative"]]),
    });

    expect(result).toEqual({ redemptionsQueued: 1, unitsRedeemed: 2, errors: [] });
    const queueInsert = db.collectionMocks["indexFundRedemptionQueue"]!.insertOne;
    expect(queueInsert).toHaveBeenCalledTimes(1);
    const entry = queueInsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      fundId: FUND_ID,
      holderKind: "npp",
      nppId: NPP_ID,
      units: 2,
      requestedNavAnchor: 100,
      requestedAmountAnchor: 200,
      paidAmountAnchor: 0,
      unitsBurnedAtRequest: true,
      status: "queued",
    });
  });

  it("skips a position that is too small to redeem a whole unit this turn", async () => {
    db.collection("gameConfig").findOne.mockResolvedValue({ nppFundRedemptionEnabled: true });
    db.collection("indexFundPositions").find.mockReturnValue({
      toArray: async () => [{ nppId: NPP_ID, fundId: FUND_ID, units: 1 }],
    });
    db.collection("npps").find.mockReturnValue({
      toArray: async () => [{ _id: NPP_ID, nppInvestmentCashAnchor: 0 }],
    });

    const result = await processNppFundRedemptions(db as unknown as Db, {
      currentTurn: 8,
      activeFunds: [fund()],
      archetypesByNppId: new Map([[NPP_ID.toString(), "conservative"]]),
    });

    expect(result.redemptionsQueued).toBe(0);
    expect(db.collectionMocks["indexFundRedemptionQueue"]).toBeUndefined();
  });
});
