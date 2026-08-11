import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Coalition } from "@/lib/db/types/coalition";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUserWithCharacter: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 100,
    effectiveNow: new Date("2026-05-20T00:00:00Z"),
    lastTurnProcessed: new Date("2026-05-20T00:00:00Z"),
    isActive: true,
    pausedAt: null,
  }),
}));

function cursor<T>(items: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(items),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("coalition priorities routes", () => {
  let db: MockDb;
  let coalitionId: ObjectId;
  let chairPartyId: ObjectId;
  let memberPartyId: ObjectId;
  let chairCharacterId: ObjectId;
  let memberChairCharacterId: ObjectId;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    coalitionId = new ObjectId();
    chairPartyId = new ObjectId();
    memberPartyId = new ObjectId();
    chairCharacterId = new ObjectId();
    memberChairCharacterId = new ObjectId();

    db.collection("coalitions");
    db.collection("politicalParties");
    db.collection("characters");
    db.collection("legislation");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collectionMocks["politicalParties"]!.find.mockReturnValue(
      cursor([
        {
          _id: chairPartyId,
          sequentialId: 10,
          countryId: "US",
          name: "Alliance Party",
          abbreviation: "ALN",
          color: "#3366ff",
          chairId: chairCharacterId,
        },
        {
          _id: memberPartyId,
          sequentialId: 11,
          countryId: "US",
          name: "Labor Party",
          abbreviation: "LAB",
          color: "#ff6633",
          chairId: memberChairCharacterId,
        },
      ])
    );
    db.collectionMocks["characters"]!.find.mockReturnValue(
      cursor([
        { _id: chairCharacterId, name: "Chair One" },
        { _id: memberChairCharacterId, name: "Chair Two" },
      ])
    );
    db.collectionMocks["legislation"]!.find.mockReturnValue(cursor([]));
  });

  it("hides internal priorities from non-member viewers", async () => {
    const coalition: Coalition = {
      _id: coalitionId,
      sequentialId: 5,
      countryId: "US",
      name: "Unity Bloc",
      abbreviation: "UB",
      color: "#2244aa",
      chairPartyId,
      chairCharacterId,
      members: [
        {
          partyId: chairPartyId,
          partySequentialId: 10,
          joinedAt: new Date("2026-04-01T00:00:00Z"),
        },
        {
          partyId: memberPartyId,
          partySequentialId: 11,
          joinedAt: new Date("2026-04-02T00:00:00Z"),
        },
      ],
      pendingInvites: [],
      joinRequests: [],
      disbandVote: null,
      priorities: [
        {
          id: "public-1",
          type: "policy_theme",
          visibility: "public",
          status: "active",
          stance: "support",
          title: "Growth",
          description: "Grow the economy together.",
          policyThemeKey: "economic_growth",
          billId: null,
          billTitle: null,
          leadershipGoalKey: null,
          targetName: null,
          expiresAt: null,
          votes: [],
          createdBy: chairCharacterId,
          createdAt: new Date("2026-04-10T00:00:00Z"),
          updatedAt: new Date("2026-04-10T00:00:00Z"),
          activatedAt: new Date("2026-04-10T00:00:00Z"),
          resolvedAt: null,
          resolvedBy: null,
        },
        {
          id: "internal-1",
          type: "policy_theme",
          visibility: "internal",
          status: "active",
          stance: "oppose",
          title: "Internal bill strategy",
          description: "Coordinate the caucus vote privately.",
          policyThemeKey: "anti_corruption",
          billId: null,
          billTitle: null,
          leadershipGoalKey: null,
          targetName: null,
          expiresAt: null,
          votes: [],
          createdBy: chairCharacterId,
          createdAt: new Date("2026-04-10T00:00:00Z"),
          updatedAt: new Date("2026-04-10T00:00:00Z"),
          activatedAt: new Date("2026-04-10T00:00:00Z"),
          resolvedAt: null,
          resolvedBy: null,
        },
      ],
      createdBy: chairCharacterId,
      createdAt: new Date("2026-04-01T00:00:00Z"),
      updatedAt: new Date("2026-04-10T00:00:00Z"),
    };

    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue(coalition);

    const { getAuthUserWithCharacter } = await import("@/lib/auth");
    vi.mocked(getAuthUserWithCharacter).mockResolvedValue(null);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ code: "us", id: "5" }),
    });
    const payload = (await response.json()) as { priorities: { active: Array<{ id: string }> } };

    expect(response.status).toBe(200);
    expect(payload.priorities.active.map((priority) => priority.id)).toEqual(["public-1"]);
  });

  it("activates a new priority immediately for a one-party coalition", async () => {
    const coalition: Coalition = {
      _id: coalitionId,
      sequentialId: 5,
      countryId: "US",
      name: "Unity Bloc",
      abbreviation: "UB",
      color: "#2244aa",
      chairPartyId,
      chairCharacterId,
      members: [
        {
          partyId: chairPartyId,
          partySequentialId: 10,
          joinedAt: new Date("2026-04-01T00:00:00Z"),
        },
      ],
      pendingInvites: [],
      joinRequests: [],
      disbandVote: null,
      priorities: [],
      createdBy: chairCharacterId,
      createdAt: new Date("2026-04-01T00:00:00Z"),
      updatedAt: new Date("2026-04-10T00:00:00Z"),
    };

    db.collectionMocks["coalitions"]!.findOne.mockResolvedValue(coalition);
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(
      cursor([
        {
          _id: chairPartyId,
          sequentialId: 10,
          countryId: "US",
          name: "Alliance Party",
          abbreviation: "ALN",
          color: "#3366ff",
          chairId: chairCharacterId,
        },
      ])
    );
    db.collectionMocks["characters"]!.find.mockReturnValue(
      cursor([{ _id: chairCharacterId, name: "Chair One" }])
    );

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        isAdmin: false,
        hasCharacter: true,
        character: { _id: chairCharacterId, party: "10" },
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "policy_theme",
          visibility: "public",
          stance: "support",
          title: "Growth Agenda",
          description: "Public coalition focus on growth.",
          policyThemeKey: "economic_growth",
        }),
      }),
      {
        params: Promise.resolve({ code: "us", id: "5" }),
      }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks["coalitions"]!.updateOne).toHaveBeenCalled();
    const update = db.collectionMocks["coalitions"]!.updateOne.mock.calls[0]?.[1]?.$set as {
      priorities: Coalition["priorities"];
    };
    expect(update.priorities?.[0].status).toBe("active");
  });
});
