import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { openPrivatizationVote } from "./openPrivatizationVote";

vi.mock("@/lib/financialTxLog/atomicCashGuard", () => ({
  atomicallyDebitCharacterCash: vi.fn(),
  refundCharacterCash: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/currency/characterFunds", () => ({
  getHomeCurrency: vi.fn().mockReturnValue("USD"),
}));
vi.mock("./fundOnlyBuyout", () => ({ executeFundOnlyBuyout: vi.fn() }));

function makeCorp(overrides: Record<string, unknown> = {}) {
  const ceoId = new ObjectId();
  return {
    _id: new ObjectId(),
    ceoId,
    isPrivate: false,
    sharePrice: 1.0,
    totalShares: 10_000_000,
    publicFloat: 1_000_000,
    liquidCurrencyCode: "USD",
    shareholders: [{ characterId: ceoId, shares: 8_500_000 }],
    ...overrides,
  };
}

function makeCharacter(_id?: ObjectId) {
  return { _id: _id ?? new ObjectId(), name: "CEO" };
}

function makeDb({
  voteFindReturns,
  insertSucceeds = true,
  insertError,
}: {
  voteFindReturns?: unknown;
  insertSucceeds?: boolean;
  insertError?: unknown;
}) {
  const insertOne = insertSucceeds
    ? vi.fn().mockResolvedValue({ insertedId: new ObjectId() })
    : vi.fn().mockRejectedValue(insertError ?? new Error("insert failed"));
  const findOne = vi.fn().mockResolvedValue(voteFindReturns ?? null);
  return {
    db: {
      collection: vi.fn().mockReturnValue({ insertOne, findOne }),
    } as unknown as Db,
    insertOne,
  };
}

describe("openPrivatizationVote — atomic open", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when corp is private", async () => {
    const corp = makeCorp({ isPrivate: true });
    const character = makeCharacter(corp.ceoId);
    const { db } = makeDb({});
    const result = await openPrivatizationVote({
      db,
      corporation: corp as never,
      character: character as never,
      currentTurn: 1000,
      forexEnabled: false,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects when CEO ownership ≤ threshold", async () => {
    const ceoId = new ObjectId();
    const corp = makeCorp({
      ceoId,
      shareholders: [
        { characterId: ceoId, shares: 7_500_000 }, // 75% exactly — threshold is "more than 75"
      ],
    });
    const character = makeCharacter(ceoId);
    const { db } = makeDb({});
    const result = await openPrivatizationVote({
      db,
      corporation: corp as never,
      character: character as never,
      currentTurn: 1000,
      forexEnabled: false,
    });
    expect(result.ok).toBe(false);
  });

  it("allows a dual-class CEO below 75% economic but above 75% voting power (#895)", async () => {
    const ceoId = new ObjectId();
    // 6M/10M = 60% economic, but 6M supershares @10x → 60M + 4M common = 64M
    // total voting power, CEO = 60M/64M ≈ 93.75% > 75% threshold.
    const corp = makeCorp({
      ceoId,
      superShareMultiplier: 10,
      totalShares: 10_000_000,
      publicFloat: 0,
      shareholders: [
        { characterId: ceoId, shares: 6_000_000, superShares: 6_000_000 },
        { characterId: new ObjectId(), shares: 4_000_000 },
      ],
    });
    const character = makeCharacter(ceoId);
    const { db } = makeDb({});
    const cashMock = await import("@/lib/financialTxLog/atomicCashGuard");
    vi.mocked(cashMock.atomicallyDebitCharacterCash).mockResolvedValue({
      ok: true,
      newBalance: 0,
    });
    const result = await openPrivatizationVote({
      db,
      corporation: corp as never,
      character: character as never,
      currentTurn: 1000,
      forexEnabled: false,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a single-class CEO at 60% (voting power == economic, below 75%)", async () => {
    const ceoId = new ObjectId();
    const corp = makeCorp({
      ceoId,
      shareholders: [
        { characterId: ceoId, shares: 6_000_000 },
        { characterId: new ObjectId(), shares: 4_000_000 },
      ],
    });
    const character = makeCharacter(ceoId);
    const { db } = makeDb({});
    const result = await openPrivatizationVote({
      db,
      corporation: corp as never,
      character: character as never,
      currentTurn: 1000,
      forexEnabled: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/voting power/i);
  });

  it("rejects when an open vote already exists", async () => {
    const corp = makeCorp();
    const character = makeCharacter(corp.ceoId);
    const { db } = makeDb({ voteFindReturns: { _id: new ObjectId(), status: "open" } });
    const result = await openPrivatizationVote({
      db,
      corporation: corp as never,
      character: character as never,
      currentTurn: 1000,
      forexEnabled: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already open/i);
  });

  it("on insert failure: refunds the reserved cash", async () => {
    const corp = makeCorp();
    const character = makeCharacter(corp.ceoId);
    const { db } = makeDb({ insertSucceeds: false });
    const cashMock = await import("@/lib/financialTxLog/atomicCashGuard");
    vi.mocked(cashMock.atomicallyDebitCharacterCash).mockResolvedValue({
      ok: true,
      newBalance: 0,
    });

    await expect(() =>
      openPrivatizationVote({
        db,
        corporation: corp as never,
        character: character as never,
        currentTurn: 1000,
        forexEnabled: false,
      })
    ).rejects.toThrow();

    expect(vi.mocked(cashMock.refundCharacterCash)).toHaveBeenCalledTimes(1);
  });

  it("on duplicate-key (E11000) from partial unique index: refunds and surfaces friendly error", async () => {
    const corp = makeCorp();
    const character = makeCharacter(corp.ceoId);
    const dupErr = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    const { db } = makeDb({ insertSucceeds: false, insertError: dupErr });
    const cashMock = await import("@/lib/financialTxLog/atomicCashGuard");
    vi.mocked(cashMock.atomicallyDebitCharacterCash).mockResolvedValue({
      ok: true,
      newBalance: 0,
    });

    const result = await openPrivatizationVote({
      db,
      corporation: corp as never,
      character: character as never,
      currentTurn: 1000,
      forexEnabled: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already open/i);
    expect(vi.mocked(cashMock.refundCharacterCash)).toHaveBeenCalledTimes(1);
  });

  it("#71: funds-only minority + no float → buys out & privatizes, no vote opened", async () => {
    const ceoId = new ObjectId();
    const corp = makeCorp({
      ceoId,
      publicFloat: 0,
      shareholders: [
        { characterId: ceoId, shares: 9_990_000 },
        { fundId: new ObjectId(), shares: 10_000 }, // index fund — cannot vote
      ],
    });
    const character = makeCharacter(ceoId);
    const { db, insertOne } = makeDb({});
    const buyoutMock = await import("./fundOnlyBuyout");
    vi.mocked(buyoutMock.executeFundOnlyBuyout).mockResolvedValue({ ok: true });

    const result = await openPrivatizationVote({
      db,
      corporation: corp as never,
      character: character as never,
      currentTurn: 1000,
      forexEnabled: false,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.immediate).toBe(true);
    expect(vi.mocked(buyoutMock.executeFundOnlyBuyout)).toHaveBeenCalledTimes(1);
    expect(insertOne).not.toHaveBeenCalled(); // no vote row created
  });

  it("does NOT buy out (opens a vote) when a non-CEO character holds shares", async () => {
    const ceoId = new ObjectId();
    const corp = makeCorp({
      ceoId,
      publicFloat: 0,
      shareholders: [
        { characterId: ceoId, shares: 9_000_000 },
        { characterId: new ObjectId(), shares: 990_000 }, // a real voter
        { fundId: new ObjectId(), shares: 10_000 },
      ],
    });
    const character = makeCharacter(ceoId);
    const { db, insertOne } = makeDb({});
    const buyoutMock = await import("./fundOnlyBuyout");
    const cashMock = await import("@/lib/financialTxLog/atomicCashGuard");
    vi.mocked(cashMock.atomicallyDebitCharacterCash).mockResolvedValue({ ok: true, newBalance: 0 });

    const result = await openPrivatizationVote({
      db,
      corporation: corp as never,
      character: character as never,
      currentTurn: 1000,
      forexEnabled: false,
    });

    expect(result.ok).toBe(true);
    expect(vi.mocked(buyoutMock.executeFundOnlyBuyout)).not.toHaveBeenCalled();
    expect(insertOne).toHaveBeenCalledTimes(1); // vote row created instead
  });

  it("on success: returns voteId, lockedBuyoutPrice, totalReservedCash", async () => {
    const corp = makeCorp({ sharePrice: 2.0 }); // 1.5M non-CEO shares × 2.20 = 3.3M reserved
    const character = makeCharacter(corp.ceoId);
    const { db, insertOne } = makeDb({});
    const cashMock = await import("@/lib/financialTxLog/atomicCashGuard");
    vi.mocked(cashMock.atomicallyDebitCharacterCash).mockResolvedValue({
      ok: true,
      newBalance: 0,
    });

    const result = await openPrivatizationVote({
      db,
      corporation: corp as never,
      character: character as never,
      currentTurn: 1000,
      forexEnabled: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.immediate) return;
    expect(result.lockedBuyoutPrice).toBeCloseTo(2.2, 4);
    // 10M - 8.5M = 1.5M non-CEO shares × 2.20 = 3.3M (Math.ceil over float math
    // can yield 3_300_001 due to floating-point drift; allow either).
    expect(result.totalReservedCash).toBeGreaterThanOrEqual(3_300_000);
    expect(result.totalReservedCash).toBeLessThanOrEqual(3_300_001);
    expect(insertOne).toHaveBeenCalledTimes(1);
  });
});
