import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
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
    expect(data.error).toMatch(/unowned/i);
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
});
