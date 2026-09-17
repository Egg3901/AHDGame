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
      { stateId: "IA", level: 2, updatedAt: new Date("2026-01-01T12:00:00Z") },
      { stateId: "NH", level: 3, updatedAt: new Date("2026-01-01T11:59:59Z") },
    ],
  });
  vi.mocked((await import("@/lib/mongodb")).getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked((await import("@/lib/api/requireAuth")).requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { character: { _id: characterId, countryId: "US", party: "independent" } },
  } as never);
  const { GET } = await import("./route");
  const response = await GET(
    new Request("http://localhost/api/political-operations/state-org/list")
  );
  expect(response.status).toBe(200);
  expect(
    (await response.json()).states.map((row: { stateId: string; builtThisTurn: boolean }) => [
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
  const next = await GET(new Request("http://localhost/api/political-operations/state-org/list"));
  expect(
    (await next.json()).states.every((row: { builtThisTurn: boolean }) => !row.builtThisTurn)
  ).toBe(true);
});
