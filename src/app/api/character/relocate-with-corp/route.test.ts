import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(
    () => new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 })
  ),
}));
vi.mock("@/lib/countryAccess", () => ({
  getCountryAccess: vi.fn().mockResolvedValue({ enabledForPlayers: true, status: "active" }),
}));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({
    effectiveNow: new Date("2026-01-15T12:00:00.000Z"),
    currentTurn: 100,
    lastTurnProcessed: new Date("2026-01-15T11:00:00.000Z"),
  }),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  corpLiquidCapitalToAnchor: vi.fn((v: number) => v),
  anchorToCorpLiquidCapital: vi.fn((v: number) => v),
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map([["USD", 1]])),
  fxRateForCorpFromMap: vi.fn(() => 1),
  resolveCorpLiquidCurrencyCode: vi.fn(
    (corp: { liquidCurrencyCode?: string } | null | undefined) =>
      corp?.liquidCurrencyCode ?? undefined
  ),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/corporations/convertCorpCurrency", () => ({
  convertCorpCurrency: vi.fn().mockResolvedValue({ ok: true, converted: false }),
}));
vi.mock("@/lib/wireEvent", () => ({ logWireEvent: vi.fn() }));
vi.mock("@/lib/character/performRelocation", () => ({
  performRelocation: vi.fn().mockResolvedValue({
    resignedFromOffice: null,
    ceoResignedFrom: null,
    chairResignedFrom: null,
    leftPartyName: null,
    clearedStateLeadership: [],
    withdrawnGeneralElections: 0,
    withdrawnStatePartyElections: 0,
    withdrawnNationalPartyElections: 0,
    withdrawnCommitteeElections: 0,
    countryChanged: false,
  }),
}));
vi.mock("@/lib/corporations/issueRelocationBond", () => ({
  previewRelocationBond: vi.fn(),
  issueRelocationBond: vi.fn(),
}));

let db: MockDb;

function stubAuth(user: {
  userId: string;
  characterId: ObjectId;
  countryId: string;
  homeState: string;
  isAdmin?: boolean;
}) {
  return {
    ok: true as const,
    user: {
      userId: user.userId,
      isAdmin: user.isAdmin ?? false,
      character: {
        _id: user.characterId,
        userId: new ObjectId(user.userId),
        homeState: user.homeState,
        countryId: user.countryId,
        lastRelocatedAt: null,
      },
    },
  };
}

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("states");
  db.collection("corporations");
});

async function setupDb() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);
}

describe("POST /api/character/relocate-with-corp", () => {
  it("rejects when character is not an active CEO", async () => {
    await setupDb();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      stubAuth({ userId, characterId: charId, countryId: "US", homeState: "CA" }) as never
    );
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "TX",
      name: "Texas",
      countryId: "US",
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/character/relocate-with-corp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetStateId: "TX", paymentMethod: "cash" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/not a CEO/i);
  });

  it("rejects without mutation when home state no longer matches HQ (stale CEO)", async () => {
    // findActiveResidentCeoCorporation must NOT vacate on this path (bug #0813):
    // vacating on a route that returns 400 is a side-effect-on-read antipattern.
    await setupDb();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();
    const corpId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      stubAuth({ userId, characterId: charId, countryId: "US", homeState: "CA" }) as never
    );
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "TX",
      name: "Texas",
      countryId: "US",
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      name: "MovedCo",
      countryId: "US",
      headquartersState: "NC",
      ceoId: charId,
      ceoType: "character",
      ceoVacant: false,
      liquidCapital: 100_000_000,
      liquidCurrencyCode: "USD",
      sharePrice: 10,
      totalShares: 1_000_000,
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/character/relocate-with-corp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetStateId: "TX", paymentMethod: "cash" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/not a CEO/i);
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("same-country cash move: runs performRelocation with skipCeoResignForCorpId", async () => {
    await setupDb();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();
    const corpId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      stubAuth({ userId, characterId: charId, countryId: "US", homeState: "CA" }) as never
    );
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as never);
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "TX",
      name: "Texas",
      countryId: "US",
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      name: "TestCorp",
      countryId: "US",
      headquartersState: "CA",
      ceoId: charId,
      ceoType: "character",
      ceoVacant: false,
      liquidCapital: 100_000_000,
      liquidCurrencyCode: "USD",
      sharePrice: 10,
      totalShares: 1_000_000,
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/character/relocate-with-corp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetStateId: "TX", paymentMethod: "cash" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.corporation.cost).toBe(700_000);
    expect(data.corporation.crossCountry).toBe(false);
    expect(data.character.homeState).toBe("TX");
    const { performRelocation } = await import("@/lib/character/performRelocation");
    expect(vi.mocked(performRelocation)).toHaveBeenCalled();
    const call = vi.mocked(performRelocation).mock.calls[0];
    expect(call[3]).toMatchObject({ skipCeoResignForCorpId: corpId });
  });

  it("cross-country cash move: doubles cost, updates countryId", async () => {
    await setupDb();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();
    const corpId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      stubAuth({ userId, characterId: charId, countryId: "US", homeState: "CA" }) as never
    );
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as never);
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "LON",
      name: "London",
      countryId: "UK",
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      name: "TestCorp",
      countryId: "US",
      headquartersState: "CA",
      ceoId: charId,
      ceoType: "character",
      ceoVacant: false,
      liquidCapital: 100_000_000,
      liquidCurrencyCode: "USD",
      sharePrice: 10,
      totalShares: 1_000_000,
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/character/relocate-with-corp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `targetCountryId` is what makes this cross-country. Without it the route
      // falls back to the character's own countryId (US) and looks LON up as a
      // US state. This passed before only because the mocked `findOne` ignores
      // the countryId filter and handed back the UK doc anyway, so the case
      // never exercised the real cross-country path.
      body: JSON.stringify({
        targetStateId: "LON",
        targetCountryId: "UK",
        paymentMethod: "cash",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.corporation.cost).toBe(1_400_000);
    expect(data.corporation.crossCountry).toBe(true);
    expect(data.corporation.newCountryId).toBe("UK");
  });

  it("imperial CEO: paymentMethod 'imperial-free' succeeds at zero cost", async () => {
    await setupDb();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();
    const corpId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      stubAuth({ userId, characterId: charId, countryId: "US", homeState: "CA" }) as never
    );
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as never);
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "TX",
      name: "Texas",
      countryId: "US",
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      name: "ImperialCo",
      countryId: "US",
      headquartersState: "CA",
      ceoId: charId,
      ceoType: "imperial",
      ceoVacant: false,
      liquidCapital: 50_000_000,
      liquidCurrencyCode: "USD",
      sharePrice: 10,
      totalShares: 1_000_000,
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/character/relocate-with-corp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetStateId: "TX", paymentMethod: "imperial-free" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.corporation.cost).toBe(0);
    expect(data.corporation.paymentMethod).toBe("imperial-free");
  });

  it("imperial-free rejected for non-imperial CEO", async () => {
    await setupDb();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();
    const corpId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      stubAuth({ userId, characterId: charId, countryId: "US", homeState: "CA" }) as never
    );
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "TX",
      name: "Texas",
      countryId: "US",
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      name: "PlainCo",
      countryId: "US",
      headquartersState: "CA",
      ceoId: charId,
      ceoType: "character",
      ceoVacant: false,
      liquidCapital: 50_000_000,
      liquidCurrencyCode: "USD",
      sharePrice: 10,
      totalShares: 1_000_000,
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/character/relocate-with-corp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetStateId: "TX", paymentMethod: "imperial-free" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
