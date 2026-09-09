import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db, ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { makeCharacter, makeCandidate, makeElection } from "@/lib/test-utils/factories";
import { fetchEnrichedCandidates } from "@/lib/electionEngine/candidateEnrichment";
import { projectCampaignPoll } from "./poll";
import { planAdPurchase } from "./rules";

vi.mock("@/lib/electionEngine/candidateEnrichment", () => ({ fetchEnrichedCandidates: vi.fn() }));

function fixture(type: "senate" | "president", primary: boolean) {
  const db = createMockDb();
  const character = makeCharacter({ countryId: "US", homeState: "PA", party: "1" });
  const election = makeElection({
    countryId: "US",
    state: type === "president" ? "US" : "PA",
    electionType: type,
    campaignRulesVersion: 1,
  });
  const candidates = [
    makeCandidate({ electionId: election._id, characterId: character._id, party: "1" }),
    makeCandidate({ electionId: election._id, party: primary ? "1" : "2" }),
  ];
  db.collection("elections").findOne.mockResolvedValue(election);
  db.collection("electionCandidates").find.mockReturnValue({ toArray: async () => candidates });
  db.collection("states").findOne.mockResolvedValue({
    _id: "PA",
    countryId: "US",
    population: 1_000_000,
    votingEligiblePopulation: 1_000_000,
    votingSystem: "rcv",
  });
  db.collection("stateDemographics").findOne.mockResolvedValue({
    _id: "PA",
    countryId: "US",
    categoryWeights: {},
    groups: {},
    lastUpdated: new Date(0),
  });
  db.collection("gameState").findOne.mockResolvedValue({ _id: "current", currentTurn: 10 });
  const enriched = candidates.map((candidate) => ({
    candidateId: candidate._id.toString(),
    characterId: candidate.characterId.toString(),
    characterName: "Synthetic",
    party: candidate.party,
    isNPP: false,
    charEP: 0,
    charSP: 0,
    favorability: 50,
    politicalInfluence: 50,
    nationalInfluence: 50,
    partyEcon: 0,
    partySocial: 0,
    targetedAds: candidate.targetedAds,
  }));
  vi.mocked(fetchEnrichedCandidates).mockImplementation(async () => enriched);
  const run = () =>
    projectCampaignPoll(db as unknown as Db, election._id.toString(), character, null, [], primary);
  return { db, election, character, candidates, enriched, run };
}

beforeEach(() => vi.clearAllMocks());

describe("campaign poll election parity", () => {
  it.each([
    ["senate", false],
    ["president", false],
    ["senate", true],
    ["president", true],
  ] as const)("uses turnout and cell ads for %s (primary=%s)", async (type, primary) => {
    const f = fixture(type, primary);
    const baseline = (await f.run())!;
    const id = f.candidates[0]._id.toString();
    const share = (result: typeof baseline) =>
      result.votes[id] / Object.values(result.votes).reduce((sum, value) => sum + value, 0);
    expect(share(baseline)).toBeCloseTo(0.5, 5);
    f.enriched[0].targetedAds = planAdPurchase(
      [],
      { stateId: "PA", dimension: "race", bucket: "white" },
      10,
      1
    )!;
    const advertised = (await f.run())!;
    expect(share(advertised)).toBeGreaterThan(share(baseline));
    expect(advertised.totalPool).toBe(baseline.totalPool);
    expect(Object.values(advertised.votes).reduce((sum, value) => sum + value, 0)).toBeCloseTo(
      Object.values(baseline.votes).reduce((sum, value) => sum + value, 0),
      4
    );
    expect(
      advertised.cells
        .filter((cell) => cell.buckets.race !== "white")
        .every((cell) => advertised.bonusesByCandidate[id][cell.id] === 0)
    ).toBe(true);
    f.db.collection("gameState").findOne.mockResolvedValue({ _id: "current", currentTurn: 82 });
    expect(share((await f.run())!)).toBeLessThan(share(advertised));
  });

  it("keeps old races on their existing polling path", async () => {
    const f = fixture("senate", false);
    delete f.election.campaignRulesVersion;
    expect(await f.run()).toBeNull();
    expect(fetchEnrichedCandidates).toHaveBeenCalled();
  });

  it("scopes regional primary candidates to the polling character's party", async () => {
    const f = fixture("senate", true);
    await f.run();
    expect(f.db.collection("electionCandidates").find).toHaveBeenCalledWith({
      electionId: f.election._id as ObjectId,
      status: "active",
      party: "1",
    });
  });
});
