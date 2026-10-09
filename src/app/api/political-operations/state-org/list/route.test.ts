import { beforeEach, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/elections/usPoliticalHome", () => ({
  loadUsPoliticalStateIds: vi.fn(async () => ({
    residentPoliticalIds: new Set(["IA", "NH", "CA"]),
  })),
}));
vi.mock("@/lib/politicalOperations/racePresence", () => ({
  loadRacePresence: vi.fn(async () => []),
}));
vi.mock("@/lib/currency/campaignFxRate", () => ({ loadCampaignFxRate: vi.fn(async () => 1) }));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn(async () => ({ lastTurnProcessed: new Date("2026-01-01T12:00:00Z") })),
}));
beforeEach(() => vi.clearAllMocks());
it("marks only the viewer's current-turn investments and clears them next turn", async () => {
  const db = createMockDb();
  const characterId = new ObjectId();
  db.collection("characterStateOrg").find.mockReturnValue({
    toArray: async () => [
      {
        stateId: "IA",
        level: 2,
        updatedAt: new Date("2026-01-01T12:00:00Z"),
        lastBuildAt: new Date("2026-01-01T12:00:00Z"),
        lastBuildFunds: 123_456,
      },
      { stateId: "NH", level: 3, updatedAt: new Date("2026-01-01T11:59:59Z") },
    ],
  });
  vi.mocked((await import("@/lib/mongodb")).getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked((await import("@/lib/api/requireAuth")).requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { character: { _id: characterId, countryId: "US", party: "independent" } },
  } as never);
  const { GET } = await import("./route");
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  const payload = await response.json();
  expect(payload.canBuild).toBe(true);
  expect(
    payload.states.find((row: { stateId: string }) => row.stateId === "IA").spentThisTurn
  ).toBe(123_456);
  expect(
    payload.states.find((row: { stateId: string }) => row.stateId === "NH").spentThisTurn
  ).toBeNull();
  expect(
    payload.states.map((row: { stateId: string; builtThisTurn: boolean }) => [
      row.stateId,
      row.builtThisTurn,
    ])
  ).toEqual([
    ["CA", false],
    ["IA", true],
    ["NH", false],
  ]);
  expect(db.collectionMocks.characterStateOrg!.find).toHaveBeenCalledWith({ characterId });
  vi.mocked((await import("@/lib/time/gameTime")).getGameTime).mockResolvedValue({
    lastTurnProcessed: new Date("2026-01-01T13:00:00Z"),
  } as never);
  const next = await GET();
  const nextPayload = await next.json();
  expect(
    nextPayload.states.every(
      (row: { builtThisTurn: boolean; spentThisTurn: number | null }) =>
        !row.builtThisTurn && row.spentThisTurn === null
    )
  ).toBe(true);
});

it("returns only public candidate presence to non-US spectators", async () => {
  const db = createMockDb();
  const characterId = new ObjectId();
  const presence = [
    {
      characterId: new ObjectId().toHexString(),
      name: "Candidate",
      party: "1",
      isSelf: false,
      levelsByState: { IA: 3 },
    },
  ];
  const { loadRacePresence } = await import("@/lib/politicalOperations/racePresence");
  vi.mocked(loadRacePresence).mockResolvedValueOnce(presence);
  vi.mocked((await import("@/lib/mongodb")).getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked((await import("@/lib/api/requireAuth")).requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { character: { _id: characterId, countryId: "UK", party: "43" } },
  } as never);
  const { GET } = await import("./route");
  const response = await GET();
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload.canBuild).toBe(false);
  expect(payload.racePresence).toEqual(presence);
  expect(payload.states.map((row: { stateId: string }) => row.stateId)).toEqual(["CA", "IA", "NH"]);
  expect(payload.states.every((row: { level: number }) => row.level === 0)).toBe(true);
  expect(loadRacePresence).toHaveBeenCalledWith(db, characterId);
  // No viewer investments, party metadata, or campaign funds are read for spectators.
  expect(db.collection).not.toHaveBeenCalled();
  expect((await import("@/lib/currency/campaignFxRate")).loadCampaignFxRate).not.toHaveBeenCalled();
});

it("still requires an authenticated character", async () => {
  vi.mocked((await import("@/lib/api/requireAuth")).requireAuthWithCharacter).mockResolvedValue({
    ok: false,
    response: new Response(null, { status: 401 }),
  } as never);
  const { GET } = await import("./route");
  expect((await GET()).status).toBe(401);
  expect((await import("@/lib/mongodb")).getDb).not.toHaveBeenCalled();
});

it("loads public levels through the real race loader without exposing investment history", async () => {
  const db = createMockDb();
  const viewerId = new ObjectId();
  const candidateId = new ObjectId();
  const electionId = new ObjectId();
  db.collection("elections").findOne.mockResolvedValue({ _id: electionId });
  db.collection("electionCandidates").find.mockReturnValue({
    toArray: async () => [{ characterId: candidateId, characterName: "Candidate", party: "1" }],
  });
  db.collection("characterStateOrg").find.mockReturnValue({
    toArray: async () => [
      {
        characterId: candidateId,
        stateId: "IA",
        level: 4,
        totalInvested: 200,
        lastBuildFunds: 123456,
      },
    ],
  });
  const actual = await vi.importActual<typeof import("@/lib/politicalOperations/racePresence")>(
    "@/lib/politicalOperations/racePresence"
  );
  vi.mocked(
    (await import("@/lib/politicalOperations/racePresence")).loadRacePresence
  ).mockImplementationOnce(actual.loadRacePresence);
  vi.mocked((await import("@/lib/mongodb")).getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked((await import("@/lib/api/requireAuth")).requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { character: { _id: viewerId, countryId: "JP" } },
  } as never);
  const { GET } = await import("./route");
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  const payload = await response.json();
  expect(payload.racePresence).toEqual([
    {
      characterId: candidateId.toHexString(),
      name: "Candidate",
      party: "1",
      isSelf: false,
      levelsByState: { IA: 4 },
    },
  ]);
  expect(db.collectionMocks.characterStateOrg!.find).toHaveBeenCalledExactlyOnceWith(
    { characterId: { $in: [candidateId] } },
    { projection: { characterId: 1, stateId: 1, level: 1 } }
  );
});
