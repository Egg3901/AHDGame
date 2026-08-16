import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  corpLiquidCapitalToAnchor: vi.fn((v: number) => v),
  fxRateForCorpFromMap: vi.fn(() => 1),
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
  resolveCorpLiquidCurrencyCode: vi.fn().mockReturnValue("USD"),
}));
vi.mock("@/lib/currency/corpEconomyFields", () => ({
  readCorpEconomicAnchor: vi.fn((v: number) => v),
}));

let db: MockDb;

function makeRequest(query: string) {
  return new Request(`http://localhost/api/corporations/1/expand-suggestions?${query}`);
}

const ctx = () => ({ params: Promise.resolve({ id: "1" }) });

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("states");
  db.collection("corporateSectors");
  db.collection("unownedSectors");
  db.collection("corporations");
  db.collection("gameConfig");
  db.collection("gameState");
  db.collection("federalBudget");
  db.collection("macroMetrics");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: "user1" },
  } as never);

  const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  const corpId = new ObjectId();
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: {
      _id: corpId,
      userId: "user1",
      countryId: "US",
      type: "energy",
      secondaryType: "defense",
      marketingStrength: 0,
      liquidCapital: 1_000_000,
    },
  } as never);
  vi.mocked(requireCeo).mockReturnValue(null);
});

describe("GET /api/corporations/[id]/expand-suggestions (mode=unowned)", () => {
  it("serves plants suggestions for an off-type sector (any type is buildable)", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "plants",
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 10,
      currentYear: 1953,
    });
    db.collectionMocks.unownedSectors.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi
        .fn()
        .mockResolvedValue([
          { stateId: "CA", sectorType: "retail", revenue: 1000, headroomUnits: 1000 },
        ]),
    });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "CA", name: "California", countryId: "US" }]),
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.macroMetrics.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { GET } = await import("./route");
    const response = await GET(makeRequest("sectorType=retail&mode=unowned"), ctx());

    expect(response.status).toBe(200);
  });

  it("returns foreign markets under plants — cross-border founding is buildable", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "plants",
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 10,
      currentYear: 1953,
    });
    db.collectionMocks.unownedSectors.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        { stateId: "CA", sectorType: "energy", revenue: 1000, headroomUnits: 1000 },
        { stateId: "ENG", sectorType: "energy", revenue: 2000, headroomUnits: 2000 },
      ]),
    });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "CA", name: "California", countryId: "US" },
        { _id: "ENG", name: "England", countryId: "UK" },
      ]),
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.macroMetrics.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { GET } = await import("./route");
    const response = await GET(makeRequest("sectorType=energy&mode=unowned"), ctx());
    const data = await response.json();

    expect(response.status).toBe(200);
    // Both the home (CA/US) and foreign (ENG/UK) markets are offered now.
    expect((data.suggestions as { stateId: string }[]).map((row) => row.stateId).sort()).toEqual([
      "CA",
      "ENG",
    ]);
    expect(data.availableCountries).toEqual(["UK", "US"]);
  });

  it("excludes command-economy states (RU) from unowned-market suggestions and country chips", async () => {
    db.collectionMocks.unownedSectors.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        { stateId: "CA", sectorType: "energy", revenue: 1000 },
        { stateId: "UKR", sectorType: "energy", revenue: 5000 },
      ]),
    });

    // Second call onward (post `stateIds` resolution) needs the full docs.
    db.collectionMocks.states.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "CA", name: "California", countryId: "US" },
        { _id: "UKR", name: "Ukraine", countryId: "RU" },
      ]),
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { GET } = await import("./route");
    const response = await GET(makeRequest("sectorType=energy&mode=unowned"), ctx());
    const data = await response.json();

    expect(response.status).toBe(200);
    const stateIds = (data.suggestions as { stateId: string }[]).map((s) => s.stateId);
    expect(stateIds).toContain("CA");
    expect(stateIds).not.toContain("UKR");
    expect(data.availableCountries).toEqual(["US"]);
  });

  it("returns no suggestions (not an error) when every candidate state is command-economy", async () => {
    db.collectionMocks.unownedSectors.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ stateId: "UKR", sectorType: "energy", revenue: 5000 }]),
    });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "UKR", name: "Ukraine", countryId: "RU" }]),
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { GET } = await import("./route");
    const response = await GET(makeRequest("sectorType=energy&mode=unowned"), ctx());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.suggestions).toEqual([]);
    expect(data.availableCountries).toEqual([]);
  });

  it("pins a below-top-N state into the returned suggestions when ?state= is set", async () => {
    const rows = [
      { stateId: "CA", sectorType: "defense", revenue: 68000, headroomUnits: 68000 },
      { stateId: "NY", sectorType: "defense", revenue: 34000, headroomUnits: 34000 },
      { stateId: "PA", sectorType: "defense", revenue: 23000, headroomUnits: 23000 },
      { stateId: "IL", sectorType: "defense", revenue: 21000, headroomUnits: 21000 },
      { stateId: "OH", sectorType: "defense", revenue: 19000, headroomUnits: 19000 },
      { stateId: "MD", sectorType: "defense", revenue: 14000, headroomUnits: 14000 },
    ];
    db.collectionMocks.unownedSectors.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(rows),
    });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(
        rows.map((r) => ({
          _id: r.stateId,
          name: r.stateId,
          countryId: "US",
        }))
      ),
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { GET } = await import("./route");
    const response = await GET(makeRequest("sectorType=defense&mode=unowned&state=MD"), ctx());
    const data = await response.json();

    expect(response.status).toBe(200);
    const stateIds = (data.suggestions as { stateId: string }[]).map((s) => s.stateId);
    expect(stateIds[0]).toBe("MD");
    expect(stateIds).toContain("CA");
    expect(stateIds).toHaveLength(5);
  });
});

describe("GET /api/corporations/[id]/expand-suggestions (mode=playerCorp)", () => {
  it("still surfaces competitor corporations operating in a command-economy state", async () => {
    const natCorpId = new ObjectId();

    // Three distinct `corporateSectors.find` calls happen for this mode:
    // (1) the initial competitor-states lookup (`corporationId: {$ne}`),
    // (2) `ownedSectors` for OUR corp (`corporationId: <ours>`), and
    // (3) `siblingCorpSectors` (no corporationId filter — everyone). Branch on
    // shape rather than a single static return so `ownedSectors` doesn't get
    // handed a doc missing `_id`.
    db.collectionMocks.corporateSectors.find.mockImplementation(
      (query: { corporationId?: { $ne?: unknown } } = {}) => {
        const chain = { project: vi.fn().mockReturnThis(), toArray: vi.fn() };
        if (query.corporationId && "$ne" in query.corporationId) {
          chain.toArray.mockResolvedValue([{ stateId: "UKR" }]);
        } else if (query.corporationId) {
          chain.toArray.mockResolvedValue([]); // our corp owns nothing here
        } else {
          chain.toArray.mockResolvedValue([
            { stateId: "UKR", corporationId: natCorpId, revenue: 9000 },
          ]);
        }
        return chain;
      }
    );
    db.collectionMocks.states.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "UKR", name: "Ukraine", countryId: "RU" }]),
    });
    db.collectionMocks.unownedSectors.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.corporations.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: natCorpId, name: "USSR State Energy Trust" }]),
    });

    const { GET } = await import("./route");
    const response = await GET(makeRequest("sectorType=energy&mode=playerCorp"), ctx());
    const data = await response.json();

    expect(response.status).toBe(200);
    const stateIds = (data.suggestions as { stateId: string }[]).map((s) => s.stateId);
    expect(stateIds).toContain("UKR");
    expect(data.availableCountries).toEqual(["RU"]);
  });
});
