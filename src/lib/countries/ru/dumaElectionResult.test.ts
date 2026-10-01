import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { planRussianDumaDistricts } from "./rules/assemblyDistricts";
import { RU_1991_ECONOMIC_REGION_POPULATION } from "./data/ruPopulation1991";
import {
  materializeRussianDumaElectionResult as certify,
  RUSSIAN_DUMA_RESULTS_COLLECTION,
} from "./dumaElectionResult";
const session = { inTransaction: () => true } as ClientSession;
function scenario() {
  const mem = createInMemoryDb();
  const cohortId = new ObjectId();
  const npcId = new ObjectId();
  const register = Object.fromEntries(
    Object.keys(RU_1991_ECONOMIC_REGION_POPULATION).map((id) => [id, 10000])
  );
  const districts = planRussianDumaDistricts(register);
  const ballots = [
    ...districts.map((row) => ({
      seatId: row.seatId,
      state: row.regionId,
      tier: "constituency",
      registeredVoters: row.registeredVoters,
      totalSeats: 1,
    })),
    {
      seatId: "RU-duma-national-list",
      state: "RU",
      tier: "list",
      registeredVoters: 100000,
      totalSeats: 225,
    },
  ];
  const elections = ballots.map((row) => ({
    _id: new ObjectId(),
    countryId: "RU",
    electionType: "dumaDeputy",
    status: "completed",
    endTurn: 141,
    seatId: row.seatId,
    state: row.state,
    totalSeats: row.totalSeats,
    russianDumaRound: {
      cohortId,
      mandateSinceTurn: 129,
      tier: row.tier,
      registeredVoters: row.registeredVoters,
    },
  }));
  const candidates = elections.map((election, index) => ({
    _id: new ObjectId(),
    electionId: election._id,
    countryId: "RU",
    isNPP: true,
    nppId: npcId,
    characterId: new ObjectId(),
    characterName: "Bounded NPC nominee",
    party: "1",
    status: "active",
    russianDumaNomination: {
      registrationOrder: 0,
      nominationOrder: 0,
      capacity: index === 225 ? 225 : 1,
    },
  }));
  const tallies = elections.map((election, index) => ({
    _id: new ObjectId(),
    electionId: election._id,
    finalized: false,
    totalVotes: {
      [candidates[index]._id.toHexString()]: election.russianDumaRound.registeredVoters,
    },
    candidateParties: { [candidates[index]._id.toHexString()]: "1" },
    russianDumaBallot: { againstAllVotes: 0 },
  }));
  mem.seed("gameState", [{ _id: "current", preset: "1991-default" }]);
  mem.seed("countryGameStates", [
    {
      _id: "RU",
      ruSovietSuccessionSinceTurn: 48,
      ruFederalAssemblyMandateSinceTurn: 129,
      ruFirstDumaElectionCohortId: cohortId,
    },
  ]);
  mem.seed("elections", elections);
  mem.seed("electionCandidates", candidates);
  mem.seed("electionVoteTallies", tallies);
  mem.seed("npps", [{ _id: npcId, countryId: "RU", party: "1" }]);
  mem.seed("electedOfficials", [
    { _id: new ObjectId(), countryId: "RU", officeType: "congressDeputy" },
  ]);
  return {
    mem,
    candidates,
    elections,
    tallies,
    cohortId,
    input: { db: mem as unknown as Db, session, cohortId, turn: 141, now: new Date(1000) },
  };
}
describe("Atomic first-Duma cohort certification", () => {
  it("ignores candidates withdrawn before the roster froze", async () => {
    const { mem, input } = scenario();
    const old: Record<string, unknown> & { _id: ObjectId } = {
      ...mem.collection("electionCandidates").docs[0],
      _id: new ObjectId(),
      status: "withdrawn",
    };
    delete old.russianDumaNomination;
    mem.collection("electionCandidates").docs.push(old);
    const result = await certify(input);
    expect(result.result.constituencyResults.filter((row) => row.winner)).toHaveLength(225);
    expect(result.nominees).toHaveLength(226);
    expect(result.nominees.some((row) => row.candidateId.equals(old._id))).toBe(false);
  });
  it("preserves counted votes of a later withdrawal without seating that candidate", async () => {
    const { mem, input } = scenario();
    mem.collection("electionCandidates").docs[0].status = "withdrawn";
    const result = await certify(input);
    expect(result.result.constituencyResults.filter((row) => row.winner)).toHaveLength(224);
    expect(
      Object.values(result.votesByElection[Object.keys(result.votesByElection)[0]].votes)[0]
    ).toBeGreaterThan(0);
    expect(result.nominees).toHaveLength(226);
  });
  it("certifies both tiers together, preserves Congress and replays the same journal", async () => {
    const { mem, input } = scenario();
    const result = await certify(input);
    expect(result.result.constituencyResults.filter((row) => row.winner)).toHaveLength(225);
    expect(Object.values(result.result.listAssignment!.seatsByNominee)).toEqual([225]);
    expect(mem.collection("elections").docs.every((row) => row.status === "resolved")).toBe(true);
    expect(
      mem.collection("electionCandidates").docs.every((row) => row.status === "withdrawn")
    ).toBe(true);
    expect(mem.collection("electionVoteTallies").docs.every((row) => row.finalized)).toBe(true);
    expect(mem.collection("electedOfficials").docs[0].officeType).toBe("congressDeputy");
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty(
      "ruFederalAssemblyElectionCertifiedSinceTurn"
    );
    expect(await certify(input)).toEqual(result);
    expect(mem.collection(RUSSIAN_DUMA_RESULTS_COLLECTION).docs).toHaveLength(1);
  });
  it("keeps low-turnout constituencies vacant without discarding the successful list", async () => {
    const { mem, candidates, input } = scenario();
    mem.collection("electionVoteTallies").docs[0].totalVotes = {
      [candidates[0]._id.toHexString()]: 0,
    };
    const result = await certify(input);
    expect(result.result.constituencyResults.filter((row) => row.winner)).toHaveLength(224);
    expect(result.result.listDecision.outcome).toBe("elected");
  });
  it("keeps a pending-relocation player protected and does not award their district", async () => {
    const { mem, input } = scenario();
    const playerId = new ObjectId();
    const row = mem.collection("electionCandidates").docs[0];
    row.characterId = playerId;
    row.isNPP = false;
    delete row.nppId;
    mem.seed("characters", [
      {
        _id: playerId,
        countryId: "RU",
        homeState: "CEN",
        party: "1",
        cash: 777,
        federationPendingResidenceId: "pending",
      },
    ]);
    const result = await certify(input);
    expect(result.result.constituencyResults.filter((row) => row.winner)).toHaveLength(224);
    expect(mem.collection("characters").docs[0]).toMatchObject({
      cash: 777,
      federationPendingResidenceId: "pending",
    });
  });
  it("does not award a retired NPC's mandates or invent substitute owners", async () => {
    const { mem, input } = scenario();
    mem.collection("npps").docs[0].retiredAt = new Date(1);
    const result = await certify(input);
    expect(result.result.constituencyResults.every((row) => !row.winner)).toBe(true);
    expect(result.result.listAssignment!.vacanciesByParty).toEqual({ "1": 225 });
  });
  it.each([
    "unfinished",
    "missing",
    "duplicate",
    "already-finalized",
    "changed-mandate",
    "unbound",
  ])("rejects %s ballots before changing any tally", async (defect) => {
    const { mem, input } = scenario();
    if (defect === "unfinished") mem.collection("elections").docs[0].status = "active";
    if (defect === "missing") mem.collection("electionVoteTallies").docs.pop();
    if (defect === "duplicate")
      mem.collection("electionVoteTallies").docs[0].electionId =
        mem.collection("electionVoteTallies").docs[1].electionId;
    if (defect === "already-finalized")
      mem.collection("electionVoteTallies").docs[0].finalized = true;
    if (defect === "changed-mandate")
      mem.collection("countryGameStates").docs[0].ruFederalAssemblyMandateSinceTurn = 130;
    if (defect === "unbound")
      delete mem.collection("electionCandidates").docs[0].russianDumaNomination;
    await expect(certify(input)).rejects.toThrow();
    expect(mem.collection("electionVoteTallies").docs.filter((row) => row.finalized)).toHaveLength(
      defect === "already-finalized" ? 1 : 0
    );
    expect(mem.collection(RUSSIAN_DUMA_RESULTS_COLLECTION).docs).toHaveLength(0);
  });
  it("rejects vote tampering outside the frozen roster", async () => {
    const { mem, input } = scenario();
    const tally = mem.collection("electionVoteTallies").docs[0];
    tally.totalVotes = { fabricated: 10 };
    await expect(certify(input)).rejects.toThrow("roster");
    expect(mem.collection("electionVoteTallies").docs.every((row) => !row.finalized)).toBe(true);
  });
  it("requires a transaction and refuses a corrupt replay identity", async () => {
    const { input, mem } = scenario();
    await expect(
      certify({ ...input, session: { inTransaction: () => false } as ClientSession })
    ).rejects.toThrow("transaction");
    await certify(input);
    mem.collection(RUSSIAN_DUMA_RESULTS_COLLECTION).docs[0].cohortId = new ObjectId();
    await expect(certify(input)).rejects.toThrow("identity");
  });
});
