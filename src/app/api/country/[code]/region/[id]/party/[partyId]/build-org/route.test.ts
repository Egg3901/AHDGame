import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { BUILD_ORG_BASE_PS_COST } from "@/lib/turn/politicalStrength/strengthConstants";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", async () => {
  const actual = await vi.importActual<object>("@/lib/db/partyLookup");
  return {
    ...actual,
    findPartyBySequentialId: vi.fn(),
  };
});
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/parties/commands/spendPoliticalStrength", () => ({
  spendPoliticalStrength: vi.fn(),
  NATIONAL_GEOGRAPHY_SENTINEL: "__national__",
}));
vi.mock("@/lib/turn/partyOrg/presence", () => ({ checkPartyPresence: vi.fn() }));
vi.mock("@/lib/parties/commands/chargeOrgBuildFunds", () => ({
  chargeOrgBuildFunds: vi.fn(),
}));

function makeRequest() {
  return new Request("http://localhost/api/country/us/region/CA/party/1/build-org", {
    method: "POST",
  });
}

function makeRequestWithBody(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/us/region/CA/party/1/build-org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const partyId = "1";
const stateId = "CA";

describe("POST /api/country/[code]/region/[id]/party/[partyId]/build-org", () => {
  let db: MockDb;
  let stateChairId: ObjectId;
  let spenderRowId: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("statePartyOrg");
    db.collection("orgRegLedger");
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

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as never);

    // Default: party has live presence in the state.
    const { checkPartyPresence } = await import("@/lib/turn/partyOrg/presence");
    vi.mocked(checkPartyPresence).mockResolvedValue(true);

    // Default: spender's state-party row found, sufficient state PS and a
    // treasury that fully funds the click's cash price.
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

    // All-rows query for gain calc — set up via toArray on the find mock.
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

    const { spendPoliticalStrength } =
      await import("@/lib/parties/commands/spendPoliticalStrength");
    vi.mocked(spendPoliticalStrength).mockResolvedValue({
      ok: true,
      effectiveCost: BUILD_ORG_BASE_PS_COST,
      newPoliticalStrength: 10 - BUILD_ORG_BASE_PS_COST,
      newPressure: 1,
    });

    // Default: the treasury covers the click in full.
    const { chargeOrgBuildFunds } = await import("@/lib/parties/commands/chargeOrgBuildFunds");
    vi.mocked(chargeOrgBuildFunds).mockImplementation(async (input) => ({
      charged: input.amount,
    }));
  });

  it("rejects invalid country code", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "zz", id: stateId, partyId }),
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 when party not found", async () => {
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(404);
  });

  it("bootstraps a 0% row and builds when party has presence but no row", async () => {
    // No seeded statePartyOrg row (e.g. CDU in Bayern), but the party has
    // live presence (default checkPartyPresence → true). A national chair
    // builds: the row is created at 0% Org and the build proceeds.
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: async () => [
        // Only a rival row exists in the state — spender has no row yet.
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

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.orgGain).toBeGreaterThan(0);

    // The row was bootstrapped at 0% via an upsert before the gain applied.
    const upsertCalls = db.collectionMocks["statePartyOrg"]!.updateOne.mock.calls.filter(
      (c) => c[2]?.upsert === true
    );
    expect(upsertCalls.length).toBeGreaterThan(0);
    // Newly-created row starts from 0% Org, so the post-build value equals the gain.
    expect(body.newOrg).toBeCloseTo(body.orgGain, 5);
  });

  it("returns nextPreview whose cost reflects the post-spend (escalated) pressure", async () => {
    // The estimate must not lag the pressure ladder during repeated building:
    // after this spend leaves the ladder at 2, the NEXT click's cost is
    // min(1 + 2, 8) = 3, and the POST hands that back so the client can show it
    // immediately without an async refetch.
    db.collection("partyStrengthPressure");
    db.collectionMocks["partyStrengthPressure"]!.findOne.mockResolvedValue({
      _id: `US_${partyId}_${stateId}`,
      value: 2,
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.nextPreview?.ok).toBe(true);
    expect(body.nextPreview.effectiveCost).toBe(3);
    expect(body.nextPreview.pressureValue).toBe(2);
  });

  it("returns 400 when party has no row AND no presence", async () => {
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue(null);
    const { checkPartyPresence } = await import("@/lib/turn/partyOrg/presence");
    vi.mocked(checkPartyPresence).mockResolvedValue(false);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/presence/i);
  });

  it("returns 400 when there is no live presence (foothold rule)", async () => {
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
    // No player or elected official in the state → live check returns false.
    const { checkPartyPresence } = await import("@/lib/turn/partyOrg/presence");
    vi.mocked(checkPartyPresence).mockResolvedValue(false);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/presence/i);
  });

  it("returns 403 for outsider", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "outsider",
        isAdmin: false,
        character: { _id: new ObjectId(), name: "Outsider" },
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(403);
  });

  it("rejects a character from a different country (403), even an admin", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "ccpChair",
        isAdmin: true, // admins are blocked too — guard precedes auth
        character: { _id: new ObjectId(), name: "Jiang Zemin", countryId: "CN" },
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/another country/i);
  });

  it("state campaigner can build org (Phase D auth)", async () => {
    const stateCampaignerId = new ObjectId();
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: spenderRowId,
      stateId,
      partyId,
      countryId: "US",
      organization: 20,
      politicalStrength: 10,
      treasury: 10_000_000,
      hasPresence: true,
      chairId: new ObjectId(),
      viceChairId: new ObjectId(),
      campaignerId: stateCampaignerId,
    });
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "campaigner",
        isAdmin: false,
        character: { _id: stateCampaignerId, name: "Campaigner" },
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);
  });

  it("national campaigner can build org cross-state, debits national PS pool", async () => {
    const nationalCampaignerId = new ObjectId();
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      treasury: 50_000_000,
      countryId: "US",
      name: "Test Party",
      chairId: new ObjectId(),
      viceChairId: new ObjectId(),
      campaignerIds: [nationalCampaignerId],
    } as never);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "natcampaigner",
        isAdmin: false,
        character: { _id: nationalCampaignerId, name: "Nat Campaigner" },
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);

    const { spendPoliticalStrength } =
      await import("@/lib/parties/commands/spendPoliticalStrength");
    expect(spendPoliticalStrength).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "national-targeted" }),
      expect.anything()
    );
  });

  it("national chair build-org debits the national PS pool", async () => {
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

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);

    const { spendPoliticalStrength } =
      await import("@/lib/parties/commands/spendPoliticalStrength");
    expect(spendPoliticalStrength).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "national-targeted", stateId }),
      expect.anything()
    );
  });

  it("state chair build-org debits the state PS pool (preserved behavior)", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);

    const { spendPoliticalStrength } =
      await import("@/lib/parties/commands/spendPoliticalStrength");
    expect(spendPoliticalStrength).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "state", stateId }),
      expect.anything()
    );
  });

  it("no body still works (state default) — backward compatible", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);
    const { spendPoliticalStrength } =
      await import("@/lib/parties/commands/spendPoliticalStrength");
    expect(spendPoliticalStrength).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "state" }),
      expect.anything()
    );
  });

  it("dual-role spender: psPool 'national' debits the national pool", async () => {
    const dualId = new ObjectId();
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      treasury: 50_000_000,
      countryId: "US",
      name: "Test Party",
      chairId: dualId, // national chair
      viceChairId: new ObjectId(),
    } as never);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "dual",
        isAdmin: false,
        character: { _id: dualId, name: "Dual" },
      },
    } as never);
    // Spender row has dualId as state chair too → dual-eligible.
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: spenderRowId,
      stateId,
      partyId,
      countryId: "US",
      organization: 20,
      politicalStrength: 10,
      treasury: 10_000_000,
      hasPresence: true,
      chairId: dualId,
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequestWithBody({ psPool: "national" }), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);
    const { spendPoliticalStrength } =
      await import("@/lib/parties/commands/spendPoliticalStrength");
    expect(spendPoliticalStrength).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "national-targeted" }),
      expect.anything()
    );
  });

  it("state-only chair requesting psPool 'national' is rejected with 403", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequestWithBody({ psPool: "national" }), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/national/i);
  });

  it("state treasurer cannot build org (Phase D auth — explicitly excluded)", async () => {
    const stateTreasurerId = new ObjectId();
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: spenderRowId,
      stateId,
      partyId,
      countryId: "US",
      organization: 20,
      politicalStrength: 10,
      treasury: 10_000_000,
      hasPresence: true,
      chairId: new ObjectId(),
      viceChairId: new ObjectId(),
      treasurerId: stateTreasurerId,
    });
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "treasurer",
        isAdmin: false,
        character: { _id: stateTreasurerId, name: "Treasurer" },
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(403);
  });

  it("returns 400 when saturated AND no rival holds any Org to poach", async () => {
    // Spender holds 100% of the Org (no pool, no rival with Org > 0) → nothing to
    // poach, nothing to build. Under the Org+PS poach blend a rival merely
    // out-reserving the spender is NO LONGER immune (it still exposes Org by
    // size), so the only true no-headroom case is an empty pool with no rival Org.
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

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/nothing to build|poachable/i);
  });

  it("returns 400 with 'insufficient PS' when spend fails", async () => {
    const { spendPoliticalStrength } =
      await import("@/lib/parties/commands/spendPoliticalStrength");
    vi.mocked(spendPoliticalStrength).mockResolvedValue({
      ok: false,
      reason: "insufficient-ps",
      effectiveCost: 1,
      currentPoliticalStrength: 0,
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/insufficient/i);
  });

  it("happy path: PS spent, Org grows, ledger row written", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.ok).toBe(true);
    expect(body.psCost).toBe(BUILD_ORG_BASE_PS_COST);
    expect(body.orgGain).toBeGreaterThan(0);
    expect(body.newOrg).toBeGreaterThan(20);

    // Org update happened
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).toHaveBeenCalledWith(
      { _id: spenderRowId },
      expect.objectContaining({
        $set: expect.objectContaining({ organization: expect.any(Number) }),
      })
    );

    // Ledger row inserted with correct shape
    expect(db.collectionMocks["orgRegLedger"]!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        metric: "org",
        source: "action",
        note: "action:build-org",
        delta: expect.any(Number),
        partyId,
        stateId,
      })
    );

    // Factors returned for tooltip
    expect(body.factors).toHaveProperty("headroom");
    expect(body.factors).toHaveProperty("ownDiminishing");
    expect(body.factors).toHaveProperty("psLeverage");
    expect(body.factors).toHaveProperty("catchup");
  });

  it("poaches rival Org in a saturated state and writes per-rival poach ledger rows", async () => {
    // Saturated state (60 + 20 + 20 = 100, no pool). Spender PS 29 dominates the
    // two PS-poor rivals (6 and 4), so Build Org poaches both — the weaker-PS
    // rival (party 3, PS 4) bleeds more than party 2 (PS 6).
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

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.ok).toBe(true);
    expect(body.orgGain).toBeGreaterThan(0);
    expect(body.poaches).toHaveLength(2);
    const a = body.poaches.find((p: { partyId: string }) => p.partyId === "2");
    const b = body.poaches.find((p: { partyId: string }) => p.partyId === "3");
    // Weaker-PS rival (party 3) loses more.
    expect(b.loss).toBeGreaterThan(a.loss);
    // Conservation: with an empty pool, the spender's gain equals the sum of poaches.
    expect(body.orgGain).toBeCloseTo(a.loss + b.loss, 5);

    // Ledger: exactly one spender "action" row + one "poach" row per rival.
    const ledgerCalls = db.collectionMocks["orgRegLedger"]!.insertOne.mock.calls.map((c) => c[0]);
    expect(ledgerCalls.filter((r) => r.source === "action")).toHaveLength(1);
    expect(ledgerCalls.filter((r) => r.source === "poach")).toHaveLength(2);
  });

  it("blends national PS into the comparison — a nationally-backed rival is poached less", async () => {
    // Saturated state; spender state PS 29 (no national). Both rivals have equal
    // state PS (5), but rival 2 holds a large NATIONAL pool (200) and rival 3
    // none. With the national blend, rival 2's effective PS rises, so it bleeds
    // LESS than rival 3 despite identical state PS.
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
          politicalStrength: 5,
          treasury: 10_000_000,
        },
        {
          _id: `${stateId}_3`,
          stateId,
          partyId: "3",
          countryId: "US",
          organization: 20,
          politicalStrength: 5,
          treasury: 10_000_000,
        },
      ],
    } as never);
    // National PS pools per rival party (politicalParties rows).
    db.collection("politicalParties");
    db.collectionMocks["politicalParties"]!.find.mockReturnValue({
      toArray: async () => [
        { sequentialId: 2, countryId: "US", isDefault: false, politicalStrength: 200 },
        { sequentialId: 3, countryId: "US", isDefault: false, politicalStrength: 0 },
      ],
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const a = body.poaches.find((p: { partyId: string }) => p.partyId === "2"); // nationally backed
    const b = body.poaches.find((p: { partyId: string }) => p.partyId === "3"); // no national backing
    expect(b.loss).toBeGreaterThan(a.loss);
  });

  it("admin override works regardless of party leadership", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "admin",
        isAdmin: true,
        character: { _id: new ObjectId(), name: "Admin" },
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);
  });

  // ── Treasury cost (2026-09-02) ──────────────────────────────────────────

  it("charges the STATE treasury for a state-scope click and reports the cash cost", async () => {
    const { chargeOrgBuildFunds } = await import("@/lib/parties/commands/chargeOrgBuildFunds");

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();

    // US state rate 37,500 × 0.075 × 1 PS.
    const expectedPrice = 37_500 * 0.075 * BUILD_ORG_BASE_PS_COST;
    expect(chargeOrgBuildFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "state",
        stateRowId: spenderRowId,
        partyId,
        countryId: "US",
        amount: expectedPrice,
      }),
      expect.anything()
    );
    expect(body.cashPrice).toBeCloseTo(expectedPrice, 6);
    expect(body.cashCost).toBeCloseTo(expectedPrice, 6);
    expect(body.fundedFraction).toBe(1);
  });

  it("charges the NATIONAL treasury when the national pool pays the PS", async () => {
    const nationalChairId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "nationalChair",
        isAdmin: false,
        character: { _id: nationalChairId, name: "National Chair" },
      },
    } as never);
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
    const { chargeOrgBuildFunds } = await import("@/lib/parties/commands/chargeOrgBuildFunds");

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);

    // US national rate 75,000 × 0.075 × 1 PS — twice the state price.
    expect(chargeOrgBuildFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "national-targeted",
        amount: 75_000 * 0.075 * BUILD_ORG_BASE_PS_COST,
      }),
      expect.anything()
    );
  });

  it("returns 400 and spends NO PS when the treasury is below the funded floor", async () => {
    // 10% of the price is under the 25% floor.
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: spenderRowId,
      stateId,
      partyId,
      countryId: "US",
      organization: 20,
      politicalStrength: 10,
      treasury: 37_500 * 0.075 * 0.1,
      hasPresence: true,
      chairId: stateChairId,
      viceChairId: new ObjectId(),
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(400);

    // A refused click must cost the player nothing: no PS debit, no pressure
    // escalation, no Org change, no cash movement.
    const { spendPoliticalStrength } =
      await import("@/lib/parties/commands/spendPoliticalStrength");
    const { chargeOrgBuildFunds } = await import("@/lib/parties/commands/chargeOrgBuildFunds");
    expect(spendPoliticalStrength).not.toHaveBeenCalled();
    expect(chargeOrgBuildFunds).not.toHaveBeenCalled();
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).not.toHaveBeenCalled();
  });

  it("scales the Org gain down when the treasury only partly funds the click", async () => {
    const { POST } = await import("./route");
    const fullResponse = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    const fullBody = await fullResponse.json();

    // Same state, but the charge only recovers half the price. The statePartyOrg
    // findOne mock is a fixed resolved value, so the second call sees identical
    // Org / PS — only the funded share differs.
    const { chargeOrgBuildFunds } = await import("@/lib/parties/commands/chargeOrgBuildFunds");
    vi.mocked(chargeOrgBuildFunds).mockImplementation(async (input) => ({
      charged: input.amount / 2,
    }));

    const halfResponse = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    const halfBody = await halfResponse.json();

    expect(halfResponse.status).toBe(200);
    expect(halfBody.fundedFraction).toBeCloseTo(0.5, 6);
    expect(halfBody.orgGain).toBeCloseTo(fullBody.orgGain * 0.5, 6);
  });

  it("floors a click whose treasury vanished after the PS was committed", async () => {
    // The charge recovered nothing (a concurrent debit drained the row). PS is
    // already spent, so the click must still land at the minimum funded share
    // rather than buying zero Org.
    const { chargeOrgBuildFunds } = await import("@/lib/parties/commands/chargeOrgBuildFunds");
    vi.mocked(chargeOrgBuildFunds).mockResolvedValue({ charged: 0 });

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.fundedFraction).toBe(0.25);
    expect(body.orgGain).toBeGreaterThan(0);
  });
});
