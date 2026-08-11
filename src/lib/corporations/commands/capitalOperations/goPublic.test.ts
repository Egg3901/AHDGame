import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { goPublic } from "./goPublic";

function makeCorp(overrides: Record<string, unknown> = {}) {
  const ceoId = new ObjectId();
  return {
    _id: new ObjectId(),
    isPrivate: true,
    ceoId,
    shareholders: [{ characterId: ceoId, shares: 10_000_000 }],
    totalShares: 10_000_000,
    publicFloat: 0,
    sharePrice: 1.0,
    liquidCapital: 1_000_000,
    liquidCurrencyCode: "USD",
    createdAt: new Date(),
    foundedAtTurn: 0,
    ...overrides,
  };
}

function makeDb() {
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  const findOne = vi.fn().mockResolvedValue(null);
  return {
    db: {
      collection: vi.fn().mockImplementation(() => ({ updateOne, findOne })),
    } as unknown as Db,
    updateOne,
  };
}

describe("goPublic command", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when corp is already public", async () => {
    const corp = makeCorp({ isPrivate: false });
    const { db } = makeDb();
    const result = await goPublic({
      db,
      corporation: corp as never,
      floatPct: 30,
      currentTurn: 200,
    });
    expect(result.ok).toBe(false);
  });

  it("allows IPO immediately after founding private (no oscillation = no cooldown)", async () => {
    // Founding-as-private then immediately IPOing is equivalent to founding-as-IPO,
    // so foundedAtTurn must NOT gate the cooldown.
    const corp = makeCorp({ foundedAtTurn: 1000 });
    const { db } = makeDb();
    const result = await goPublic({
      db,
      corporation: corp as never,
      floatPct: 30,
      currentTurn: 1_050,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects when private corp has non-CEO minority shareholders", async () => {
    const ceoId = new ObjectId();
    const minorityCharId = new ObjectId();
    const corp = makeCorp({
      ceoId,
      shareholders: [
        { characterId: ceoId, shares: 9_000_000 },
        { characterId: minorityCharId, shares: 1_000_000 },
      ],
    });
    const { db } = makeDb();
    const result = await goPublic({
      db,
      corporation: corp as never,
      floatPct: 30,
      currentTurn: 1_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/minority shareholders/i);
  });

  it("rejects when within IPO_COOLDOWN_TURNS of last privatization", async () => {
    // Founded at turn 0, then privatized at turn 950, currentTurn 1000.
    // Cooldown anchor = max(0, 950) = 950 → 50 turns since → still in cooldown.
    const corp = makeCorp({ foundedAtTurn: 0, lastPrivatizationTurn: 950 });
    const { db } = makeDb();
    const result = await goPublic({
      db,
      corporation: corp as never,
      floatPct: 30,
      currentTurn: 1_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/cooldown/i);
  });

  it("on success: returns issuance result and writes update with set/inc", async () => {
    const corp = makeCorp({ sharePrice: 2.0 });
    const { db, updateOne } = makeDb();
    const result = await goPublic({
      db,
      corporation: corp as never,
      floatPct: 30,
      currentTurn: 1_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newShares).toBe(4_285_714);
    // `proceeds` is the notional offering size (returned for the API response),
    // NOT a cash credit — going public issues float inventory and moves no money.
    expect(result.proceeds).toBe(8_571_428); // 4_285_714 × 2.0
    const updateCall = updateOne.mock.calls[0];
    const setOps = updateCall[1].$set;
    const incOps = updateCall[1].$inc;
    expect(setOps.isPrivate).toBe(false);
    expect(setOps.lastIpoTurn).toBe(1_000);
    expect(incOps.totalShares).toBe(4_285_714);
    expect(incOps.publicFloat).toBe(4_285_714);
    // Bug #0624: issuance must NOT pre-credit cash or record proceeds. The corp
    // realizes both as the float is actually bought (treasury-backed market maker).
    expect(incOps.liquidCapital).toBeUndefined();
    expect(incOps.shareIssuanceProceeds).toBeUndefined();
  });

  it("rejects a float above 49% without supershares", async () => {
    const corp = makeCorp();
    const { db } = makeDb();
    const result = await goPublic({
      db,
      corporation: corp as never,
      floatPct: 60,
      currentTurn: 1_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/out of range/i);
  });

  it("dual-class IPO: allows a 75% float and stamps the supershare structure", async () => {
    const corp = makeCorp();
    const { db, updateOne } = makeDb();
    const result = await goPublic({
      db,
      corporation: corp as never,
      floatPct: 75,
      currentTurn: 1_000,
      superShareMultiplier: 10,
    });
    expect(result.ok).toBe(true);
    // Second update stamps the multiplier + designates CEO shares as supershares.
    expect(updateOne).toHaveBeenCalledTimes(2);
    const [filter, pipeline] = updateOne.mock.calls[1];
    expect(filter.superShareMultiplier).toEqual({ $exists: false });
    expect(pipeline[0].$set.superShareMultiplier).toBe(10);
    expect(pipeline[0].$set.superSharesAdoptedAtTurn).toBe(1_000);
  });

  it("rejects an invalid supershare multiplier", async () => {
    const corp = makeCorp();
    const { db } = makeDb();
    const result = await goPublic({
      db,
      corporation: corp as never,
      floatPct: 30,
      currentTurn: 1_000,
      superShareMultiplier: 50,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/multiplier/i);
  });

  it("rejects supershares when the corp already has a dual-class structure", async () => {
    const corp = makeCorp({ superShareMultiplier: 5 });
    const { db } = makeDb();
    const result = await goPublic({
      db,
      corporation: corp as never,
      floatPct: 30,
      currentTurn: 1_000,
      superShareMultiplier: 10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already has/i);
  });
});
