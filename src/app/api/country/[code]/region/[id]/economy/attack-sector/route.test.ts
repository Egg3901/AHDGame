import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const withTransaction = vi.fn(async (callback: () => Promise<void>) => callback());
const endSession = vi.fn().mockResolvedValue(undefined);
const makeSession = () => ({ withTransaction, endSession });
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
  getMongoClient: vi.fn().mockResolvedValue({
    startSession: () => makeSession(),
  }),
}));
vi.mock("node:crypto", () => ({ randomInt: vi.fn().mockReturnValue(0) }));
vi.mock("@/lib/api/requireAuth", () => ({ requireHumanSession: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/db/characterLookup", () => ({ getCharacterByUserId: vi.fn() }));
vi.mock("@/lib/corporations/marketShare", () => ({
  fetchAttackerDefenderShares: vi
    .fn()
    .mockResolvedValue({ defenderSharePercent: 0, attackerSharePercent: 0 }),
}));
vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn(),
  wireHeadlineSectorAttack: vi.fn().mockReturnValue("headline"),
}));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/corporations/economicActionLog", () => ({
  logEconomicAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  anchorToCorpLiquidCapital: vi.fn((v: number) => v),
  corpLiquidCapitalToAnchor: vi.fn((v: number) => v),
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  resolveCorpLiquidCurrencyCode: vi.fn().mockReturnValue("USD"),
}));

let db: MockDb;

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/US/region/CA/economy/attack-sector", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = () => ({ params: Promise.resolve({ code: "US", id: "CA" }) });

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("gameState");
  db.collection("states");
  db.collection("users");
  db.collection("characters");
  db.collection("corporations");
  db.collection("corporateSectors");
  db.collection("unownedSectors");
  db.collection("exchangeRates");
  db.collection("gameConfig");
  db.collectionMocks.gameConfig.findOne.mockResolvedValue({
    _id: "default",
    marketSystemMode: "plants",
  });

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireHumanSession } = await import("@/lib/api/requireAuth");
  vi.mocked(requireHumanSession).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString() },
  } as never);
});

describe("POST /api/country/[code]/region/[id]/economy/attack-sector", () => {
  it("blocks private attacks in an eastern-bloc command economy", async () => {
    const sectorId = new ObjectId();
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current" });
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "PL-WAW",
      countryId: "PL",
      name: "Warsaw",
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ sectorId: sectorId.toHexString() }), {
      params: Promise.resolve({ code: "PL", id: "PL-WAW" }),
    });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toMatch(/command economy/i);
    expect(db.collectionMocks.corporations.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporateSectors.insertOne).not.toHaveBeenCalled();
  });

  it("self-heals an orphan sector and returns a dissolved-defender 404", async () => {
    const attackerCharId = new ObjectId();
    const attackerCorpId = new ObjectId();
    const orphanCorpId = new ObjectId(); // points to a corp that no longer exists
    const orphanSectorId = new ObjectId();

    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current" });
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
      gdp: 1_000_000_000,
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: new ObjectId(),
      activeCharacterType: "regular",
    });

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: attackerCharId,
      name: "Attacker",
    } as never);

    // First call to corporations.findOne: lookup attacker's own corp by ceoId.
    // Second call: defender corp lookup by _id — returns null (orphan).
    db.collectionMocks.corporations.findOne
      .mockResolvedValueOnce({
        _id: attackerCorpId,
        name: "Attacker Corp",
        liquidCapital: 100_000_000,
        marketingStrength: 500,
        splitEscalation: 0,
        countryId: "US",
        liquidCurrencyCode: "USD",
      })
      .mockResolvedValueOnce(null);

    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: orphanSectorId,
      corporationId: orphanCorpId,
      countryId: "US",
      stateId: "CA",
      sectorType: "extraction",
      revenue: 1_000_000,
    });

    db.collectionMocks.corporateSectors.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ sectorId: orphanSectorId.toHexString() }), ctx());
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toMatch(/dissolved/i);
    expect(data.error).toMatch(/refresh/i);
    // The orphan sector row should be removed so subsequent reads stop
    // exposing it as an attackable defender.
    expect(db.collectionMocks.corporateSectors.deleteOne).toHaveBeenCalledWith({
      _id: orphanSectorId,
    });
    // The attacker's corp should NOT be charged for the failed attack.
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("blocks attacks on a suspended (auction-shell) corporation", async () => {
    const attackerCharId = new ObjectId();
    const attackerCorpId = new ObjectId();
    const shellCorpId = new ObjectId();
    const shellSectorId = new ObjectId();

    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current" });
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
      gdp: 1_000_000_000,
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: new ObjectId(),
      activeCharacterType: "regular",
    });

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: attackerCharId,
      name: "Attacker",
    } as never);

    db.collectionMocks.corporations.findOne
      .mockResolvedValueOnce({
        _id: attackerCorpId,
        name: "Attacker Corp",
        liquidCapital: 100_000_000,
        marketingStrength: 500,
        splitEscalation: 0,
        countryId: "US",
        liquidCurrencyCode: "USD",
      })
      // Defender: a suspended auction shell (no countryOwnerId).
      .mockResolvedValueOnce({
        _id: shellCorpId,
        name: "Carved Co (auction)",
        suspended: true,
        countryId: "US",
        liquidCurrencyCode: "USD",
      });

    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: shellSectorId,
      corporationId: shellCorpId,
      countryId: "US",
      stateId: "CA",
      sectorType: "extraction",
      revenue: 1_000_000,
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ sectorId: shellSectorId.toHexString() }), ctx());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/suspended/i);
    // No capture, no charge.
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("atomically transfers the quoted whole plants on success", async () => {
    const attackerCharId = new ObjectId();
    const attackerCorpId = new ObjectId();
    const defenderCorpId = new ObjectId();
    const targetSectorId = new ObjectId();
    const attacker = {
      _id: attackerCorpId,
      ceoId: attackerCharId,
      name: "Attacker Corp",
      liquidCapital: 1_000_000,
      marketingStrength: 200,
      countryId: "US",
      liquidCurrencyCode: "USD",
    };
    const defender = {
      _id: defenderCorpId,
      name: "Defender Corp",
      liquidCapital: 1_000_000,
      marketingStrength: 100,
      countryId: "US",
      liquidCurrencyCode: "USD",
    };
    const target = {
      _id: targetSectorId,
      corporationId: defenderCorpId,
      countryId: "US",
      stateId: "CA",
      sectorType: "energy",
      strategyId: "standard",
      revenue: 1_000_000,
      capitalStock: 1_000,
      capacityBookAnchor: 1_000_000,
      plantCount: 100,
      plantUnitRemainder: 0,
    };
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 511,
    });
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: new ObjectId(),
      activeCharacterType: "regular",
    });
    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({ _id: attackerCharId } as never);
    db.collectionMocks.corporations.findOne
      .mockResolvedValueOnce(attacker)
      .mockResolvedValueOnce(defender)
      .mockResolvedValueOnce(attacker)
      .mockResolvedValueOnce(defender);
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.corporateSectors.findOne
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(null);
    db.collectionMocks.corporateSectors.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.corporateSectors.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ sectorId: targetSectorId.toHexString() }), ctx());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      splitSucceeded: true,
      plantsAtRisk: 25,
      plantsTransferred: 25,
      attackCost: 125_000,
      msCost: 14,
    });
    expect(db.collectionMocks.corporations.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: attackerCorpId }),
      expect.objectContaining({
        $inc: expect.objectContaining({ liquidCapital: -125_000, marketingStrength: -14 }),
      }),
      expect.any(Object)
    );
    expect(db.collectionMocks.corporateSectors.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: targetSectorId, plantCount: 100 }),
      expect.objectContaining({
        $set: expect.objectContaining({
          plantCount: 75,
          capitalStock: 750,
          capacityBookAnchor: 750_000,
        }),
      }),
      expect.any(Object)
    );
    expect(db.collectionMocks.corporateSectors.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        corporationId: attackerCorpId,
        plantCount: 25,
        capitalStock: 250,
        capacityBookAnchor: 250_000,
      }),
      expect.any(Object)
    );
    expect(withTransaction).toHaveBeenCalledTimes(1);
  });

  it("survives a stale-session ConflictingOperationInProgress (117) and retries on a fresh session", async () => {
    const attackerCharId = new ObjectId();
    const attackerCorpId = new ObjectId();
    const defenderCorpId = new ObjectId();
    const targetSectorId = new ObjectId();
    const attacker = {
      _id: attackerCorpId,
      ceoId: attackerCharId,
      name: "Attacker Corp",
      liquidCapital: 1_000_000,
      marketingStrength: 200,
      countryId: "US",
      liquidCurrencyCode: "USD",
    };
    const defender = {
      _id: defenderCorpId,
      name: "Defender Corp",
      liquidCapital: 1_000_000,
      marketingStrength: 100,
      countryId: "US",
      liquidCurrencyCode: "USD",
    };
    const target = {
      _id: targetSectorId,
      corporationId: defenderCorpId,
      countryId: "US",
      stateId: "CA",
      sectorType: "energy",
      strategyId: "standard",
      revenue: 1_000_000,
      capitalStock: 1_000,
      capacityBookAnchor: 1_000_000,
      plantCount: 100,
      plantUnitRemainder: 0,
    };
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 511,
    });
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: new ObjectId(),
      activeCharacterType: "regular",
    });
    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({ _id: attackerCharId } as never);
    db.collectionMocks.corporations.findOne
      .mockResolvedValueOnce(attacker)
      .mockResolvedValueOnce(defender)
      .mockResolvedValueOnce(attacker)
      .mockResolvedValueOnce(defender);
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.corporateSectors.findOne
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(null);
    db.collectionMocks.corporateSectors.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.corporateSectors.insertOne.mockResolvedValue({
      insertedId: new ObjectId(),
    });

    // First session is poisoned: transaction start fails with Mongo code 117
    // (ConflictingOperationInProgress). The wrapper must open a fresh session
    // and retry, with the callback only actually running on the good session.
    const poisonedSession = {
      withTransaction: vi.fn().mockRejectedValue({
        code: 117,
        message:
          "Only servers in a sharded cluster can start a new transaction at the active transaction number",
      }),
      endSession: vi.fn().mockResolvedValue(undefined),
    };
    const { getMongoClient } = await import("@/lib/mongodb");
    vi.mocked(getMongoClient).mockResolvedValue({
      startSession: vi.fn().mockReturnValueOnce(poisonedSession).mockReturnValueOnce(makeSession()),
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ sectorId: targetSectorId.toHexString() }), ctx());
    const data = await response.json();

    // The stale session must not surface as a 500; the retry commits the split.
    expect(response.status).toBe(200);
    expect(data).toMatchObject({ splitSucceeded: true, plantsTransferred: 25 });
    expect(poisonedSession.withTransaction).toHaveBeenCalledTimes(1);
    expect(poisonedSession.endSession).toHaveBeenCalledTimes(1);
    expect(withTransaction).toHaveBeenCalledTimes(1);

    // Restore the shared mock so later tests get the default session factory.
    vi.mocked(getMongoClient).mockResolvedValue({
      startSession: () => makeSession(),
    } as never);
  });

  it("spends the quoted cash and MS on failure without moving plants", async () => {
    const { randomInt } = await import("node:crypto");
    vi.mocked(randomInt as unknown as () => number).mockReturnValue(999_999_999);
    const attackerCharId = new ObjectId();
    const attackerCorpId = new ObjectId();
    const defenderCorpId = new ObjectId();
    const targetSectorId = new ObjectId();
    const attacker = {
      _id: attackerCorpId,
      ceoId: attackerCharId,
      name: "Attacker Corp",
      liquidCapital: 1_000_000,
      marketingStrength: 100,
      countryId: "US",
      liquidCurrencyCode: "USD",
    };
    const defender = {
      _id: defenderCorpId,
      name: "Defender Corp",
      marketingStrength: 100,
      countryId: "US",
    };
    const target = {
      _id: targetSectorId,
      corporationId: defenderCorpId,
      countryId: "US",
      stateId: "CA",
      sectorType: "energy",
      revenue: 1_000_000,
      capitalStock: 1_000,
      capacityBookAnchor: 1_000_000,
      plantCount: 100,
    };
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 511 });
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
    });
    db.collectionMocks.users.findOne.mockResolvedValue({ activeCharacterType: "regular" });
    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({ _id: attackerCharId } as never);
    db.collectionMocks.corporations.findOne
      .mockResolvedValueOnce(attacker)
      .mockResolvedValueOnce(defender)
      .mockResolvedValueOnce(attacker)
      .mockResolvedValueOnce(defender);
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.corporateSectors.findOne
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(target);

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ sectorId: targetSectorId.toHexString() }), ctx());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ splitSucceeded: false, plantsTransferred: 0 });
    expect(db.collectionMocks.corporations.updateOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.corporateSectors.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporateSectors.insertOne).not.toHaveBeenCalled();
  });
});
