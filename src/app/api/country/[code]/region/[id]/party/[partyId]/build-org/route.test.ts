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
vi.mock("@/lib/politicalStrength/orgBuildStateSize", () => ({
  resolveOrgBuildSizeMultiplier: vi.fn().mockResolvedValue(1),
  clearOrgBuildSizeCache: vi.fn(),
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
    db.collection("politicalParties");
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
    db.collectionMocks["statePartyOrg"]!.findOneAndUpdate.mockImplementation(async (filter) => {
      const rows = await db.collectionMocks["statePartyOrg"]!.find().toArray();
      const targetRowId = String(filter._id ?? spenderRowId);
      const legacyTotal = rows.reduce(
        (sum: number, row: { organization?: number; organizationUnits?: number }) =>
          row.organizationUnits === undefined ? sum + (row.organization ?? 0) : sum,
        0
      );
      const legacyScale = Math.min(10, 100 / Math.max(1, 100 - Math.min(99, legacyTotal)));
      const current =
        rows.find((row: { _id?: string }) => row._id === targetRowId) ??
        ({
          _id: targetRowId,
          stateId,
          partyId,
          countryId: "US",
          organization: 0,
          politicalStrength: 10,
          treasury: 10_000_000,
          hasPresence: true,
          chairId: stateChairId,
        } as const);
      return {
        ...current,
        organizationUnits:
          (current.organizationUnits ?? (current.organization ?? 0) * legacyScale) + 1,
        lastOrganizationBuildTurn: 100,
      };
    });

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

    // Default: an average-sized state, so prices read as the flat rate.
    const { resolveOrgBuildSizeMultiplier } =
      await import("@/lib/politicalStrength/orgBuildStateSize");
    vi.mocked(resolveOrgBuildSizeMultiplier).mockResolvedValue(1);
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

  it("national chair build-org debits the national PS pool without a refund", async () => {
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
    expect(db.collectionMocks["politicalParties"]?.updateOne).not.toHaveBeenCalled();
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

  it("adds a bucket unit when the spender holds all party-owned units", async () => {
    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: spenderRowId,
          stateId,
          partyId,
          countryId: "US",
          organization: 100,
          organizationUnits: 100,
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
      organizationUnits: 100,
      politicalStrength: 10,
      treasury: 10_000_000,
      hasPresence: true,
      chairId: stateChairId,
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.contributionUnits).toBe(1);
    expect(body.organizationUnits).toBe(101);
    expect(body.orgGain).toBeGreaterThan(0);
    expect(db.collectionMocks["orgRegLedger"]!.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ partyId, source: "action", delta: expect.any(Number) }),
      ])
    );
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

    // The durable unit is deposited atomically, then cached percentages are
    // refreshed without replacing that balance.
    expect(db.collectionMocks["statePartyOrg"]!.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: spenderRowId, countryId: "US", stateId, partyId }),
      expect.any(Array),
      { returnDocument: "after" }
    );
    expect(db.collectionMocks["statePartyOrg"]!.bulkWrite).toHaveBeenCalled();
    const organizationWrites = db.collectionMocks["statePartyOrg"]!.bulkWrite.mock.calls.flatMap(
      (call) => call[0]
    );
    expect(organizationWrites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: { _id: spenderRowId, organizationUnits: 41 },
            update: expect.objectContaining({
              $set: expect.objectContaining({ organization: expect.any(Number) }),
            }),
          }),
        }),
      ])
    );

    // Ledger row inserted with correct shape
    expect(db.collectionMocks["orgRegLedger"]!.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          metric: "org",
          source: "action",
          note: "action:build-org",
          delta: expect.any(Number),
          partyId,
          stateId,
        }),
      ])
    );

    expect(body.contributionUnits).toBe(1);
    expect(body.organizationUnits).toBe(41);
  });

  it("dilutes rival shares proportionally in a saturated bucket", async () => {
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
    expect(body.dilutions).toHaveLength(2);
    const a = body.dilutions.find((p: { partyId: string }) => p.partyId === "2");
    const b = body.dilutions.find((p: { partyId: string }) => p.partyId === "3");
    expect(b.loss).toBeCloseTo(a.loss, 6);
    // Part of the gain also comes from diluting the permanent Unaffiliated
    // stake, so it is larger than the two rival losses alone.
    expect(body.orgGain).toBeGreaterThan(a.loss + b.loss);

    // Ledger: one action row plus one passive dilution row per rival.
    expect(db.collectionMocks["orgRegLedger"]!.insertMany).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks["orgRegLedger"]!.insertMany.mock.calls[0][0]).toMatchObject([
      { source: "action", partyId: "1" },
      { source: "passive", partyId: "2" },
      { source: "passive", partyId: "3" },
    ]);
    const allWrites = db.collectionMocks["statePartyOrg"]!.bulkWrite.mock.calls.flatMap(
      (call) => call[0]
    );
    expect(allWrites.length).toBeGreaterThanOrEqual(3);
  });

  it("bases dilution on bucket ownership rather than national PS", async () => {
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
    const a = body.dilutions.find((p: { partyId: string }) => p.partyId === "2");
    const b = body.dilutions.find((p: { partyId: string }) => p.partyId === "3");
    expect(a.loss).toBeCloseTo(b.loss, 6);
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
    const expectedPrice = Math.round(37_500 * 0.075 * BUILD_ORG_BASE_PS_COST);
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
        amount: Math.round(75_000 * 0.075 * BUILD_ORG_BASE_PS_COST),
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

  it("keeps the fixed contribution when the treasury only partly funds the click", async () => {
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
    expect(halfBody.contributionUnits).toBe(1);
    expect(halfBody.orgGain).toBeCloseTo(fullBody.orgGain, 6);
  });

  // Organizing a big state costs more than a small one. Both halves of the bill
  // — the affordability gate and the debit — must use the same multiplier, or a
  // click could pass the gate at one price and be charged another.
  it("charges the size-scaled price in a larger-than-average state", async () => {
    const { resolveOrgBuildSizeMultiplier } =
      await import("@/lib/politicalStrength/orgBuildStateSize");
    vi.mocked(resolveOrgBuildSizeMultiplier).mockResolvedValue(1.6);
    const { chargeOrgBuildFunds } = await import("@/lib/parties/commands/chargeOrgBuildFunds");

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();

    const expected = Math.round(37_500 * 0.075 * BUILD_ORG_BASE_PS_COST * 1.6);
    expect(body.cashPrice).toBe(expected);
    expect(chargeOrgBuildFunds).toHaveBeenCalledWith(
      expect.objectContaining({ amount: expected }),
      expect.anything()
    );
  });

  it("charges less in a smaller-than-average state", async () => {
    const { resolveOrgBuildSizeMultiplier } =
      await import("@/lib/politicalStrength/orgBuildStateSize");
    vi.mocked(resolveOrgBuildSizeMultiplier).mockResolvedValue(0.5);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    const body = await response.json();

    expect(body.cashPrice).toBe(Math.round(37_500 * 0.075 * BUILD_ORG_BASE_PS_COST * 0.5));
  });

  it("quotes the next click against the pool this one spent", async () => {
    // Dual-role officer spending the national pool: the follow-up estimate the
    // overview card renders must price the national tier, not the state one.
    const officerId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "dual",
        isAdmin: false,
        character: { _id: officerId, name: "Dual Officer" },
      },
    } as never);
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      treasury: 50_000_000,
      countryId: "US",
      name: "Test Party",
      chairId: officerId,
      viceChairId: new ObjectId(),
    } as never);
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: spenderRowId,
      stateId,
      partyId,
      countryId: "US",
      organization: 20,
      politicalStrength: 10,
      treasury: 10_000_000,
      hasPresence: true,
      chairId: officerId,
      viceChairId: new ObjectId(),
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequestWithBody({ psPool: "national" }), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.nextPreview.ok).toBe(true);
    expect(body.nextPreview.scope).toBe("national-targeted");
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

  it("resolves the spender row by compound _id when its fields drifted (ticket #1256)", async () => {
    // A party renumber (country merge) rewrote statePartyOrg.partyId but not
    // the compound _id. Before the fix the field-triple read missed SED's row
    // entirely and the poach pass treated the miskeyed rows as rivals —
    // clicking Build Org for SED drained the number the party page displayed.
    // The read must fall back to the compound _id so the spender's own row
    // resolves.
    const drifted = {
      _id: "CA_7", // stale suffix; party 1's canonical key is CA_1
      stateId,
      partyId: "1",
      countryId: "US",
      organization: 36,
      politicalStrength: 29,
      treasury: 10_000_000, // post-pricing routes fund-floor on treasury
      hasPresence: true,
      chairId: stateChairId,
    };
    // findStatePartyOrgRow probes the field triple first, then the compound
    // _id. This fixture is the post-drift live shape: NEITHER probe can match
    // the triple (partyId "1" lives on a row whose _id says CA_7), so the _id
    // probe is what resolves it. Return the drifted row for both probes —
    // auth + eligibility re-read the same row through the same helper.
    db.collectionMocks["statePartyOrg"]!.findOne.mockImplementation(
      async (filter: Record<string, unknown>) =>
        filter._id === "CA_7" || filter.partyId === "1" ? drifted : null
    );
    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: async () => [
        drifted,
        {
          _id: `${stateId}_2`,
          stateId,
          partyId: "2",
          countryId: "US",
          organization: 20,
          politicalStrength: 6,
        },
      ],
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: stateId, partyId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();

    // The spender's own row resolved and receives the build contribution.
    expect(body.ok).toBe(true);
    expect(body.orgGain).toBeGreaterThan(0);
  });
});
