import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { planEuroSettlement } from "@/lib/currency/euro/rules";

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), getDb: vi.fn(), getGameState: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/gameState", () => ({ getGameState: mocks.getGameState }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: () => ({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
import { POST } from "./route";

const chair = new ObjectId();
let db: ReturnType<typeof createMockDb>;
function request(code = "UK") {
  return POST(
    new Request("http://localhost/api/country/UK/central-bank/forex-spread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strength: 1.2 }),
    }),
    { params: Promise.resolve({ code }) }
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.getGameState.mockResolvedValue({ currentTurn: 400 });
  mocks.requireAuth.mockResolvedValue({
    ok: true,
    user: { userId: "test-chair", isAdmin: false, character: { _id: chair, countryId: "IE" } },
  });
  const union = planEuroSettlement({
    year: 1999,
    turn: 385,
    preset: "1991-default",
    europeanMembers: ["DE", "IE", "UK"],
    consentedCountries: ["DE", "IE", "UK"],
    rates: { EUR: 0.85, IEP: 0.7, GBP: 0.6 },
  }).union;
  db.collection("gameState").findOne.mockResolvedValue({ euroMonetaryUnion: union });
  db.collection("centralBanks").findOne.mockImplementation(async ({ _id }: { _id: string }) => ({
    _id,
    chairCharacterId: chair,
  }));
  db.collection("exchangeRates").findOne.mockResolvedValue({ _id: "DE", forexSpreadStrength: 1 });
});
describe("common forex spread policy", () => {
  it("lets a common chair from another member set the anchor policy", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ currency: "EUR", strength: 1.2 });
    expect(db.collection("centralBanks").findOne).toHaveBeenCalledWith({ _id: "ECB" });
    expect(db.collection("exchangeRates").updateOne).toHaveBeenCalledWith(
      { _id: "DE" },
      expect.objectContaining({
        $set: expect.objectContaining({
          forexSpreadStrength: 1.2,
          forexSpreadStrengthLastChangedTurn: 400,
        }),
      })
    );
  });
  it("keeps the national governor out of common currency policy", async () => {
    db.collection("centralBanks").findOne.mockImplementation(async ({ _id }: { _id: string }) => ({
      _id,
      chairCharacterId: _id === "ECB" ? new ObjectId() : chair,
    }));
    expect((await request()).status).toBe(403);
    expect(db.collection("exchangeRates").updateOne).not.toHaveBeenCalled();
  });
  it("uses the same anchor cooldown from every member route", async () => {
    db.collection("exchangeRates").findOne.mockResolvedValue({
      _id: "DE",
      forexSpreadStrengthLastChangedTurn: 399,
    });
    for (const code of ["DE", "IE", "UK"]) expect((await request(code)).status).toBe(400);
    expect(db.collection("exchangeRates").updateOne).not.toHaveBeenCalled();
  });
  it("rejects a common chair whose citizenship is outside the currency area", async () => {
    mocks.requireAuth.mockResolvedValue({
      ok: true,
      user: { userId: "test-chair", character: { _id: chair, countryId: "US" } },
    });
    expect((await request()).status).toBe(403);
    expect(db.collection("exchangeRates").updateOne).not.toHaveBeenCalled();
  });
});
