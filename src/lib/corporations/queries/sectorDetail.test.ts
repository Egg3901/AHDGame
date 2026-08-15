import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn().mockResolvedValue(null) }));

let db: MockDb;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  db.collection("corporateSectors");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

describe("getCorporationSectorDetail", () => {
  it("redacts financial details for private corps from public viewers but keeps attack info accessible", async () => {
    const corporationId = new ObjectId();
    const ownerUserId = new ObjectId();
    const sectorId = new ObjectId();

    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corporationId,
      sequentialId: 7,
      name: "Private Corp",
      userId: ownerUserId,
      isPrivate: true,
      countryId: "US",
      liquidCurrencyCode: "USD",
    });
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: sectorId,
      corporationId,
      stateId: "CA",
      countryId: "US",
      sectorType: "technology",
      revenue: 1_000_000,
    });

    const { getCorporationSectorDetail } = await import("./sectorDetail");
    const response = await getCorporationSectorDetail(
      new Request(`http://localhost/api/corporations/7/sectors/${sectorId.toHexString()}`),
      { params: Promise.resolve({ id: "7", sectorId: sectorId.toHexString() }) }
    );
    const data = await response.json();

    // Should return 200 instead of 403, viewer can access the page
    expect(response.status).toBe(200);
    // Financial data should be redacted
    expect(data.sector.revenue).toBeNull();
    expect(data.sector.currentGrowthCost).toBeNull();
    expect(data.sector.workers).toBeNull();
    expect(data.financials).toBeNull();
    expect(data.margins).toBeNull();
    expect(data.ceo).toBeNull();
    // Non-financial fields should still be visible
    expect(data.sector.sectorType).toBe("technology");
    expect(data.sector.stateId).toBe("CA");
    expect(data.isCeo).toBe(false);
    // The withheld figures are labelled so the client shows "why" rather than a
    // bare ", " that reads as $0. Anonymous viewer of a private corp → signed-out.
    expect(data.financialVisibility).toEqual({ hidden: true, reason: "signed-out" });
  });

  it("fogs live financials for a public corp's sector from a non-insider viewer, but keeps identity/CEO info visible", async () => {
    const corporationId = new ObjectId();
    const ownerUserId = new ObjectId();
    const sectorId = new ObjectId();

    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corporationId,
      sequentialId: 8,
      name: "Public Corp",
      userId: ownerUserId,
      isPrivate: false,
      countryId: "US",
      liquidCurrencyCode: "USD",
    });
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: sectorId,
      corporationId,
      stateId: "CA",
      countryId: "US",
      sectorType: "technology",
      revenue: 1_000_000,
    });
    db.collection("characters");
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: ownerUserId,
      name: "CEO Name",
      sequentialId: 1,
      avatarUrl: null,
    });

    const { getCorporationSectorDetail } = await import("./sectorDetail");
    const response = await getCorporationSectorDetail(
      new Request(`http://localhost/api/corporations/8/sectors/${sectorId.toHexString()}`),
      { params: Promise.resolve({ id: "8", sectorId: sectorId.toHexString() }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    // Live financials are hidden from a non-insider viewer of a public corp,
    // same as the corp page's financial fog of war.
    expect(data.sector.revenue).toBeNull();
    expect(data.sector.currentGrowthCost).toBeNull();
    expect(data.sector.workers).toBeNull();
    expect(data.financials).toBeNull();
    expect(data.margins).toBeNull();
    // Unlike the private-corp case, identity is not a secret for a public
    // corp, CEO and non-financial sector info stay visible.
    expect(data.ceo).not.toBeNull();
    expect(data.sector.sectorType).toBe("technology");
    expect(data.sector.stateId).toBe("CA");
    // Anonymous device (no session) on a public corp → signed-out, so the UI
    // says "sign in as the owner", not "$0". This is the exact case behind the
    // "my own sector shows dashes" report: the phone was not logged in.
    expect(data.financialVisibility).toEqual({ hidden: true, reason: "signed-out" });
  });

  it("labels a signed-in rival viewing a public corp as public-rival", async () => {
    const { getAuthUser } = await import("@/lib/auth");
    const corporationId = new ObjectId();
    const ownerUserId = new ObjectId();
    const rivalUserId = new ObjectId();
    const sectorId = new ObjectId();

    // A different, non-admin account than the owner.
    vi.mocked(getAuthUser).mockResolvedValueOnce({
      userId: rivalUserId.toHexString(),
      isAdmin: false,
      isModerator: false,
    } as Awaited<ReturnType<typeof getAuthUser>>);

    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corporationId,
      sequentialId: 10,
      name: "Public Corp",
      userId: ownerUserId,
      isPrivate: false,
      countryId: "US",
      liquidCurrencyCode: "USD",
    });
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: sectorId,
      corporationId,
      stateId: "CA",
      countryId: "US",
      sectorType: "technology",
      revenue: 1_000_000,
    });
    db.collection("characters");
    db.collectionMocks.characters.findOne.mockResolvedValue(null);

    const { getCorporationSectorDetail } = await import("./sectorDetail");
    const response = await getCorporationSectorDetail(
      new Request(`http://localhost/api/corporations/10/sectors/${sectorId.toHexString()}`),
      { params: Promise.resolve({ id: "10", sectorId: sectorId.toHexString() }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.financials).toBeNull();
    expect(data.financialVisibility).toEqual({ hidden: true, reason: "public-rival" });
  });

  it("never fogs a sector's financials from an admin, public or private corp", async () => {
    const { getAuthUser } = await import("@/lib/auth");

    for (const isPrivate of [false, true]) {
      const corporationId = new ObjectId();
      const ownerUserId = new ObjectId();
      const adminUserId = new ObjectId();
      const sectorId = new ObjectId();

      // Admin is a DIFFERENT account than the owner, the exemption must come
      // from isAdmin, not from happening to own the corp.
      vi.mocked(getAuthUser).mockResolvedValueOnce({
        userId: adminUserId.toHexString(),
        isAdmin: true,
        isModerator: true,
      } as Awaited<ReturnType<typeof getAuthUser>>);

      db.collectionMocks.corporations.findOne.mockResolvedValue({
        _id: corporationId,
        sequentialId: 11,
        name: isPrivate ? "Private Corp" : "Public Corp",
        userId: ownerUserId,
        isPrivate,
        countryId: "US",
        liquidCurrencyCode: "USD",
      });
      db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
        _id: sectorId,
        corporationId,
        stateId: "CA",
        countryId: "US",
        sectorType: "technology",
        revenue: 1_000_000,
      });
      db.collection("characters");
      db.collectionMocks.characters.findOne.mockResolvedValue(null);

      const { getCorporationSectorDetail } = await import("./sectorDetail");
      const response = await getCorporationSectorDetail(
        new Request(`http://localhost/api/corporations/11/sectors/${sectorId.toHexString()}`),
        { params: Promise.resolve({ id: "11", sectorId: sectorId.toHexString() }) }
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.sector.revenue, `isPrivate=${isPrivate}`).not.toBeNull();
      expect(data.financials, `isPrivate=${isPrivate}`).not.toBeNull();
      expect(data.financialVisibility, `isPrivate=${isPrivate}`).toEqual({
        hidden: false,
        reason: "visible",
      });
    }
  });

  it("does not fog a public corp's sector financials for its own CEO", async () => {
    const { getAuthUser } = await import("@/lib/auth");
    const corporationId = new ObjectId();
    const ownerUserId = new ObjectId();
    const sectorId = new ObjectId();
    const unionId = new ObjectId();

    vi.mocked(getAuthUser).mockResolvedValueOnce({
      userId: ownerUserId.toHexString(),
      isAdmin: false,
      isModerator: false,
    } as Awaited<ReturnType<typeof getAuthUser>>);

    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corporationId,
      sequentialId: 9,
      name: "Public Corp",
      userId: ownerUserId,
      isPrivate: false,
      countryId: "US",
      liquidCurrencyCode: "USD",
    });
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: sectorId,
      corporationId,
      stateId: "CA",
      countryId: "US",
      sectorType: "technology",
      revenue: 1_000_000,
    });
    db.collection("unions");
    db.collectionMocks.unions.findOne.mockResolvedValue({
      _id: unionId,
      name: "United Steelworkers",
      ownerId: null,
      demandedWageLevel: 1.3,
    });

    const { getCorporationSectorDetail } = await import("./sectorDetail");
    const response = await getCorporationSectorDetail(
      new Request(`http://localhost/api/corporations/9/sectors/${sectorId.toHexString()}`),
      { params: Promise.resolve({ id: "9", sectorId: sectorId.toHexString() }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.isCeo).toBe(true);
    // The CEO sees their own live sector financials, not the fogged view.
    expect(data.sector.revenue).not.toBeNull();
    expect(data.financials).not.toBeNull();
    expect(data.financialVisibility).toEqual({ hidden: false, reason: "visible" });
    // Workforce identity is present even before a president takes office, but
    // a vacant union's dormant demand must not become an active CEO-facing one.
    expect(data.sector.unionId).toBe(unionId.toHexString());
    expect(data.sector.unionName).toBe("United Steelworkers");
    expect(data.sector.unionWageDemand).toBeNull();
  });
});
