import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { makeElection, makeCandidate, makeCharacter } from "@/lib/test-utils/factories";
import { getDb } from "@/lib/mongodb";
import { getElectionOpponents } from "./electionOpponents";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/demographics/categoryCatalog", () => ({
  loadDemographicCategories: async () => [],
}));
vi.mock("@/lib/seeds/stateDemographics", () => ({ computeLiveGroupTurnouts: async () => ({}) }));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: async () => ({ currentTurn: 10, effectiveNow: new Date(0) }),
}));
vi.mock("@/lib/actions/prevElectionPartyShares", () => ({
  getLastElectionPartyShares: async () => null,
}));
beforeEach(() => vi.clearAllMocks());
it.each([false, true])(
  "prefers the next local race in either database order (%s)",
  async (reverse) => {
    const db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const character = makeCharacter({ countryId: "US", homeState: "CA" });
    const local = makeElection({ state: "CA", endTurn: 30, primaryEndTurn: 5 });
    const later = makeElection({ state: "CA", endTurn: 40, primaryEndTurn: 5 });
    const national = makeElection({
      state: "US",
      endTurn: 20,
      primaryEndTurn: 5,
      electionType: "president",
    });
    const races = [national, later, local];
    db.collection("elections").find.mockReturnValue({
      toArray: async () => (reverse ? races.reverse() : races),
    });
    db.collection("electionCandidates").findOne.mockResolvedValue(
      makeCandidate({ characterId: character._id })
    );
    db.collection("states").findOne.mockResolvedValue({ _id: "CA" });
    db.collection("stateDemographics").findOne.mockResolvedValue({ _id: "CA" });
    const result = await getElectionOpponents(character);
    expect(result?.electionId).toBe(local._id.toString());
    // An unopposed candidacy still carries context so the poll uses its race rules.
    expect(result?.opponents).toEqual([]);
  }
);
