import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, assertCalledWithFilter, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/rateLimit")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(() => ({ ok: true as const })),
  };
});
vi.mock("@/lib/api/requestLog", () => ({ logRequest: vi.fn() }));
vi.mock("@/lib/achievements/triggers", () => ({
  checkBillSponsoredAchievements: vi.fn().mockResolvedValue(undefined),
}));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("characters");
  db.collection("electedOfficials");
  db.collection("legislationTypes");
  db.collection("bills");
  db.collection("politicalParties");
  db.collection("elections");
  db.collection("countryGameStates");
});

async function wireDb() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
}

describe("POST /api/congress/bills", () => {
  it("returns 401 when not authenticated", async () => {
    await wireDb();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/congress/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "x",
        summary: "y",
        chamber: "house",
        category: "tax",
        provisions: [],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when proposal body fails schema validation", async () => {
    await wireDb();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), isAdmin: true },
    } as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      name: "Admin",
      party: "1",
      nationalInfluence: 999,
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/congress/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "",
        summary: "Missing title should fail",
        chamber: "house",
        category: "tax",
        provisions: [
          { legislationTypeId: "income_tax", effectDirection: 0, economic: 0, social: 0 },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("refuses a central-bank-independence provision by name, not as a missing legislation type", async () => {
    // #1250: the shared body schema is country-neutral, so it admits the
    // provision on this route too, but this route validates provisions inline
    // and has no branch for it. Without an explicit refusal it fell through to
    // the policy branch and came back as "Each provision must have a
    // legislation type", which names the wrong problem.
    await wireDb();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), isAdmin: true },
    } as never);
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      name: "Admin",
      party: "1",
      nationalInfluence: 999,
    });
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/congress/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Federal Reserve Accountability Act",
        summary: "Return rate-setting to the Treasury",
        chamber: "house",
        category: "economy",
        provisions: [{ type: "central_bank_independence", action: "revoke" }],
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(
      expect.objectContaining({ error: expect.stringMatching(/country legislature/i) })
    );
  });

  it("returns 201 when admin proposes a valid tax bill", async () => {
    await wireDb();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId, isAdmin: true },
    } as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: charId,
      name: "Admin Legislator",
      party: "1",
      nationalInfluence: 999,
    });
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue(null);
    // Provision validation batches all referenced types into one $in find
    // (query-count guard below); findOne must stay unused.
    db.collectionMocks["legislationTypes"]!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: "income_tax", name: "Income Tax", policyDomain: "tax" }]),
    });

    const insertedId = new ObjectId();
    db.collectionMocks["bills"]!.insertOne.mockResolvedValue({
      insertedId,
      acknowledged: true,
    } as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/congress/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Revenue tweak",
        summary: "Adjust brackets",
        chamber: "house",
        category: "tax",
        provisions: [
          { legislationTypeId: "income_tax", effectDirection: 1, economic: 0, social: 0 },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe(insertedId.toString());
    expect(json.message).toContain("voting is now open");
    // Perf regression guard (audit 2026-08-03): one batched $in fetch for
    // legislation types, never a per-provision findOne.
    expect(db.collectionMocks["legislationTypes"]!.findOne).not.toHaveBeenCalled();
    // O(1) fetches regardless of provision count (validation batch + the
    // downstream duplicate-check read) — never O(provisions).
    expect(db.collectionMocks["legislationTypes"]!.find.mock.calls.length).toBeLessThanOrEqual(2);
    expect(db.collectionMocks["bills"]!.insertOne).toHaveBeenCalled();
  });

  it("deducts nationalInfluence (not politicalInfluence) for industry subsidy bills", async () => {
    await wireDb();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId, isAdmin: false },
    } as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: charId,
      name: "Rep. Tester",
      party: "1",
      politicalInfluence: 72,
      nationalInfluence: 40,
      actions: 100,
    });
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({
      characterId: charId,
      officeType: "house",
    });
    db.collectionMocks["characters"]!.updateOne.mockResolvedValue({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
    } as never);

    const insertedId = new ObjectId();
    db.collectionMocks["bills"]!.insertOne.mockResolvedValue({
      insertedId,
      acknowledged: true,
    } as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/congress/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Sector support",
        summary: "Subsidy package",
        chamber: "house",
        category: "industry",
        provisions: [
          {
            type: "subsidy",
            scopeType: "economy_wide",
            domesticOnly: false,
          },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const charUpdates = db.collectionMocks["characters"]!.updateOne.mock.calls;
    expect(charUpdates.length).toBeGreaterThan(0);
    const lastCharUpdate = charUpdates[charUpdates.length - 1]?.[1] as {
      $inc?: { nationalInfluence?: number; politicalInfluence?: number };
    };
    expect(lastCharUpdate?.$inc?.nationalInfluence).toBe(-5);
    expect(lastCharUpdate?.$inc?.politicalInfluence).toBeUndefined();
  });

  it("rejects a duplicate tariff scope across active US congress bills", async () => {
    await wireDb();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId, isAdmin: true },
    } as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: charId,
      name: "Admin Legislator",
      party: "1",
      nationalInfluence: 999,
    });
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue(null);

    // Active bill already has an origin_country tariff against UK
    db.collectionMocks["bills"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          provisions: [
            {
              type: "tariff",
              scopeType: "origin_country",
              targetOriginCountryId: "UK",
              rate: 10,
            },
          ],
        },
      ]),
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    } as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/congress/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "UK Import Restrictions Act",
        summary: "Conflicting tariff",
        chamber: "house",
        category: "trade",
        provisions: [
          {
            type: "tariff",
            scopeType: "origin_country",
            targetOriginCountryId: "UK",
            rate: 25,
          },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it("proposes a custom bill with no provisions, stripping any client input", async () => {
    await wireDb();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId, isAdmin: true },
    } as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: charId,
      name: "Admin Legislator",
      party: "1",
      nationalInfluence: 999,
    });
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue(null);

    const insertedId = new ObjectId();
    db.collectionMocks["bills"]!.insertOne.mockResolvedValue({
      insertedId,
      acknowledged: true,
    } as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/congress/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "A Statement of Intent",
        summary: "For the record.",
        chamber: "house",
        category: "custom",
        // Smuggled provision must be ignored.
        provisions: [{ legislationTypeId: "income_tax", effectDirection: 1 }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const inserted = db.collectionMocks["bills"]!.insertOne.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(inserted.category).toBe("custom");
    expect(inserted.provisions).toEqual([]);
    expect(inserted.proposalNpiCost).toBeUndefined();
  });

  it("rejects non-US chambers (e.g. bundestag) routed to the US congress endpoint", async () => {
    await wireDb();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId, isAdmin: true },
    } as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: charId,
      name: "Admin",
      party: "1",
      nationalInfluence: 999,
    });
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/congress/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Cross-country smuggle",
        summary: "Attempt to create a US bill with a foreign chamber.",
        chamber: "bundestag",
        category: "tax",
        provisions: [
          {
            legislationTypeId: "income_tax",
            effectDirection: 0,
            economic: 0,
            social: 0,
          },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("Invalid chamber for US Congress"),
    });
    expect(db.collectionMocks["bills"]!.insertOne).not.toHaveBeenCalled();
  });
});

describe("GET /api/congress/bills", () => {
  // The US Congress list is US-only. Other enabled countries whose chambers
  // share the US names (e.g. Nigeria's "senate") must never leak into it.
  it("scopes the bill query to countryId 'US' for an admin viewer", async () => {
    await wireDb();
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({
      userId: new ObjectId().toString(),
      isAdmin: true,
    } as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/congress/bills?chamber=senate"));
    expect(res.status).toBe(200);

    // countDocuments receives the same filter object as the main list query,
    // and is called exactly once with it — an unambiguous seam.
    assertCalledWithFilter(db.collectionMocks["bills"]!.countDocuments, { countryId: "US" });
  });

  it("scopes the bill query to countryId 'US' for a non-admin viewer", async () => {
    await wireDb();
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue(null as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/congress/bills?chamber=senate"));
    expect(res.status).toBe(200);

    assertCalledWithFilter(db.collectionMocks["bills"]!.countDocuments, { countryId: "US" });
  });
});
