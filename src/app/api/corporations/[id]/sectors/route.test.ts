import { beforeEach, describe, expect, it, vi } from "vitest";
import { MongoServerError, ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
// Spread the real module so helpers the sector pipeline picks up later can't
// silently 500 the route; only the FX/currency seams are pinned to 1:1 USD.
vi.mock("@/lib/currency/corporationCapital", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/currency/corporationCapital")>()),
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  getSectorHostFxRate: vi.fn().mockResolvedValue(1),
  corpLiquidCapitalToAnchor: vi.fn((value: number) => value),
  anchorToCorpLiquidCapital: vi.fn((value: number) => value),
  resolveCorpLiquidCurrencyCode: vi.fn(() => "USD"),
}));
vi.mock("@/lib/currency/corpEconomyFields", () => ({
  writeCorpEconomicLocal: vi.fn((value: number) => value),
}));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("states");
  db.collection("corporateSectors");
  db.collection("corporations");
});

describe("POST /api/corporations/[id]/sectors", () => {
  it("uses the destination state's country for cross-border expansion rows", async () => {
    const corpId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: "user-1" },
    } as never);

    const { requireCorporationActionsEnabled } =
      await import("@/lib/api/requireCorporationActions");
    vi.mocked(requireCorporationActionsEnabled).mockResolvedValue(null);

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        countryId: "US",
        type: "energy",
        liquidCapital: 5_000_000,
        liquidCurrencyCode: "USD",
      },
    } as never);
    vi.mocked(requireCeo).mockReturnValue(null);

    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "CA",
      name: "Cross-Border Test State",
      countryId: "UK",
    });
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/corporations/1/sectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stateId: "CA" }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: "1" }) });

    expect(response.status).toBe(201);
    const insertedSector = db.collectionMocks.corporateSectors.insertOne.mock.calls[0]?.[0] as {
      countryId: string;
      stateId: string;
      sectorType: string;
    };
    expect(insertedSector.stateId).toBe("CA");
    expect(insertedSector.sectorType).toBe("energy");
    expect(insertedSector.countryId).toBe("UK");
  });

  it("returns a friendly error when the unique sector index loses a race", async () => {
    const corpId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: "user-1" },
    } as never);

    const { requireCorporationActionsEnabled } =
      await import("@/lib/api/requireCorporationActions");
    vi.mocked(requireCorporationActionsEnabled).mockResolvedValue(null);

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        countryId: "US",
        type: "energy",
        liquidCapital: 5_000_000,
        liquidCurrencyCode: "USD",
      },
    } as never);
    vi.mocked(requireCeo).mockReturnValue(null);

    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "CA",
      name: "Cross-Border Test State",
      countryId: "UK",
    });
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue(null);
    db.collectionMocks.corporateSectors.insertOne.mockRejectedValue(
      new MongoServerError({
        message:
          "E11000 duplicate key error collection: corporateSectors index: corporateSectors_corporationId_stateId_sectorType dup key",
        code: 11000,
        keyPattern: { corporationId: 1, stateId: 1, sectorType: 1 },
      })
    );

    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/corporations/1/sectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stateId: "CA" }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "You already have operations in this state",
    });
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  // ticket-1022: expand body used to reject every non-US id at the Zod layer
  // (`STATE_IDS` = US HOUSE_SEATS only), so UK mining founding never reached
  // the states lookup.
  it("accepts a UK region id such as Yorkshire (YHU)", async () => {
    const corpId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: "user-1" },
    } as never);

    const { requireCorporationActionsEnabled } =
      await import("@/lib/api/requireCorporationActions");
    vi.mocked(requireCorporationActionsEnabled).mockResolvedValue(null);

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        countryId: "UK",
        type: "extraction",
        liquidCapital: 5_000_000,
        liquidCurrencyCode: "GBP",
      },
    } as never);
    vi.mocked(requireCeo).mockReturnValue(null);

    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "YHU",
      name: "Yorkshire & the Humber",
      countryId: "UK",
    });
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/corporations/1/sectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stateId: "YHU" }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(201);
    const insertedSector = db.collectionMocks.corporateSectors.insertOne.mock.calls[0]?.[0] as {
      countryId: string;
      stateId: string;
      sectorType: string;
    };
    expect(insertedSector).toMatchObject({
      stateId: "YHU",
      countryId: "UK",
      sectorType: "extraction",
    });
  });
});
