import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { makeElection, makeCandidate, makeCharacter, makeNPP } from "@/lib/test-utils/factories";
import { getDb } from "@/lib/mongodb";
import { getElectionOpponents } from "./electionOpponents";
import * as singleSeatIncumbency from "@/lib/electionEngine/singleSeatIncumbency";
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
vi.mock("@/lib/actions/pollCalculations", () => ({
  computePollData: async () => ({
    overallAppeal: 50,
    totalPotentialVoters: 100,
    totalEstimatedVoters: 60,
  }),
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

it("resolves multi-seat tenure once from the already-loaded candidate identities", async () => {
  const db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const character = makeCharacter({ countryId: "US", homeState: "CA" });
  const election = makeElection({
    countryId: "US",
    state: "CA",
    electionType: "house",
    primaryEndTurn: 5,
  });
  const mine = makeCandidate({ characterId: character._id });
  const rival = makeCandidate({ characterId: new ObjectId() });
  db.collection("elections").find.mockReturnValue({ toArray: async () => [election] });
  db.collection("electionCandidates").findOne.mockResolvedValue(mine);
  db.collection("electionCandidates").find.mockReturnValue({ toArray: async () => [rival] });
  db.collection("states").findOne.mockResolvedValue({ _id: "CA" });
  db.collection("stateDemographics").findOne.mockResolvedValue({ _id: "CA" });
  const resolver = vi
    .spyOn(singleSeatIncumbency, "resolveHouseIncumbentTenures")
    .mockResolvedValue(new Map([[mine._id.toString(), 4]]));

  const result = await getElectionOpponents(character);

  expect(resolver).toHaveBeenCalledTimes(1);
  expect(resolver.mock.calls[0][1]).toEqual(
    new Map([
      [character._id.toString(), mine._id.toString()],
      [rival.characterId!.toString(), rival._id.toString()],
    ])
  );
  expect(result).toMatchObject({
    candidateId: mine._id.toString(),
    incumbency: {
      houseTenureTermsByCandidateId: new Map([[mine._id.toString(), 4]]),
    },
  });
});

it("does not substitute political influence for a human candidate's missing national influence", async () => {
  const db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const character = makeCharacter({ countryId: "US", homeState: "CA" });
  const election = makeElection({ state: "CA", primaryEndTurn: 5 });
  const rivalCharacter = makeCharacter({ politicalInfluence: 72 });
  delete (rivalCharacter as Partial<typeof rivalCharacter>).nationalInfluence;
  const rival = makeCandidate({ characterId: rivalCharacter._id });
  db.collection("elections").find.mockReturnValue({ toArray: async () => [election] });
  db.collection("electionCandidates").findOne.mockResolvedValue(
    makeCandidate({ characterId: character._id })
  );
  db.collection("electionCandidates").find.mockReturnValue({ toArray: async () => [rival] });
  db.collection("characters").find.mockReturnValue({ toArray: async () => [rivalCharacter] });
  db.collection("states").findOne.mockResolvedValue({ _id: "CA" });
  db.collection("stateDemographics").findOne.mockResolvedValue({ _id: "CA" });

  const result = await getElectionOpponents(character);

  expect(result?.opponents[0]).toMatchObject({ politicalInfluence: 72, nationalInfluence: 0 });
});

it("uses political influence as resolved NPP national influence even when an NPP NI field exists", async () => {
  const db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const character = makeCharacter({ countryId: "US", homeState: "CA" });
  const election = makeElection({ state: "CA", primaryEndTurn: 5 });
  const npp = Object.assign(makeNPP({ politicalInfluence: 37 }), { nationalInfluence: 91 });
  const rival = makeCandidate({ isNPP: true, nppId: npp._id });
  db.collection("elections").find.mockReturnValue({ toArray: async () => [election] });
  db.collection("electionCandidates").findOne.mockResolvedValue(
    makeCandidate({ characterId: character._id })
  );
  db.collection("electionCandidates").find.mockReturnValue({ toArray: async () => [rival] });
  db.collection("npps").find.mockReturnValue({ toArray: async () => [npp] });
  db.collection("states").findOne.mockResolvedValue({ _id: "CA" });
  db.collection("stateDemographics").findOne.mockResolvedValue({ _id: "CA" });

  const result = await getElectionOpponents(character);

  expect(result?.opponents[0]).toMatchObject({ politicalInfluence: 37, nationalInfluence: 37 });
});
