import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/parliamentaryFreeze", () => ({
  checkLegislationFreeze: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/legislature/billAutoFailWarning", () => ({
  getBillProposalAutoFailWarning: vi.fn().mockResolvedValue(null),
  getBillProposalAutoFailWarningError: vi.fn(),
}));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("bills");
  db.collection("governmentFormations");
  db.collection("politicalParties");
  db.collection("legislationTypes");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { getAuthUser } = await import("@/lib/auth");
  vi.mocked(getAuthUser).mockResolvedValue(null);
});

describe("GET /api/country/[code]/legislature/cabinet-bills", () => {
  it("returns cabinet bills in BillDisplay shape with a string id", async () => {
    const billId = new ObjectId();
    const now = new Date("2026-04-26T13:45:10.235Z");

    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue({ _id: "JP" });
    db.collectionMocks["politicalParties"]!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { _id: "party-1", sequentialId: 1, countryId: "JP", name: "CDP", color: "#2255aa" },
        ]),
    });
    db.collectionMocks["legislationTypes"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "vocational_training",
          name: "Vocational Training",
          policyOptions: [],
        },
      ]),
    });
    db.collectionMocks["bills"]!.find.mockImplementation((filter: { projection?: unknown }) => {
      if ("status" in filter) {
        return {
          toArray: vi.fn().mockResolvedValue([]),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
        };
      }

      return {
        toArray: vi.fn().mockResolvedValue([
          {
            _id: billId,
            countryId: "JP",
            title: "Regional Skills and Vocational Training Act.",
            summary: "Invest in regional training centers.",
            originChamber: "cabinet",
            currentChamber: "shugiin",
            sponsorId: new ObjectId(),
            sponsorName: "Marcus",
            sponsorParty: "1",
            status: "cabinet_review",
            votesFor: 0,
            votesAgainst: 0,
            votesAbstain: 0,
            votes: {},
            category: "education",
            legislationTypeId: "vocational_training",
            effectDirection: 1,
            provisions: [{ legislationTypeId: "vocational_training", effectDirection: 1 }],
            proposedAt: now,
            votingStartedAt: now,
            votingEndsAt: new Date(now.getTime() + 86_400_000),
            createdAt: now,
            updatedAt: now,
          },
        ]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      };
    });

    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/country/jp/legislature/cabinet-bills"),
      {
        params: Promise.resolve({ code: "jp" }),
      }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.bills).toHaveLength(1);
    expect(json.bills[0]).toEqual(
      expect.objectContaining({
        id: billId.toString(),
        originChamber: "cabinet",
        status: "cabinet_review",
        canVoteOrigin: false,
      })
    );
  });
});

describe("POST /api/country/[code]/legislature/cabinet-bills", () => {
  const characterId = new ObjectId();

  async function authenticatePrimeMinister() {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: "user-1",
        isAdmin: false,
        character: {
          _id: characterId,
          name: "Test Prime Minister",
          actions: 20,
          nationalInfluence: 100,
        },
      },
    } as never);
    db.collection("cabinetMembers").distinct.mockResolvedValue([new ObjectId()]);
    db.collectionMocks.governmentFormations.findOne.mockResolvedValue({
      _id: "JP",
      pmCharacterId: characterId,
    });
  }

  function request(body: Record<string, unknown>) {
    return new Request("http://localhost/api/country/jp/legislature/cabinet-bills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Reviewed Cabinet Bill",
        summary: "A cabinet proposal under the reviewed legislation system.",
        category: "tax",
        ...body,
      }),
    });
  }

  it("rejects more than the supported number of reviewed provisions", async () => {
    await authenticatePrimeMinister();
    const { POST } = await import("./route");

    const response = await POST(
      request({
        provisions: Array.from({ length: 4 }, (_, index) => ({
          legislationTypeId: `tax-${index}`,
          proposedRate: index + 1,
        })),
      }),
      { params: Promise.resolve({ code: "jp" }) }
    );

    expect(response.status).toBe(400);
    expect(db.collectionMocks.bills.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a crafted legacy provision when legislation v2 is active", async () => {
    await authenticatePrimeMinister();
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      _id: "current",
      resetWorldId: "world-1",
      metricsSystemVersion: "v2",
      legislationSystemVersion: "v2",
      resetVersionSeeds: {
        metrics: {
          worldId: "world-1",
          revision: 3,
          sourceTurn: 1,
          completedAt: "2026-10-04T00:00:00.000Z",
          verificationHash: "metrics",
        },
        legislation: {
          worldId: "world-1",
          revision: 6,
          sourceTurn: 1,
          completedAt: "2026-10-04T00:00:00.000Z",
          verificationHash: "legislation",
        },
      },
    } as never);
    const { POST } = await import("./route");

    const response = await POST(
      request({
        category: "education",
        provisions: [
          {
            legislationTypeId: "jp_legacy_education_policy",
            policyOptionId: "expanded",
            effectDirection: 1,
          },
        ],
      }),
      { params: Promise.resolve({ code: "jp" }) }
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toMatch(/only reviewed law and tax provisions/i);
    expect(db.collectionMocks.bills.insertOne).not.toHaveBeenCalled();
  });
});
