import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { planEuroSettlement } from "@/lib/currency/euro/rules";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { GET, POST } from "./route";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: () => ({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: async () => 400 }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn().mockResolvedValue(undefined) }));

const chairId = new ObjectId();
const context = { params: Promise.resolve({ code: "UK" }) };
let db: ReturnType<typeof createMockDb>;
function request() {
  return new Request("http://localhost/api/country/UK/central-bank/fx-regime", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ regime: "float", capitalControls: false }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { userId: "chair", username: "chair", character: { _id: chairId, name: "Chair" } },
  } as never);
  const union = planEuroSettlement({
    year: 1999,
    turn: 385,
    preset: "1991-default",
    europeanMembers: ["DE", "IE", "UK"],
    consentedCountries: ["DE", "IE", "UK"],
    rates: { EUR: 0.85, IEP: 0.7, GBP: 0.6 },
  }).union;
  db.collection("gameState").findOne.mockResolvedValue({ euroMonetaryUnion: union });
  db.collection("centralBanks").findOne.mockResolvedValue({
    _id: "ECB",
    chairCharacterId: chairId,
  });
  db.collection("exchangeRates").findOne.mockResolvedValue({ countryId: "DE", fxRegime: "float" });
});

describe("euro FX regime", () => {
  it("reads the common currency regime from a member's page", async () => {
    const response = await GET(new Request("http://localhost"), context);
    expect(response.status).toBe(200);
    expect(db.collectionMocks.exchangeRates.findOne).toHaveBeenCalledWith({ countryId: "DE" });
  });
  it("lets the common chair change only the common FX record", async () => {
    expect((await POST(request(), context)).status).toBe(200);
    expect(db.collectionMocks.centralBanks.findOne).toHaveBeenCalledWith(
      { _id: "ECB" },
      expect.anything()
    );
    expect(db.collectionMocks.exchangeRates.updateOne).toHaveBeenCalledWith(
      { countryId: "DE" },
      expect.anything()
    );
  });
  it.each(["different-chair", "locked"])(
    "rejects %s without a national policy escape",
    async (reason) => {
      db.collection("centralBanks").findOne.mockResolvedValue({
        _id: "ECB",
        chairCharacterId: reason === "locked" ? chairId : new ObjectId(),
        chairControlsLocked: reason === "locked",
      });
      expect((await POST(request(), context)).status).toBe(403);
      expect(db.collectionMocks.exchangeRates.updateOne).not.toHaveBeenCalled();
    }
  );
});

describe("declared peg lifecycle", () => {
  function declare(regime: string, pegTarget?: number) {
    return POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regime, capitalControls: false, pegTarget }),
      }),
      context
    );
  }
  it("prepares funded point defence with the authenticated actor before the first turn", async () => {
    expect((await declare("peg", 0.5)).status).toBe(200);
    const set = db.collectionMocks.exchangeRates.updateOne.mock.calls[0][1].$set;
    expect(set.interventionPolicy).toMatchObject({
      floor: 0.5,
      ceiling: 0.5,
      setByCharacterId: chairId,
      setByCharacterName: "Chair",
      setAtTurn: 400,
      lastAdjustedAtTurn: 400,
      recentInterventions: [],
    });
    expect(set).not.toHaveProperty("rate");
    expect(set).not.toHaveProperty("hardPeg");
  });
  it("preserves the audit log and ongoing failure when changing a peg target", async () => {
    const records = [
      {
        turn: 350,
        direction: "buy",
        reservesSpent: 5,
        fundingSource: "forexRevenue",
        resultingRate: 0.6,
      },
    ];
    db.collection("exchangeRates").findOne.mockResolvedValue({
      countryId: "DE",
      fxRegime: "peg",
      pegTarget: 0.5,
      interventionPolicy: {
        floor: 0.5,
        ceiling: 0.5,
        recentInterventions: records,
        lastInfamyChargedAtTurn: 350,
      },
    });
    expect((await declare("peg", 0.6)).status).toBe(200);
    expect(
      db.collectionMocks.exchangeRates.updateOne.mock.calls[0][1].$set.interventionPolicy
    ).toMatchObject({
      floor: 0.6,
      ceiling: 0.6,
      recentInterventions: records,
      lastInfamyChargedAtTurn: 350,
    });
  });
  it.each(["float", "band"])(
    "clears point defence when exiting to %s without inventing a corridor",
    async (regime) => {
      db.collection("exchangeRates").findOne.mockResolvedValue({
        countryId: "DE",
        fxRegime: "peg",
        pegTarget: 0.5,
        interventionPolicy: { floor: 0.5, ceiling: 0.5, recentInterventions: [] },
      });
      expect((await declare(regime)).status).toBe(200);
      expect(db.collectionMocks.exchangeRates.updateOne.mock.calls[0][1].$unset).toEqual({
        interventionPolicy: "",
      });
    }
  );
  it.each(["float", "band", "peg"])(
    "keeps the 48-turn regime commitment before switching to %s",
    async (regime) => {
      db.collection("exchangeRates").findOne.mockResolvedValue({
        countryId: "DE",
        fxRegime: "peg",
        fxRegimeSetAtTurn: 399,
      });
      expect((await declare(regime, 0.6)).status).toBe(409);
      expect(db.collectionMocks.exchangeRates.updateOne).not.toHaveBeenCalled();
    }
  );
});
