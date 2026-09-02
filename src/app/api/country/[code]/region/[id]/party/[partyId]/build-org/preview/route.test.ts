import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", async () => {
  const actual = await vi.importActual<object>("@/lib/db/partyLookup");
  return { ...actual, findPartyBySequentialId: vi.fn() };
});
vi.mock("@/lib/turn/partyOrg/presence", () => ({ checkPartyPresence: vi.fn() }));

function makeRequest() {
  return new Request("http://localhost/api/country/us/region/CA/party/1/build-org/preview");
}

const partyId = "1";
const stateId = "CA";

describe("GET /api/country/[code]/region/[id]/party/[partyId]/build-org/preview", () => {
  let db: MockDb;
  let stateChairId: ObjectId;
  let spenderRowId: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("statePartyOrg");
    db.collection("partyStrengthPressure");
    db.collection("orgRegLedger");
    db.collection("partyPoliticalStrengthLedger");
    stateChairId = new ObjectId();
    spenderRowId = `${stateId}_${partyId}`;

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "stateChair",
        isAdmin: false,
        character: { _id: stateChairId, name: "State Chair" },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      treasury: 50_000_000,
      countryId: "US",
      name: "Test Party",
      chairId: new ObjectId(),
      viceChairId: new ObjectId(),
    } as never);

    // Default: party has live presence in the state.
    const { checkPartyPresence } = await import("@/lib/turn/partyOrg/presence");
    vi.mocked(checkPartyPresence).mockResolvedValue(true);

    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: spenderRowId,
      stateId,
      partyId,
      countryId: "US",
      organization: 20,
      politicalStrength: 10,
      treasury: 10_000_000,
      hasPresence: true,
      chairId: stateChairId,
      viceChairId: new ObjectId(),
    });
    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: spenderRowId,
          stateId,
          partyId,
          countryId: "US",
          organization: 20,
          politicalStrength: 10,
          treasury: 10_000_000,
        },
        {
          _id: `${stateId}_2`,
          stateId,
          partyId: "2",
          countryId: "US",
          organization: 30,
          politicalStrength: 8,
          treasury: 10_000_000,
        },
      ],
    } as never);
    db.collectionMocks["partyStrengthPressure"]!.findOne.mockResolvedValue({
      _id: `US_${partyId}_${stateId}`,
      countryId: "US",
      partyId,
      stateId,
      value: 1,
      lastUpdatedTurn: 100,
    });
  });

  it("returns ok=true with effective cost + projected gain + factors", async () => {
    const { GET } = await import("./route");
    const response = await GET(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.effectiveCost).toBeGreaterThanOrEqual(1);
    expect(body.projectedGain).toBeGreaterThan(0);
    expect(body.factors).toMatchObject({
      base: expect.any(Number),
      headroom: expect.any(Number),
      ownDiminishing: expect.any(Number),
      psLeverage: expect.any(Number),
      catchup: expect.any(Number),
    });
    expect(body.scope).toBe("state");
    expect(body.pressureValue).toBe(1);
  });

  it("returns ok=true with poaches in a saturated state with PS-weak rivals", async () => {
    // Saturated (60 + 20 + 20 = 100, no pool); spender PS 29 dominates rivals
    // (6, 4) → Build Org projects a poach-only gain.
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: spenderRowId,
      stateId,
      partyId,
      countryId: "US",
      organization: 60,
      politicalStrength: 29,
      treasury: 10_000_000,
      hasPresence: true,
      chairId: stateChairId,
    });
    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: spenderRowId,
          stateId,
          partyId,
          countryId: "US",
          organization: 60,
          politicalStrength: 29,
          treasury: 10_000_000,
        },
        {
          _id: `${stateId}_2`,
          stateId,
          partyId: "2",
          countryId: "US",
          organization: 20,
          politicalStrength: 6,
          treasury: 10_000_000,
        },
        {
          _id: `${stateId}_3`,
          stateId,
          partyId: "3",
          countryId: "US",
          organization: 20,
          politicalStrength: 4,
          treasury: 10_000_000,
        },
      ],
    } as never);

    const { GET } = await import("./route");
    const response = await GET(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.projectedGain).toBeGreaterThan(0);
    expect(body.poaches).toHaveLength(2);
  });

  it("returns ok=false reason=no-presence when there is no live presence", async () => {
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: spenderRowId,
      stateId,
      partyId,
      countryId: "US",
      organization: 0,
      politicalStrength: 10,
      treasury: 10_000_000,
      hasPresence: false,
      chairId: stateChairId,
    });
    const { checkPartyPresence } = await import("@/lib/turn/partyOrg/presence");
    vi.mocked(checkPartyPresence).mockResolvedValue(false);
    const { GET } = await import("./route");
    const response = await GET(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("no-presence");
  });

  it("returns ok=false reason=auth for a cross-country viewer", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "ccpChair",
        isAdmin: false,
        character: { _id: new ObjectId(), name: "Jiang Zemin", countryId: "CN" },
      },
    } as never);
    const { GET } = await import("./route");
    const response = await GET(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("auth");
    expect(body.message).toMatch(/another country/i);
  });

  it("returns ok=true with a virtual 0% row when party has presence but no seeded row", async () => {
    // CDU-in-Bayern shape: no seeded row, but live presence + national chair.
    // Preview must project from a virtual 0% row WITHOUT mutating anything.
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: `${stateId}_2`,
          stateId,
          partyId: "2",
          countryId: "US",
          organization: 30,
          politicalStrength: 8,
          treasury: 10_000_000,
        },
      ],
    } as never);
    const nationalChairId = new ObjectId();
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      treasury: 50_000_000,
      countryId: "US",
      name: "Test Party",
      chairId: nationalChairId,
      viceChairId: new ObjectId(),
    } as never);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "natchair",
        isAdmin: false,
        character: { _id: nationalChairId, name: "Nat Chair" },
      },
    } as never);

    const { GET } = await import("./route");
    const response = await GET(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.scope).toBe("national-targeted");
    expect(body.projectedGain).toBeGreaterThan(0);

    // Read-only invariant preserved even on the bootstrap-preview path.
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["statePartyOrg"]!.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("returns ok=false reason=no-headroom when saturated AND no rival holds Org", async () => {
    // Under the Org+PS poach blend a rival out-reserving the spender is no longer
    // immune; the only no-headroom case is an empty pool with no poachable rival
    // Org (spender holds 100%).
    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: spenderRowId,
          stateId,
          partyId,
          countryId: "US",
          organization: 100,
          politicalStrength: 10,
          treasury: 10_000_000,
        },
        {
          _id: `${stateId}_2`,
          stateId,
          partyId: "2",
          countryId: "US",
          organization: 0, // no Org → not a poachable rival
          politicalStrength: 10,
          treasury: 10_000_000,
        },
      ],
    } as never);
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: spenderRowId,
      stateId,
      partyId,
      countryId: "US",
      organization: 100,
      politicalStrength: 10,
      treasury: 10_000_000,
      hasPresence: true,
      chairId: stateChairId,
    });
    const { GET } = await import("./route");
    const response = await GET(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("no-headroom");
  });

  it("returns scope=national-targeted when actor is national chair", async () => {
    const nationalChairId = new ObjectId();
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      treasury: 50_000_000,
      countryId: "US",
      name: "Test Party",
      chairId: nationalChairId,
      viceChairId: new ObjectId(),
    } as never);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "natchair",
        isAdmin: false,
        character: { _id: nationalChairId, name: "Nat Chair" },
      },
    } as never);
    const { GET } = await import("./route");
    const response = await GET(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.scope).toBe("national-targeted");
  });

  it("does NOT mutate any collection (no-mutation invariant)", async () => {
    const { GET } = await import("./route");
    await GET(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["statePartyOrg"]!.findOneAndUpdate).not.toHaveBeenCalled();
    expect(db.collectionMocks["orgRegLedger"]!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["partyPoliticalStrengthLedger"]!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["partyStrengthPressure"]!.updateOne).not.toHaveBeenCalled();
  });
});
