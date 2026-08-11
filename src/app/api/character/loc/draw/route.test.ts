import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { POST } from "./route";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Character } from "@/lib/db/types";
import type { LocSnapshot } from "@/lib/lineOfCredit/buildSnapshot";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(),
}));

vi.mock("@/lib/db/characterLookup", () => ({
  getCharacterByUserId: vi.fn(),
}));

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn(),
}));

vi.mock("@/lib/lineOfCredit/featureFlag", () => ({
  isLineOfCreditEnabled: vi.fn(),
}));

vi.mock("@/lib/lineOfCredit/buildSnapshot", () => ({
  buildLocSnapshot: vi.fn(),
}));

vi.mock("@/lib/lineOfCredit/netWorth", () => ({
  loadExchangeRatesMap: vi.fn(),
}));

vi.mock("@/lib/api/rateLimit", () => ({
  SAVINGS_WALLET_LIMITS: { maxRequests: 10, windowMs: 60_000 },
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));

vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn(),
}));

vi.mock("@/lib/lineOfCredit/ledger", () => ({
  insertLocLedgerEntry: vi.fn(),
}));

vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn(),
}));

function makeCharacter(overrides: Partial<Character> = {}): Character {
  const characterId = overrides._id ?? new ObjectId();
  const userId = overrides.userId ?? new ObjectId();

  return {
    _id: characterId,
    userId,
    countryId: "DE",
    name: "Kimi Antonelli",
    homeState: "Berlin",
    politicalInfluence: 0,
    favorability: 50,
    infamy: 0,
    funds: 0,
    currencyBalances: {
      campaign: 0,
      personal: { EUR: 0 },
    },
    actions: 0,
    donorBaseLevel: 0,
    policies: { economic: 0, social: 0 },
    party: "independent",
    currentOffice: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    lineOfCredit: {
      balances: { EUR: 5_000_000_000 },
      arrears: {},
      accountsOpened: { EUR: true },
      drawFrozen: false,
    },
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<LocSnapshot> = {}): LocSnapshot {
  return {
    enabled: true,
    composite: 80,
    spreadPercentPoints: 0.5,
    grossAssetsInternal: 10_000_000_000,
    locDebtInternal: 5_000_000_000,
    netWorthInternal: 5_000_000_000,
    maxDebtInternal: 20_000_000_000,
    outstandingInternal: 5_000_000_000,
    availableBorrowInternal: 20_000_000_000,
    balances: { EUR: 5_000_000_000 },
    arrears: {},
    accountsOpened: { EUR: true },
    fundingSource: {},
    drawFrozen: false,
    incomeScore: 80,
    netWorthScore: 80,
    hasCeoCorp: false,
    homePrimePercent: 2.5,
    debtToAssetsRatio: 0.5,
    effectiveRatePercent: 3,
    incomePerTurnFace: 1_000_000,
    scheduledDebtServiceInternal: 20_312_500,
    dtiLimitInternal: 5_800_000_000,
    netWorthLimitInternal: 12_000_000_000,
    perPlayerLimitInternal: 5_800_000_000,
    perPlayerAvailableInternal: 800_000_000,
    paymentMode: {},
    paymentModeChangedAtTurn: {},
    currentTurn: 0,
    ...overrides,
  };
}

describe("POST /api/character/loc/draw", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();

    const { getDb } = await import("@/lib/mongodb");
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    const { isLineOfCreditEnabled } = await import("@/lib/lineOfCredit/featureFlag");
    const { loadExchangeRatesMap } = await import("@/lib/lineOfCredit/netWorth");

    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId() },
    } as never);
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    vi.mocked(isLineOfCreditEnabled).mockResolvedValue(true);
    vi.mocked(loadExchangeRatesMap).mockResolvedValue({
      USD: 1,
      GBP: 0.75,
      JPY: 106,
      EUR: 0.92,
    } as never);
  });

  it("rejects a stale concurrent draw when the borrower has already consumed the headroom", async () => {
    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    const { buildLocSnapshot } = await import("@/lib/lineOfCredit/buildSnapshot");
    const { insertLocLedgerEntry } = await import("@/lib/lineOfCredit/ledger");
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    const charactersCollection = db.collection("characters");

    const character = makeCharacter();
    const freshCharacter = makeCharacter({
      _id: character._id,
      userId: character.userId,
      lineOfCredit: {
        balances: { EUR: 5_750_000_000 },
        arrears: {},
        accountsOpened: { EUR: true },
        drawFrozen: false,
      },
    });

    vi.mocked(getCharacterByUserId).mockResolvedValue(character);
    vi.mocked(buildLocSnapshot)
      .mockResolvedValueOnce(
        makeSnapshot({
          outstandingInternal: 5_000_000_000,
          perPlayerAvailableInternal: 1_000_000_000,
        })
      )
      .mockResolvedValueOnce(
        makeSnapshot({
          outstandingInternal: 5_750_000_000,
          perPlayerAvailableInternal: 50_000_000,
          balances: { EUR: 5_750_000_000 },
        })
      );

    charactersCollection.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });
    charactersCollection.findOne.mockResolvedValue(freshCharacter);

    const response = await POST(
      new Request("http://localhost/api/character/loc/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: "EUR", amount: 250_000_000 }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Exceeds your credit limit");

    const [filter] = charactersCollection.updateOne.mock.calls[0] as [Record<string, unknown>];
    expect(filter._id).toEqual(character._id);
    expect(filter["lineOfCredit.accountsOpened.EUR"]).toBe(true);
    expect(filter["lineOfCredit.drawFrozen"]).toEqual({ $ne: true });
    expect(filter["lineOfCredit.balances.EUR"]).toBe(5_000_000_000);
    expect(filter["lineOfCredit.balances.USD"]).toEqual({ $not: { $gt: 0 } });
    expect(filter["lineOfCredit.arrears.EUR"]).toEqual({ $not: { $gt: 0 } });

    expect(charactersCollection.findOne).toHaveBeenCalledWith({ _id: character._id });
    expect(insertLocLedgerEntry).not.toHaveBeenCalled();
    expect(emitTx).not.toHaveBeenCalled();
  });
});
