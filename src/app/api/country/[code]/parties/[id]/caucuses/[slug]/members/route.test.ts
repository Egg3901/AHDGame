import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/db/caucusLookup", () => ({
  findCaucusBySlug: vi.fn(),
}));

function cursor<T>(items: T[]) {
  const value = {
    toArray: vi.fn().mockResolvedValue(items),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
  return value;
}

describe("caucus membership recruitment route", () => {
  let db: MockDb;
  let chairId: ObjectId;
  let caucusId: ObjectId;
  let nppId: ObjectId;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    chairId = new ObjectId();
    caucusId = new ObjectId();
    nppId = new ObjectId();

    db.collection("npps");
    db.collection("nppRelationships");
    db.collection("caucusMemberships");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: { _id: chairId } },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 7,
      countryId: "US",
    } as never);

    const { findCaucusBySlug } = await import("@/lib/db/caucusLookup");
    vi.mocked(findCaucusBySlug).mockResolvedValue({
      caucus: {
        _id: caucusId,
        chairId,
        slug: "main-street",
      },
      isRedirect: false,
    } as never);

    db.collectionMocks["npps"]!.findOne.mockResolvedValue({
      _id: nppId,
      name: "Donna Russell",
      party: "7",
      homeState: "TX",
      currentOffice: null,
      favorability: 45,
      politicalInfluence: 20,
      personality: { loyalty: 50, ambition: 55, stubbornness: 35 },
      policies: { economic: 0, social: 0 },
      generatedAt: new Date(),
      retiredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      factionId: null,
    });
  });

  it("rejects NPP recruitment when the chair relationship is below the minimum", async () => {
    db.collectionMocks["nppRelationships"]!.findOne.mockResolvedValue({
      _id: `${chairId.toString()}_${nppId.toString()}`,
      relationshipScore: 55,
    });
    db.collectionMocks["caucusMemberships"]!.find.mockReturnValue(cursor([]));

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/country/us/parties/7/caucuses/main-street/members", {
        method: "POST",
        body: JSON.stringify({ memberType: "npp", memberId: nppId.toString() }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ code: "us", id: "7", slug: "main-street" }) }
    );

    expect(response.status).toBe(400);
    expect(db.collectionMocks["caucusMemberships"]!.insertOne).not.toHaveBeenCalled();
  });

  it("enforces the 12-hour caucus recruitment cooldown for NPPs", async () => {
    const otherNppId = new ObjectId();
    db.collectionMocks["nppRelationships"]!.findOne.mockResolvedValue({
      _id: `${chairId.toString()}_${nppId.toString()}`,
      relationshipScore: 65,
    });
    db.collectionMocks["caucusMemberships"]!.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          caucusId,
          memberType: "npp",
          memberId: otherNppId,
          status: "left",
          joinedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
          updatedAt: new Date(),
        },
      ])
    );

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/country/us/parties/7/caucuses/main-street/members", {
        method: "POST",
        body: JSON.stringify({ memberType: "npp", memberId: nppId.toString() }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ code: "us", id: "7", slug: "main-street" }) }
    );

    expect(response.status).toBe(409);
    expect(db.collectionMocks["caucusMemberships"]!.insertOne).not.toHaveBeenCalled();
  });

  it("lists recruitable NPPs with eligibility derived from relationship and cooldown", async () => {
    const secondNppId = new ObjectId();
    const thirdNppId = new ObjectId();
    const fourthNppId = new ObjectId();
    const cooldownNppId = new ObjectId();
    const otherCaucusId = new ObjectId();
    db.collectionMocks["npps"]!.find.mockReturnValue(
      cursor([
        {
          _id: nppId,
          name: "Donna Russell",
          party: "7",
          homeState: "TX",
          currentOffice: { type: "house", state: "TX" },
          favorability: 45,
          politicalInfluence: 20,
          personality: { loyalty: 50, ambition: 55, stubbornness: 35 },
          policies: { economic: 0, social: 0 },
          generatedAt: new Date(),
          retiredAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          factionId: null,
        },
        {
          _id: secondNppId,
          name: "Jose Graham",
          party: "7",
          homeState: "TX",
          currentOffice: null,
          favorability: 40,
          politicalInfluence: 10,
          personality: { loyalty: 45, ambition: 50, stubbornness: 45 },
          policies: { economic: 0, social: 0 },
          generatedAt: new Date(),
          retiredAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          factionId: null,
        },
        {
          _id: cooldownNppId,
          name: "Mia Howard",
          party: "7",
          homeState: "OK",
          currentOffice: null,
          favorability: 43,
          politicalInfluence: 11,
          personality: { loyalty: 44, ambition: 49, stubbornness: 40 },
          policies: { economic: 0, social: 0 },
          generatedAt: new Date(),
          retiredAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          factionId: null,
        },
        {
          _id: thirdNppId,
          name: "Rachel Ross",
          party: "7",
          homeState: "LA",
          currentOffice: null,
          favorability: 55,
          politicalInfluence: 14,
          personality: { loyalty: 48, ambition: 52, stubbornness: 39 },
          policies: { economic: 0, social: 0 },
          generatedAt: new Date(),
          retiredAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          factionId: otherCaucusId,
        },
        {
          _id: fourthNppId,
          name: "Samuel Baker",
          party: "7",
          homeState: "AR",
          currentOffice: null,
          favorability: 38,
          politicalInfluence: 9,
          personality: { loyalty: 42, ambition: 46, stubbornness: 51 },
          policies: { economic: 0, social: 0 },
          generatedAt: new Date(),
          retiredAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          factionId: null,
        },
      ])
    );
    db.collectionMocks["nppRelationships"]!.find.mockReturnValue(
      cursor([
        {
          _id: `${chairId.toString()}_${nppId.toString()}`,
          relationshipScore: 65,
        },
        {
          _id: `${chairId.toString()}_${thirdNppId.toString()}`,
          relationshipScore: 90,
        },
        {
          _id: `${chairId.toString()}_${cooldownNppId.toString()}`,
          relationshipScore: 72,
        },
        {
          _id: `${chairId.toString()}_${fourthNppId.toString()}`,
          relationshipScore: 25,
        },
      ])
    );
    db.collectionMocks["caucusMemberships"]!.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          caucusId,
          memberType: "npp",
          memberId: secondNppId,
          status: "left",
          joinedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
          updatedAt: new Date(),
        },
        {
          _id: new ObjectId(),
          caucusId: otherCaucusId,
          memberType: "npp",
          memberId: thirdNppId,
          status: "active",
          joinedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          updatedAt: new Date(),
        },
      ])
    );

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/country/us/parties/7/caucuses/main-street/members?memberType=npp"
      ),
      { params: Promise.resolve({ code: "us", id: "7", slug: "main-street" }) }
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      items: Array<{ id: string; eligible: boolean; status: string }>;
    };
    expect(data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: nppId.toString(),
          eligible: false,
          status: "cooldown",
        }),
        expect.objectContaining({
          id: cooldownNppId.toString(),
          eligible: false,
          status: "cooldown",
        }),
      ])
    );
    expect(data.items).toHaveLength(2);
    expect(data.items.some((item) => item.id === secondNppId.toString())).toBe(false);
    expect(data.items.some((item) => item.id === thirdNppId.toString())).toBe(false);
    expect(data.items.some((item) => item.id === fourthNppId.toString())).toBe(false);
  });
});
