import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { NextResponse } from "next/server";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { getAuthUser } = await import("@/lib/auth");

describe("GET /api/country/[code]/legislature/bills (UK)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const req = (page?: string) =>
    new Request(
      page
        ? `http://localhost/api/country/uk/legislature/bills?page=${page}`
        : "http://localhost/api/country/uk/legislature/bills"
    );

  const ukParams = { params: Promise.resolve({ code: "uk" }) };

  function makeDb(bills: object[], total: number, charId?: ObjectId, hasOffice = false) {
    const billCollection = {
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(bills),
      }),
      findOne: vi.fn().mockResolvedValue(null),
      countDocuments: vi.fn().mockResolvedValue(total),
    };
    // Extract sponsorIds from bills for sequentialId lookup mock
    const sponsorIds = bills
      .map((b) => (b as { sponsorId?: ObjectId }).sponsorId)
      .filter((id): id is ObjectId => id != null);
    const charactersCollection = {
      findOne: vi.fn().mockResolvedValue(charId ? { _id: charId } : null),
      find: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue(sponsorIds.map((id) => ({ _id: id, sequentialId: null }))),
      }),
    };
    const usersCollection = {
      findOne: vi
        .fn()
        .mockResolvedValue(charId ? { activeCharacterId: charId } : { activeCharacterId: null }),
    };
    const mockDb = {
      collection: vi.fn((name: string) => {
        if (name === "bills") return billCollection;
        if (name === "characters") return charactersCollection;
        if (name === "users") return usersCollection;
        if (name === "electedOfficials")
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue(hasOffice ? [{ officeType: "commons" }] : []),
            }),
          };
        // `gameState` (active-preset lookup for era-conditional configs)
        // findOnes; no doc → preset undefined → base config.
        return {
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Db);
    return { billCollection };
  }

  it("returns list of Commons bills with pagination", async () => {
    vi.mocked(getAuthUser).mockRejectedValue(new Error("Not logged in"));
    makeDb(
      [
        {
          _id: new ObjectId(),
          title: "Education Funding Act 2026",
          sponsorId: new ObjectId(),
          sponsorName: "Jane Smith",
          status: "active",
          currentChamber: "commons",
          proposedAt: new Date("2026-03-01"),
          votesFor: 320,
          votesAgainst: 280,
          votesAbstain: 0,
        },
      ],
      100
    );

    const { GET } = await import("@/app/api/country/[code]/legislature/bills/route");
    const response = await GET(req(), ukParams);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.bills).toHaveLength(1);
    expect(data.bills[0]).toHaveProperty("title", "Education Funding Act 2026");
    expect(data).toHaveProperty("canPropose", false);
    expect(data).toHaveProperty("total", 100);
    expect(data).toHaveProperty("page", 1);
    expect(data).toHaveProperty("limit", 50);
  });

  it("sets canPropose=true if user is MP", async () => {
    const userId = new ObjectId().toString();
    vi.mocked(getAuthUser).mockResolvedValue({ userId, isAdmin: false } as never);
    const charId = new ObjectId();
    makeDb([], 0, charId, true);

    const { GET } = await import("@/app/api/country/[code]/legislature/bills/route");
    const response = await GET(req(), ukParams);
    const data = await response.json();
    expect(data.canPropose).toBe(true);
  });

  it("handles pagination parameters correctly", async () => {
    vi.mocked(getAuthUser).mockRejectedValue(new Error("Not logged in"));
    const { billCollection } = makeDb([], 150);

    const { GET } = await import("@/app/api/country/[code]/legislature/bills/route");
    const response = await GET(req("3"), ukParams);
    const data = await response.json();

    expect(data.page).toBe(3);
    expect(data.total).toBe(150);

    const chain = billCollection.find().sort();
    expect(chain.skip).toHaveBeenCalledWith(100);
    expect(chain.limit).toHaveBeenCalledWith(50);
  });

  it("serializes subsidy bills with visible provision metadata", async () => {
    vi.mocked(getAuthUser).mockRejectedValue(new Error("Not logged in"));
    makeDb(
      [
        {
          _id: new ObjectId(),
          title: "Financial Sector Relief Subsidy",
          sponsorId: new ObjectId(),
          sponsorName: "Jane Smith",
          status: "active",
          currentChamber: "commons",
          originChamber: "commons",
          category: "industry",
          proposedAt: new Date("2026-03-01"),
          votesFor: 320,
          votesAgainst: 280,
          votesAbstain: 0,
          provisions: [
            {
              type: "subsidy",
              scopeType: "sector",
              targetSectorType: "financial",
              domesticOnly: true,
            },
          ],
        },
      ],
      1
    );

    const { GET } = await import("@/app/api/country/[code]/legislature/bills/route");
    const response = await GET(req(), ukParams);
    const data = await response.json();

    expect(data.bills[0].legislationTypeName).toContain("Grant subsidies");
    expect(data.bills[0].provisions).toEqual([
      expect.objectContaining({
        legislationTypeId: "subsidy",
        legislationTypeName: expect.stringContaining("Grant subsidies"),
      }),
    ]);
  });

  it("serializes tariff bills with visible provision metadata", async () => {
    vi.mocked(getAuthUser).mockRejectedValue(new Error("Not logged in"));
    makeDb(
      [
        {
          _id: new ObjectId(),
          title: "Steel Import Protection Act",
          sponsorId: new ObjectId(),
          sponsorName: "Jane Smith",
          status: "active",
          currentChamber: "commons",
          originChamber: "commons",
          category: "trade",
          proposedAt: new Date("2026-03-01"),
          votesFor: 320,
          votesAgainst: 280,
          votesAbstain: 0,
          provisions: [
            {
              type: "tariff",
              scopeType: "origin_country",
              targetOriginCountryId: "US",
              rate: 15,
            },
          ],
        },
      ],
      1
    );

    const { GET } = await import("@/app/api/country/[code]/legislature/bills/route");
    const response = await GET(req(), ukParams);
    const data = await response.json();

    expect(data.bills[0].legislationTypeName).toContain("15% tariff");
    expect(data.bills[0].provisions).toEqual([
      expect.objectContaining({
        legislationTypeId: "tariff",
        legislationTypeName: expect.stringContaining("15% tariff"),
      }),
    ]);
  });
});

// ─── POST (JP) ──────────────────────────────────────────────────────────────

vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/api/parliamentaryFreeze", () => ({
  checkLegislationFreeze: vi.fn(async () => ({ ok: true })),
}));

const { requireBasicAuth } = await import("@/lib/api/requireAuth");
const { checkLegislationFreeze } = await import("@/lib/api/parliamentaryFreeze");

describe("POST /api/country/[code]/legislature/bills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkLegislationFreeze).mockResolvedValue({ ok: true } as never);
  });

  const jpParams = { params: Promise.resolve({ code: "jp" }) };
  const ukParams = { params: Promise.resolve({ code: "uk" }) };
  const ruParams = { params: Promise.resolve({ code: "ru" }) };

  function makeLegislaturePostDb(opts: {
    charId: ObjectId;
    userId: ObjectId;
    officeType: string | null;
    hasActiveBill?: boolean;
  }) {
    const { charId, userId, officeType, hasActiveBill } = opts;
    const insertedId = new ObjectId();
    const billCollection = {
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      }),
      findOne: vi.fn().mockResolvedValue(hasActiveBill ? { _id: new ObjectId() } : null),
      countDocuments: vi.fn().mockResolvedValue(0),
      insertOne: vi.fn().mockResolvedValue({ insertedId }),
    };
    const character = {
      _id: charId,
      userId,
      name: "Test Diet Member",
      party: "ldp",
      actions: 100,
      nationalInfluence: 100,
    };
    const charactersCollection = {
      findOne: vi.fn().mockResolvedValue(character),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([character]) }),
      updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    const electedOfficialsCollection = {
      findOne: vi.fn().mockResolvedValue(officeType ? { characterId: charId, officeType } : null),
    };
    const legislationType = {
      _id: "lt_tax_income",
      name: "Income Tax",
      policyDomain: "tax",
      policyOptions: [{ id: "opt_center", effectDirection: 0 }],
    };
    const legislationTypesCollection = {
      findOne: vi.fn().mockResolvedValue(legislationType),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([legislationType]) }),
    };
    const statePoliciesCollection = {
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      }),
    };
    const partiesCollection = {
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    };
    const mockDb = {
      collection: vi.fn((name: string) => {
        if (name === "bills") return billCollection;
        if (name === "characters") return charactersCollection;
        if (name === "electedOfficials") return electedOfficialsCollection;
        if (name === "legislationTypes") return legislationTypesCollection;
        if (name === "statePolicies") return statePoliciesCollection;
        if (name === "politicalParties") return partiesCollection;
        return {
          find: vi.fn().mockReturnValue({
            sort: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Db);
    return { billCollection, insertedId };
  }

  const validBody = {
    title: "Sangiin Tax Reform",
    summary: "A Sangiin-originated tax reform bill.",
    chamber: "sangiin",
    category: "tax",
    provisions: [
      {
        legislationTypeId: "lt_tax_income",
        policyOptionId: "opt_center",
        effectDirection: 0,
        economic: 0,
        social: 0,
      },
    ],
  };

  function postReq(body: object) {
    return new Request("http://localhost/api/country/jp/legislature/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("allows a seated Sangiin member to propose a bill", async () => {
    const charId = new ObjectId();
    const userId = new ObjectId();
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString(), isAdmin: false },
    } as never);
    const { billCollection } = makeLegislaturePostDb({ charId, userId, officeType: "sangiin" });

    const { POST } = await import("@/app/api/country/[code]/legislature/bills/route");
    const response = await POST(postReq(validBody), jpParams);
    expect(response.status).toBe(201);

    const inserted = billCollection.insertOne.mock.calls[0]![0] as {
      originChamber: string;
      currentChamber: string;
    };
    expect(inserted.originChamber).toBe("sangiin");
    expect(inserted.currentChamber).toBe("sangiin");
  });

  it("allows a seated Shugiin member to propose a bill", async () => {
    const charId = new ObjectId();
    const userId = new ObjectId();
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString(), isAdmin: false },
    } as never);
    const { billCollection } = makeLegislaturePostDb({ charId, userId, officeType: "shugiin" });

    const { POST } = await import("@/app/api/country/[code]/legislature/bills/route");
    const response = await POST(postReq({ ...validBody, chamber: "shugiin" }), jpParams);
    expect(response.status).toBe(201);

    const inserted = billCollection.insertOne.mock.calls[0]![0] as {
      originChamber: string;
    };
    expect(inserted.originChamber).toBe("shugiin");
  });

  it("rejects a character who holds neither Diet seat", async () => {
    const charId = new ObjectId();
    const userId = new ObjectId();
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString(), isAdmin: false },
    } as never);
    makeLegislaturePostDb({ charId, userId, officeType: null });

    const { POST } = await import("@/app/api/country/[code]/legislature/bills/route");
    const response = await POST(postReq(validBody), jpParams);
    expect(response.status).toBe(403);
  });

  it("allows admin override to bypass legislation freeze and stamps the bill", async () => {
    const charId = new ObjectId();
    const userId = new ObjectId();
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString(), isAdmin: true },
    } as never);
    vi.mocked(checkLegislationFreeze).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Government not formed" }, { status: 403 }),
    });
    const { billCollection } = makeLegislaturePostDb({ charId, userId, officeType: null });

    const { POST } = await import("@/app/api/country/[code]/legislature/bills/route");
    const response = await POST(postReq(validBody), jpParams);

    expect(response.status).toBe(201);
    const inserted = billCollection.insertOne.mock.calls[0]![0] as {
      adminProposed?: boolean;
      originChamber: string;
    };
    expect(inserted.adminProposed).toBe(true);
    expect(inserted.originChamber).toBe("sangiin");
    expect(checkLegislationFreeze).not.toHaveBeenCalled();
  });

  it("allows a Commons member to propose a subsidy bill", async () => {
    const charId = new ObjectId();
    const userId = new ObjectId();
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString(), isAdmin: false },
    } as never);
    const { billCollection, insertedId } = makeLegislaturePostDb({
      charId,
      userId,
      officeType: "commons",
    });

    const { POST } = await import("@/app/api/country/[code]/legislature/bills/route");
    const response = await POST(
      postReq({
        title: "Financial Sector Relief Subsidy",
        summary: "Targeted relief for domestic financial firms.",
        chamber: "commons",
        category: "industry",
        provisions: [
          {
            type: "subsidy",
            scopeType: "sector",
            targetSectorType: "financial",
            domesticOnly: true,
          },
        ],
      }),
      ukParams
    );

    expect(response.status).toBe(201);
    expect((await response.json()).billId).toBe(insertedId.toString());
    const inserted = billCollection.insertOne.mock.calls[0]![0] as {
      originChamber: string;
      proposalNpiCost?: number;
      provisions: Array<{ type?: string; targetSectorType?: string; domesticOnly?: boolean }>;
    };
    expect(inserted.originChamber).toBe("commons");
    expect(inserted.proposalNpiCost).toBe(5);
    expect(inserted.provisions).toContainEqual(
      expect.objectContaining({
        type: "subsidy",
        scopeType: "sector",
        targetSectorType: "financial",
        domesticOnly: true,
      })
    );
  });

  it("allows a seated Bundestag member to propose a bill", async () => {
    const charId = new ObjectId();
    const userId = new ObjectId();
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString(), isAdmin: false },
    } as never);
    const { billCollection } = makeLegislaturePostDb({
      charId,
      userId,
      officeType: "bundestag",
    });

    const deParams = { params: Promise.resolve({ code: "de" }) };
    const { POST } = await import("@/app/api/country/[code]/legislature/bills/route");
    const response = await POST(
      postReq({
        title: "Bundestag Tax Reform",
        summary: "Federal tax reform proposed in the Bundestag.",
        chamber: "bundestag",
        category: "tax",
        provisions: [
          {
            legislationTypeId: "lt_tax_income",
            policyOptionId: "opt_center",
            effectDirection: 0,
            economic: 0,
            social: 0,
          },
        ],
      }),
      deParams
    );

    expect(response.status).toBe(201);
    const inserted = billCollection.insertOne.mock.calls[0]![0] as {
      originChamber: string;
      currentChamber: string;
      countryId: string;
    };
    expect(inserted.originChamber).toBe("bundestag");
    expect(inserted.currentChamber).toBe("bundestag");
    expect(inserted.countryId).toBe("DE");
  });

  it("allows a seated Supreme Soviet deputy to propose a bill", async () => {
    const charId = new ObjectId();
    const userId = new ObjectId();
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString(), isAdmin: false },
    } as never);
    const { billCollection } = makeLegislaturePostDb({
      charId,
      userId,
      officeType: "supremeSovietDeputy",
    });

    const { POST } = await import("@/app/api/country/[code]/legislature/bills/route");
    const response = await POST(
      postReq({
        title: "Global Alliance Web",
        summary: "Strengthens Soviet alliances and fraternal diplomacy.",
        chamber: "sovietOfTheUnion",
        category: "tax",
        provisions: [
          {
            legislationTypeId: "lt_tax_income",
            policyOptionId: "opt_center",
            effectDirection: 0,
            economic: 0,
            social: 0,
          },
        ],
      }),
      ruParams
    );

    expect(response.status).toBe(201);
    const inserted = billCollection.insertOne.mock.calls[0]![0] as {
      originChamber: string;
      currentChamber: string;
      countryId: string;
    };
    expect(inserted.originChamber).toBe("sovietOfTheUnion");
    expect(inserted.currentChamber).toBe("sovietOfTheUnion");
    expect(inserted.countryId).toBe("RU");
  });

  it("rejects a chamber that is not configured for the country", async () => {
    const charId = new ObjectId();
    const userId = new ObjectId();
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString(), isAdmin: false },
    } as never);
    const { billCollection } = makeLegislaturePostDb({
      charId,
      userId,
      officeType: "supremeSovietDeputy",
    });

    const { POST } = await import("@/app/api/country/[code]/legislature/bills/route");
    const response = await POST(postReq({ ...validBody, chamber: "house" }), ruParams);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Invalid chamber"),
    });
    expect(billCollection.insertOne).not.toHaveBeenCalled();
  });

  it("allows a Commons member to propose an end-subsidy bill", async () => {
    const charId = new ObjectId();
    const userId = new ObjectId();
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString(), isAdmin: false },
    } as never);
    const { billCollection } = makeLegislaturePostDb({
      charId,
      userId,
      officeType: "commons",
    });

    const { POST } = await import("@/app/api/country/[code]/legislature/bills/route");
    const response = await POST(
      postReq({
        title: "Sunset Industrial Subsidies",
        summary: "Ends broad market support.",
        chamber: "commons",
        category: "industry",
        provisions: [{ type: "end_subsidy", scopeType: "economy_wide" }],
      }),
      ukParams
    );

    expect(response.status).toBe(201);
    const inserted = billCollection.insertOne.mock.calls[0]![0] as {
      provisions: Array<{ type?: string; scopeType?: string }>;
    };
    expect(inserted.provisions).toContainEqual(
      expect.objectContaining({
        type: "end_subsidy",
        scopeType: "economy_wide",
      })
    );
  });
});
