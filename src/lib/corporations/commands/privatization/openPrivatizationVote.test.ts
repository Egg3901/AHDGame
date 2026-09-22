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
vi.mock("@/lib/banking/policy", () => ({ loadBankingPolicy: vi.fn() }));

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

describe("openPrivatizationVote — bank-NAV floor (issue #1750)", () => {
  beforeEach(() => vi.clearAllMocks());

  const BANK_CASH = 123_410_000;
  const BANK_DEPOSITS = 71_110_000;
  const BANK_EQUITY = BANK_CASH - BANK_DEPOSITS;

  function makeCharter(overrides: Record<string, unknown> = {}) {
    return {
      type: "retail",
      status: "active",
      currency: "USD",
      charteredTurn: 150,
      postedCapital: 50_000_000,
      cashReserves: BANK_CASH,
      npcDeposits: BANK_DEPOSITS,
      playerDeposits: 0,
      totalDeposits: BANK_DEPOSITS,
      totalLoans: 0,
      propBookMarkValue: 0,
      discountWindowDebt: 0,
      discountWindowArrears: 0,
      cbMarginDebt: 0,
      cbMarginArrears: 0,
      interbankDebt: 0,
      ...overrides,
    };
  }

  // CEO holds 90% of 1000 shares; market leg is 10 x 1.1 = 11 per share.
  function makeBankCorp(charter: Record<string, unknown>) {
    const ceoId = new ObjectId();
    return makeCorp({
      ceoId,
      sharePrice: 10,
      totalShares: 1000,
      publicFloat: 50,
      liquidCurrencyCode: "USD",
      shareholders: [
        { characterId: ceoId, shares: 900 },
        { characterId: new ObjectId(), shares: 100 },
      ],
      bankCharter: charter,
    });
  }

  function makeBankDb() {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
    const db = {
      collection: vi.fn((name: string) => {
        if (name === "corporationPrivatizationVotes") {
          return { findOne: vi.fn().mockResolvedValue(null), insertOne };
        }
        if (name === "exchangeRates") {
          return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        };
      }),
    } as unknown as Db;
    return { db, insertOne };
  }

  async function openWithCorp(corp: Record<string, unknown>) {
    const { loadBankingPolicy } = await import("@/lib/banking/policy");
    vi.mocked(loadBankingPolicy).mockResolvedValue({
      savingsAccounts: "pointer",
      savingsReadCurrencies: [],
    } as never);
    const cashMock = await import("@/lib/financialTxLog/atomicCashGuard");
    vi.mocked(cashMock.atomicallyDebitCharacterCash).mockResolvedValue({
      ok: true,
      newBalance: 0,
    });
    const { db, insertOne } = makeBankDb();
    const result = await openPrivatizationVote({
      db,
      corporation: corp as never,
      character: { _id: corp.ceoId as ObjectId, name: "CEO" } as never,
      currentTurn: 1000,
      forexEnabled: false,
    });
    return { result, insertOne };
  }

  it("floors the locked buyout at realizable bank equity when the market underprices it", async () => {
    const { result, insertOne } = await openWithCorp(makeBankCorp(makeCharter()));
    expect(result.ok).toBe(true);
    if (!result.ok || result.immediate) return;
    // 52.3M NAV over 1000 shares = 52,300 per share, not the 11 market print.
    expect(result.bankNavFloorApplied).toBe(true);
    expect(result.lockedBuyoutPrice).toBe(BANK_EQUITY / 1000);
    expect(result.totalReservedCash).toBe(Math.ceil(100 * (BANK_EQUITY / 1000)));
    // The floor persists into the stored vote, so the later resolve (replay)
    // pays the floored price rather than re-deriving the market one.
    expect(insertOne).toHaveBeenCalledTimes(1);
    expect(insertOne.mock.calls[0][0]).toMatchObject({
      lockedBuyoutPrice: BANK_EQUITY / 1000,
    });
  });

  it("counts the marked bond/prop book in the floor, net of borrowings", async () => {
    const propBookMarkValue = 300_000_000;
    const discountWindowDebt = 10_000_000;
    const nav = BANK_CASH + propBookMarkValue - BANK_DEPOSITS - discountWindowDebt;
    const { result } = await openWithCorp(
      makeBankCorp(makeCharter({ propBookMarkValue, discountWindowDebt }))
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.immediate) return;
    expect(result.bankNavFloorApplied).toBe(true);
    expect(result.lockedBuyoutPrice).toBe(nav / 1000);
  });

  it("leaves the locked price at the market premium for corps without a bank", async () => {
    const ceoId = new ObjectId();
    const corp = makeCorp({
      ceoId,
      sharePrice: 10,
      totalShares: 1000,
      publicFloat: 50,
      shareholders: [
        { characterId: ceoId, shares: 900 },
        { characterId: new ObjectId(), shares: 100 },
      ],
    });
    const { result } = await openWithCorp(corp);
    expect(result.ok).toBe(true);
    if (!result.ok || result.immediate) return;
    expect(result.bankNavFloorApplied).toBe(false);
    expect(result.lockedBuyoutPrice).toBeCloseTo(11, 4);
  });

  it("nets player deposits once the savings read is authoritative", async () => {
    const playerDeposits = 30_000_000;
    const { loadBankingPolicy } = await import("@/lib/banking/policy");
    vi.mocked(loadBankingPolicy).mockResolvedValue({
      savingsAccounts: "authoritative",
      savingsReadCurrencies: ["USD"],
    } as never);
    const cashMock = await import("@/lib/financialTxLog/atomicCashGuard");
    vi.mocked(cashMock.atomicallyDebitCharacterCash).mockResolvedValue({
      ok: true,
      newBalance: 0,
    });
    const corp = makeBankCorp(
      makeCharter({ playerDeposits, totalDeposits: BANK_DEPOSITS + playerDeposits })
    );
    const { db } = makeBankDb();
    const result = await openPrivatizationVote({
      db,
      corporation: corp as never,
      character: { _id: corp.ceoId as ObjectId, name: "CEO" } as never,
      currentTurn: 1000,
      forexEnabled: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.immediate) return;
    expect(result.bankNavFloorApplied).toBe(true);
    expect(result.lockedBuyoutPrice).toBe((BANK_EQUITY - playerDeposits) / 1000);
  });

  it("keeps the market price when the bank is underwater", async () => {
    const { result } = await openWithCorp(
      makeBankCorp(makeCharter({ cashReserves: 10, npcDeposits: 100, totalDeposits: 100 }))
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.immediate) return;
    expect(result.bankNavFloorApplied).toBe(false);
    expect(result.lockedBuyoutPrice).toBeCloseTo(11, 4);
  });

  it("#2114: immediate privatization clears a stale pendingShareIssuance", async () => {
    const ceoId = new ObjectId();
    const corp = makeCorp({
      ceoId,
      totalShares: 10_000_000,
      shareholders: [{ characterId: ceoId, shares: 10_000_000 }],
      pendingShareIssuance: {
        remainingShares: 500,
        requestedShares: 1000,
        source: "vote",
        createdAtTurn: 100,
        initialPriceLocal: 1.0,
      },
    });
    const character = makeCharacter(ceoId);
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const db = {
      collection: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(null),
        insertOne: vi.fn(),
        updateOne,
      }),
    } as unknown as Db;

    const result = await openPrivatizationVote({
      db,
      corporation: corp as never,
      character: character as never,
      currentTurn: 1000,
      forexEnabled: false,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.immediate).toBe(true);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne.mock.calls[0][1].$unset.pendingShareIssuance).toBe("");
  });
});
