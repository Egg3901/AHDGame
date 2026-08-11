import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/api/requireAuth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db/partyLookup", () => ({
  findPartyBySequentialId: vi.fn(),
}));

describe("GET /api/country/[code]/parties/[id]/analytics", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("statePartyOrg");
    db.collection("states");
    db.collection("npps");
    db.collection("caucuses");
    db.collection("caucusMemberships");
    db.collection("nppRelationships");
    db.collection("characters");
    db.collection("elections");
    db.collection("partyBudget");
    db.collection("recruitmentSlates");
    db.collection("slateCandidates");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: {
        userId: "user-1",
        username: "tester",
        isAdmin: false,
        character: {
          id: "character-1",
          party: "1",
          countryId: "US",
        },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
    } as never);
  });

  it("returns unified org, discipline, and slate sections with deep links", async () => {
    const now = new Date("2026-04-29T12:00:00.000Z");
    const chairId = new ObjectId("507f1f77bcf86cd799439001");
    const nppId = new ObjectId("507f1f77bcf86cd799439002");
    const caucusId = new ObjectId("507f1f77bcf86cd799439003");
    const electionId = new ObjectId("507f1f77bcf86cd799439004");
    const slateId = new ObjectId("507f1f77bcf86cd799439005");

    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "AL_1",
          countryId: "US",
          stateId: "AL",
          partyId: "1",
          organization: 62,
        },
        {
          _id: "AK_1",
          countryId: "US",
          stateId: "AK",
          partyId: "1",
          organization: 18,
        },
      ]),
    });
    db.collectionMocks["states"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "AL", name: "Alabama", countryId: "US", population: 1_000_000, gdp: 100_000_000 },
        { _id: "AK", name: "Alaska", countryId: "US", population: 500_000, gdp: 50_000_000 },
      ]),
    });
    db.collectionMocks["partyBudget"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks["npps"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: nppId,
          party: "1",
          countryId: "US",
          retiredAt: null,
          name: "Andrew Murphy",
          homeState: "AL",
          currentOffice: { type: "senate", state: "AL", seatsHeld: 1 },
          personality: { loyalty: 35, stubbornness: 71, ambition: 44 },
          factionId: caucusId,
        },
      ]),
    });
    db.collectionMocks["caucuses"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: caucusId,
          countryId: "US",
          partyId: "1",
          name: "Main Street",
          chairId,
          disbandedAt: null,
        },
      ]),
    });
    db.collectionMocks["caucusMemberships"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          caucusId,
          memberId: nppId,
          memberType: "npp",
          status: "active",
        },
      ]),
    });
    db.collectionMocks["nppRelationships"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: `${chairId.toString()}_${nppId.toString()}`,
          characterId: chairId,
          nppId,
          relationshipScore: 24,
        },
      ]),
    });
    db.collectionMocks["characters"]!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: chairId, name: "Danica Roem", homeState: "AL" }]),
    });
    db.collectionMocks["elections"]!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: electionId,
          countryId: "US",
          electionType: "senate",
          state: "AL",
          senateClass: 2,
          status: "active",
          primaryEndTime: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      ]),
    });
    db.collectionMocks["recruitmentSlates"]!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: slateId, electionId, state: "AL", partyId: "1" }]),
    });
    db.collectionMocks["slateCandidates"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId("507f1f77bcf86cd799439006"),
          slateId,
          electionId,
          countryId: "US",
          partyId: "1",
          candidateName: "Andrew Murphy",
          status: "invited",
          refusalReason: "low_compliance",
        },
      ]),
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/country/us/parties/1/analytics"), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      links: { slate: { href: string } };
      org: { growthLeaders: Array<{ stateName: string }> };
      discipline: { lowLoyaltyCount: number; caucusRisk: Array<{ nppName: string }> };
      slate: { likelyDeclineCount: number; atRiskAssignments: Array<{ electionLabel: string }> };
    };

    expect(body.links.slate.href).toContain("?tab=slate");
    expect(body.org.growthLeaders[0]?.stateName).toBe("Alabama");
    expect(body.discipline.lowLoyaltyCount).toBe(1);
    expect(body.discipline.caucusRisk[0]?.nppName).toBe("Andrew Murphy");
    expect(body.slate.likelyDeclineCount).toBe(1);
    expect(body.slate.atRiskAssignments[0]?.electionLabel).toContain("Senate");
  });
});
