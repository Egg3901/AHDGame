import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/db/partyLookup", async () => {
  const actual = await vi.importActual<object>("@/lib/db/partyLookup");
  return {
    ...actual,
    findPartyBySequentialId: vi.fn(),
  };
});
vi.mock("@/lib/turn/partyOrg/presence", () => ({ checkPartyPresence: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 100, effectiveNow: new Date() }),
}));

describe("GET /api/country/[code]/region/[id]/party/[partyId]", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of [
      "gameConfig",
      "states",
      "characters",
      "users",
      "npps",
      "statePartyOrg",
      "partyBudget",
      "elections",
    ]) {
      db.collection(name);
    }

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collectionMocks["gameConfig"]!.findOne.mockResolvedValue({ nppEconomyEnabled: false });
    db.collectionMocks["states"]!.findOne.mockResolvedValue({
      _id: "NW",
      countryId: "DD",
      name: "Nordrhein-Westfalen",
      population: 17_000_000,
      gdp: 700,
    });

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "DD",
      name: "SED",
      abbreviation: "SED",
      color: "#cc0000",
      economicPosition: -3,
      socialPosition: 0,
      isDefault: true,
    } as never);

    const { checkPartyPresence } = await import("@/lib/turn/partyOrg/presence");
    vi.mocked(checkPartyPresence).mockResolvedValue(true);

    // Default: budget lookups + elections come back empty.
    db.collectionMocks["partyBudget"]!.find.mockReturnValue({
      toArray: async () => [],
    } as never);
    db.collectionMocks["elections"]?.find?.mockReturnValue?.({
      toArray: async () => [],
    } as never);
  });

  it("returns organization 0 when no statePartyOrg row exists", async () => {
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: async () => [],
    } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ code: "dd", id: "NW", partyId: "1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stateParty.organization).toBe(0);
  });

  it("resolves the party's org through the compound _id when the row drifted (ticket #1256)", async () => {
    // Post-reunification live shape: SED's row carries partyId "1" in its
    // fields but its compound _id still says CA-era "NW_7". The party page
    // used to probe _id NW_1 only, miss, and show 0 (or a rival's number)
    // while the state's org breakdown showed the party's real 36.8.
    const drifted = {
      _id: "NW_7",
      countryId: "DD",
      stateId: "NW",
      partyId: "1",
      organization: 36.76,
      treasury: 800,
      politicalStrength: 12,
      stateTaxRate: 5,
    };
    db.collectionMocks["statePartyOrg"]!.findOne.mockImplementation(
      async (filter: Record<string, unknown>) =>
        filter._id === "NW_7" || filter.partyId === "1" ? drifted : null
    );
    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: async () => [drifted],
    } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ code: "dd", id: "NW", partyId: "1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    // The page shows the party's real org, not 0.
    expect(body.stateParty.organization).toBe(36.76);
    expect(body.stateParty.partyId).toBe("1");
  });
});
