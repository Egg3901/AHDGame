import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "./data/councilSubjects1993";
import { RUSSIAN_COUNCIL_OPENINGS_COLLECTION } from "./councilElectionOpening";
import { RUSSIAN_DUMA_RESULTS_COLLECTION } from "./dumaElectionResult";
import {
  materializeRussianCouncilElectionResult as certify,
  RUSSIAN_COUNCIL_RESULTS_COLLECTION,
} from "./councilElectionResult";
const session = { inTransaction: () => true } as ClientSession;
function scenario() {
  const mem = createInMemoryDb();
  const cohortId = new ObjectId();
  const owners = [new ObjectId(), new ObjectId(), new ObjectId()];
  const elections = RUSSIAN_COUNCIL_SUBJECTS_1993.map(([number, , region]) => ({
    _id: new ObjectId(),
    countryId: "RU",
    electionType: "federationCouncilMember",
    status: "completed",
    endTurn: 141,
    seatId: `RU-council-${number}`,
    state: region,
    totalSeats: 2,
    russianCouncilRound: {
      cohortId,
      mandateSinceTurn: 129,
      districtNumber: number,
      registeredVoters: 1000,
    },
  }));
  const candidates = elections.flatMap((election) =>
    owners.map((ownerId, order) => ({
      _id: new ObjectId(),
      electionId: election._id,
      countryId: "RU",
      characterId: ownerId,
      nppId: ownerId,
      isNPP: true,
      characterName: `Bounded nominee ${order}`,
      party: String(order + 1),
      status: "active",
      russianCouncilNomination: { registrationOrder: order },
    }))
  );
  const tallies = elections.map((election, index) => {
    const nominees = candidates.slice(index * 3, index * 3 + 3);
    return {
      _id: new ObjectId(),
      electionId: election._id,
      finalized: false,
      totalVotes: Object.fromEntries(
        nominees.map((row, order) => [row._id.toHexString(), [600, 500, 400][order]])
      ),
      candidateParties: Object.fromEntries(
        nominees.map((row) => [row._id.toHexString(), row.party])
      ),
      russianCouncilBallot: {
        registeredVoters: 1000,
        validBallots: 1000,
        againstAllVotes: 0,
        registrationOrderByCandidate: Object.fromEntries(
          nominees.map((row, order) => [row._id.toHexString(), order])
        ),
      },
    };
  });
  mem.seed("gameState", [{ _id: "current", preset: "1991-default" }]);
  mem.seed("countryGameStates", [
    {
      _id: "RU",
      ruSovietSuccessionSinceTurn: 48,
      ruFederalAssemblyMandateSinceTurn: 129,
      ruFirstCouncilElectionCohortId: cohortId,
    },
  ]);
  mem.seed(RUSSIAN_COUNCIL_OPENINGS_COLLECTION, [
    {
      _id: cohortId.toHexString(),
      cohortId,
      countryId: "RU",
      preset: "1991-default",
      mandateSinceTurn: 129,
      electionIds: elections.map((row) => row._id),
      registeredBySubject: Object.fromEntries(elections.map((row) => [row.seatId, 1000])),
    },
  ]);
  mem.seed("elections", elections);
  mem.seed("electionCandidates", candidates);
  mem.seed("electionVoteTallies", tallies);
  mem.seed(
    "npps",
    owners.map((_id, order) => ({
      _id,
      countryId: "RU",
      party: String(order + 1),
      currentOffice: null,
      wealth: 12345,
    }))
  );
  mem.seed("electedOfficials", [
    { _id: new ObjectId(), countryId: "RU", officeType: "congressDeputy" },
  ]);
  return {
    mem,
    candidates,
    owners,
    elections,
    tallies,
    cohortId,
    input: { db: mem as unknown as Db, session, cohortId, turn: 141, now: new Date(1000) },
  };
}
describe("First Council cohort certification", () => {
  it("freezes89 results and178 individual mandates, preserves Congress/accounts and replays", async () => {
    const { mem, input } = scenario();
    const receipt = await certify(input);
    expect(receipt.result).toHaveLength(89);
    expect(receipt.result.reduce((sum, row) => sum + row.winners.length, 0)).toBe(178);
    expect(mem.collection("elections").docs.every((row) => row.status === "resolved")).toBe(true);
    expect(mem.collection("electionVoteTallies").docs.every((row) => row.finalized)).toBe(true);
    expect(
      mem.collection("electionCandidates").docs.every((row) => row.status === "withdrawn")
    ).toBe(true);
    expect(mem.collection("electedOfficials").docs[0].officeType).toBe("congressDeputy");
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty(
      "ruFederalAssemblySinceTurn"
    );
    expect(mem.collection("npps").docs.every((row) => row.wealth === 12345)).toBe(true);
    expect(await certify(input)).toEqual(receipt);
    expect(mem.collection(RUSSIAN_COUNCIL_RESULTS_COLLECTION).docs).toHaveLength(1);
  });
  it("preserves a lawful second-seat vacancy caused by against-all votes", async () => {
    const { mem, candidates, input } = scenario();
    const tally = mem.collection("electionVoteTallies").docs[0];
    tally.totalVotes = Object.fromEntries(
      candidates.slice(0, 3).map((row, order) => [row._id.toHexString(), [300, 250, 150][order]])
    );
    (tally.russianCouncilBallot as Record<string, unknown>).againstAllVotes = 600;
    const receipt = await certify(input);
    expect(receipt.result[0].winners).toHaveLength(1);
    expect(receipt.result[0].vacancies).toBe(1);
  });
  it("retains marks cast for a withdrawn winner and requires a repeat without substitution", async () => {
    const { mem, input } = scenario();
    mem.collection("electionCandidates").docs[0].status = "withdrawn";
    const receipt = await certify(input);
    expect(receipt.result[0].decision).toMatchObject({
      outcome: "repeat",
      reason: "ineligible-winner",
    });
    expect(receipt.result[0].winners).toEqual([]);
    expect(receipt.ballots[0].candidates[0].votes).toBe(600);
  });
  it("records an unheld zero-vote poll as a repeat without inventing participation", async () => {
    const { mem, input } = scenario();
    const tally = mem.collection("electionVoteTallies").docs[0];
    tally.totalVotes = {};
    tally.candidateParties = {};
    delete tally.russianCouncilBallot;
    const receipt = await certify(input);
    expect(receipt.result[0].decision).toMatchObject({ outcome: "repeat", validBallots: 0 });
  });
  it.each(["eligible", "pending-residence", "moved", "party", "office", "pending-duma"])(
    "does not seat a player with %s",
    async (defect) => {
      const { mem, input, candidates } = scenario();
      const player = new ObjectId();
      const nominee = mem.collection("electionCandidates").docs[0];
      nominee.isNPP = false;
      nominee.characterId = player;
      delete nominee.nppId;
      mem.seed("characters", [
        {
          _id: player,
          countryId: "RU",
          homeState: defect === "moved" ? "CEN" : "NCA",
          party: defect === "party" ? "2" : "1",
          currentOffice: defect === "office" ? { type: "president" } : null,
          ...(defect === "pending-residence" ? { federationPendingResidenceId: "pending" } : {}),
          wealth: 23456,
        },
      ]);
      if (defect === "pending-duma") {
        const dumaId = new ObjectId();
        mem.collection("countryGameStates").docs[0].ruFirstDumaElectionCohortId = dumaId;
        mem.seed(RUSSIAN_DUMA_RESULTS_COLLECTION, [
          {
            _id: dumaId.toHexString(),
            cohortId: dumaId,
            countryId: "RU",
            preset: "1991-default",
            mandateSinceTurn: 129,
            result: {
              constituencyResults: [],
              listAssignment: { seatsByNominee: { [candidates[0]._id.toHexString()]: 1 } },
            },
            nominees: [{ candidateId: candidates[0]._id, ownerId: player, isNpc: false }],
          },
        ]);
      }
      const receipt = await certify(input);
      expect(receipt.result[0].winners).toHaveLength(defect === "eligible" ? 2 : 0);
      expect(mem.collection("characters").docs[0].wealth).toBe(23456);
    }
  );
  it.each([
    "unfinished",
    "missing",
    "duplicate",
    "finalized",
    "mandate",
    "register",
    "opening-id",
    "marks-without-ledger",
    "unknown-mark",
    "nomination-order",
  ])("rejects %s before writes", async (defect) => {
    const { mem, input } = scenario();
    const elections = mem.collection("elections").docs;
    const tallies = mem.collection("electionVoteTallies").docs;
    if (defect === "unfinished") elections[0].status = "active";
    if (defect === "missing") tallies.pop();
    if (defect === "duplicate") tallies[0].electionId = tallies[1].electionId;
    if (defect === "finalized") tallies[0].finalized = true;
    if (defect === "mandate")
      mem.collection("countryGameStates").docs[0].ruFederalAssemblyMandateSinceTurn = 130;
    if (defect === "register")
      (elections[0].russianCouncilRound as Record<string, unknown>).registeredVoters = 2000;
    if (defect === "opening-id")
      (mem.collection(RUSSIAN_COUNCIL_OPENINGS_COLLECTION).docs[0].electionIds as ObjectId[])[0] =
        new ObjectId();
    if (defect === "marks-without-ledger") delete tallies[0].russianCouncilBallot;
    if (defect === "unknown-mark")
      (tallies[0].totalVotes as Record<string, number>)[new ObjectId().toHexString()] = 1;
    if (defect === "nomination-order")
      (
        mem.collection("electionCandidates").docs[0].russianCouncilNomination as Record<
          string,
          unknown
        >
      ).registrationOrder = 10;
    const before = JSON.stringify(tallies);
    await expect(certify(input)).rejects.toThrow();
    expect(JSON.stringify(tallies)).toBe(before);
    expect(mem.collection(RUSSIAN_COUNCIL_RESULTS_COLLECTION).docs).toHaveLength(0);
  });
});
