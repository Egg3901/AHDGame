import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuth: vi.fn(),
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/countryAccess", () => ({
  getEnabledCountryIds: vi.fn().mockResolvedValue(["US", "UK", "CA", "DE", "JP"]),
}));

const mockCharacter = {
  _id: new ObjectId(),
  name: "MP McSponsor",
  actions: 50,
  nationalInfluence: 100,
  party: "labour",
};

function arrangeAuth() {
  return {
    ok: true as const,
    user: {
      userId: new ObjectId().toString(),
      username: "sponsor",
      isAdmin: false,
      character: mockCharacter,
    },
  };
}

let db: MockDb;
beforeEach(async () => {
  db = createMockDb();
  db.collection("bills");
  db.collection("characters");
  db.collection("electedOfficials");
  db.collection("politicalParties");
  db.collection("legislationTypes");
  db.collection("statePolicies");

  vi.clearAllMocks();

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue(
    arrangeAuth() as unknown as Awaited<ReturnType<typeof requireBasicAuth>>
  );

  const { getEnabledCountryIds } = await import("@/lib/countryAccess");
  vi.mocked(getEnabledCountryIds).mockResolvedValue(["US", "UK", "DE", "JP"]);

  // Sponsor is a Commons MP
  db.collectionMocks.electedOfficials.findOne.mockResolvedValue({
    _id: new ObjectId(),
    characterId: mockCharacter._id,
    officeType: "commons",
    state: "uk_national",
    seatsHeld: 1,
  });
  db.collectionMocks.characters.findOne.mockResolvedValue(mockCharacter);
  db.collectionMocks.bills.findOne.mockResolvedValue(null);
  db.collectionMocks.bills.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
    project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
  });
  db.collectionMocks.statePolicies.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });
  db.collectionMocks.bills.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
  db.collectionMocks.characters.updateOne.mockResolvedValue({ acknowledged: true });
});

async function postTradeBill(body: Record<string, unknown>) {
  const { POST } = await import("./route");
  const req = new Request("http://test/api/country/uk/legislature/bills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ code: "uk", id: "uk_national" }) });
}

describe("POST /api/country/[code]/legislature/bills — trade bills", () => {
  const validBody = {
    title: "Steel Import Protection Act",
    summary: "Levy tariffs on foreign steel.",
    chamber: "commons",
    category: "trade",
    provisions: [
      {
        type: "tariff",
        scopeType: "origin_country",
        targetOriginCountryId: "US",
        rate: 15,
      },
    ],
  };

  it("stores a valid origin-country trade bill", async () => {
    const res = await postTradeBill(validBody);
    expect(res.status).toBe(201);
    expect(db.collectionMocks.bills.insertOne).toHaveBeenCalledTimes(1);
    const stored = db.collectionMocks.bills.insertOne.mock.calls[0][0] as {
      provisions: unknown[];
      category: string;
    };
    expect(stored.category).toBe("trade");
    expect(stored.provisions).toHaveLength(1);
    expect(stored.provisions[0]).toMatchObject({
      type: "tariff",
      scopeType: "origin_country",
      targetOriginCountryId: "US",
      rate: 15,
    });
  });

  it("rejects a self-targeted origin tariff", async () => {
    const res = await postTradeBill({
      ...validBody,
      provisions: [
        {
          type: "tariff",
          scopeType: "origin_country",
          targetOriginCountryId: "UK",
          rate: 15,
        },
      ],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/own country/i);
  });

  it("rejects a disabled origin country", async () => {
    const { getEnabledCountryIds } = await import("@/lib/countryAccess");
    vi.mocked(getEnabledCountryIds).mockResolvedValueOnce(["UK"]);
    const res = await postTradeBill(validBody);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/enabled country/i);
  });

  it("rejects tariff provision in a non-trade bill", async () => {
    const res = await postTradeBill({ ...validBody, category: "economy" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/trade bills/i);
  });

  it("rejects trade bill with only policy provisions", async () => {
    db.collectionMocks.legislationTypes.findOne.mockResolvedValue({
      _id: "income_tax",
      name: "Income Tax",
      policyDomain: "tax",
    });
    const res = await postTradeBill({
      ...validBody,
      provisions: [{ legislationTypeId: "income_tax", effectDirection: 1, economic: 0, social: 0 }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects corporation-scoped tariff", async () => {
    const res = await postTradeBill({
      ...validBody,
      provisions: [
        {
          type: "tariff",
          scopeType: "corporation",
          targetCorporationId: new ObjectId().toString(),
          rate: 15,
        },
      ],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/corporation-scoped/i);
  });

  it("rejects a duplicate tariff scope across active bills", async () => {
    db.collectionMocks.bills.find.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([
        {
          provisions: [
            {
              type: "tariff",
              scopeType: "origin_country",
              targetOriginCountryId: "US",
              rate: 10,
            },
          ],
        },
      ]),
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    });
    const res = await postTradeBill(validBody);
    expect(res.status).toBe(409);
  });

  it("allows sector-scope trade bill with valid sector", async () => {
    const res = await postTradeBill({
      ...validBody,
      provisions: [
        { type: "tariff", scopeType: "sector", targetSectorType: "automobiles", rate: 20 },
      ],
    });
    expect(res.status).toBe(201);
  });

  it("rejects sector-scope tariff with unknown sector", async () => {
    const res = await postTradeBill({
      ...validBody,
      provisions: [
        { type: "tariff", scopeType: "sector", targetSectorType: "not_a_sector", rate: 20 },
      ],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid sector/i);
  });

  it("charges 0 NPI for a trade-only bill", async () => {
    await postTradeBill(validBody);
    const stored = db.collectionMocks.bills.insertOne.mock.calls[0][0] as {
      proposalNpiCost?: number;
    };
    expect(stored.proposalNpiCost).toBeUndefined();
  });
});
