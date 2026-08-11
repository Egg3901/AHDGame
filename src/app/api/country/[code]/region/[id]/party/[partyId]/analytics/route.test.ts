import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
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

vi.mock("@/lib/partyAnalytics", () => ({
  buildStatePartyOrgAnalytics: vi.fn(),
  buildPartyDisciplineAnalytics: vi.fn(),
  buildPartySlateAnalytics: vi.fn(),
}));

describe("GET /api/country/[code]/region/[id]/party/[partyId]/analytics", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("states");

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
          homeState: "AZ",
          countryId: "US",
        },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "US",
      chairId: null,
      viceChairId: null,
      name: "Test Party",
    } as never);
  });

  it("returns scoped state analytics with local deep links", async () => {
    db.collectionMocks["states"]!.findOne.mockResolvedValue({
      _id: "AZ",
      countryId: "US",
      name: "Arizona",
    });

    const { buildStatePartyOrgAnalytics, buildPartyDisciplineAnalytics, buildPartySlateAnalytics } =
      await import("@/lib/partyAnalytics");

    vi.mocked(buildStatePartyOrgAnalytics).mockResolvedValue({
      stateId: "AZ",
      stateName: "Arizona",
      organization: 42.5,
      growthPerTurn: 1.2,
      href: "/country/us/region/AZ/party/1",
    });
    vi.mocked(buildPartyDisciplineAnalytics).mockResolvedValue({
      lowLoyaltyCount: 1,
      likelyWhipBreakers: 1,
      cautionCount: 2,
      caucusRiskCount: 0,
      criticalRiskCount: 1,
      elevatedRiskCount: 0,
      activeDefianceCount: 1,
      playerDefianceCount: 0,
      nppDefianceCount: 1,
      disciplineWatch: [],
      highStubbornness: [],
      caucusRisk: [],
    });
    vi.mocked(buildPartySlateAnalytics).mockResolvedValue({
      activeRaceCount: 2,
      uncoveredRaceCount: 1,
      awaitingResolutionCount: 1,
      filedCount: 1,
      likelyDeclineCount: 1,
      statesNeedingCoverageCount: 1,
      statesWithLikelyDeclinesCount: 1,
      noCoverage: [],
      atRiskAssignments: [],
      stateCoverage: [
        {
          state: "AZ",
          totalRaces: 2,
          coveredRaces: 1,
          filedRaces: 1,
          openRaces: 1,
          likelyDeclines: 1,
          href: "/country/us/region/AZ/party/1?tab=slate",
        },
      ],
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/country/us/region/AZ/party/1/analytics"),
      {
        params: Promise.resolve({ code: "us", id: "AZ", partyId: "1" }),
      }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      scope: { stateName: string };
      links: { treasury: { href: string }; npps: { href: string } };
      org: { growthPerTurn: number };
      slate: { coverage: { state: string } | null };
    };

    expect(body.scope.stateName).toBe("Arizona");
    expect(body.links.treasury.href).toContain("?tab=treasury");
    expect(body.links.npps.href).toContain("?tab=actions&sub=management");
    expect(body.org.growthPerTurn).toBe(1.2);
    expect(body.slate.coverage?.state).toBe("AZ");
  });

  it("rejects viewers who are not in-state party members, national leadership, or admins", async () => {
    db.collectionMocks["states"]!.findOne.mockResolvedValue({
      _id: "AZ",
      countryId: "US",
      name: "Arizona",
    });

    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: {
        userId: "user-2",
        username: "outsider",
        isAdmin: false,
        character: {
          id: "character-2",
          party: "2",
          homeState: "CA",
          countryId: "US",
        },
      },
    } as never);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/country/us/region/AZ/party/1/analytics"),
      {
        params: Promise.resolve({ code: "us", id: "AZ", partyId: "1" }),
      }
    );

    expect(response.status).toBe(403);
  });
});
