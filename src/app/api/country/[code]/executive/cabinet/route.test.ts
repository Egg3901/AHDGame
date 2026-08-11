import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 100, effectiveNow: new Date(0) }),
}));

import { GET } from "./route";

function makeParams(code: string) {
  return { params: Promise.resolve({ code }) };
}

describe("GET /api/country/[code]/executive/cabinet — head-of-government auto-fill", () => {
  let db: MockDb;
  const pmId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue(null);

    db.collection("governmentFormations");
    db.collectionMocks.governmentFormations.findOne.mockResolvedValue({
      _id: "CN",
      pmCharacterId: pmId,
      pmName: "Premier Li",
      governingPartyId: "1",
      formedAt: new Date(0),
    });
    db.collection("cabinetMembers");
    db.collectionMocks.cabinetMembers.find.mockReturnValue({ toArray: async () => [] });
    db.collection("ukCabinetCooldowns");
    db.collectionMocks.ukCabinetCooldowns.find.mockReturnValue({ toArray: async () => [] });
    db.collection("politicalParties");
    db.collectionMocks.politicalParties.find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          { sequentialId: 1, name: "Communist Party", color: "#f00", logoUrl: null },
        ],
      }),
    });
    db.collection("characters");
    db.collectionMocks.characters.find.mockReturnValue({
      project: () => ({
        toArray: async () => [{ _id: pmId, sequentialId: 7, avatarUrl: "/li.png", party: "1" }],
      }),
    });
  });

  it("auto-fills the Premier position from the sitting head of government", async () => {
    const res = await GET(
      new Request("http://localhost/api/country/cn/executive/cabinet"),
      makeParams("cn")
    );
    const json = await res.json();

    const premier = json.positions.find((p: { id: string }) => p.id === "premier");
    expect(premier).toBeDefined();
    expect(premier.isHeadOfGovernment).toBe(true);
    expect(premier.member).not.toBeNull();
    expect(premier.member.characterId).toBe(pmId.toString());
    expect(premier.member.characterName).toBe("Premier Li");
    expect(premier.member.partyName).toBe("Communist Party");
  });

  it("leaves an ordinary minister position empty when unappointed", async () => {
    const res = await GET(
      new Request("http://localhost/api/country/cn/executive/cabinet"),
      makeParams("cn")
    );
    const json = await res.json();

    const vicePremier = json.positions.find((p: { id: string }) => p.id === "vice_premier");
    expect(vicePremier).toBeDefined();
    expect(vicePremier.isHeadOfGovernment).toBeFalsy();
    expect(vicePremier.member).toBeNull();
  });

  it("leaves the Premier position empty when no head of government is seated", async () => {
    db.collectionMocks.governmentFormations.findOne.mockResolvedValue({
      _id: "CN",
      pmCharacterId: null,
      pmName: null,
      governingPartyId: null,
      formedAt: null,
    });

    const res = await GET(
      new Request("http://localhost/api/country/cn/executive/cabinet"),
      makeParams("cn")
    );
    const json = await res.json();

    const premier = json.positions.find((p: { id: string }) => p.id === "premier");
    expect(premier.isHeadOfGovernment).toBe(true);
    expect(premier.member).toBeNull();
  });
});
