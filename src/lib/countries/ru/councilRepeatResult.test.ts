import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { materializeRussianCouncilElectionOpening } from "./councilElectionOpening";
import { materializeRussianCouncilRepeatOpening } from "./councilRepeatOpening";
import { materializeRussianCouncilNpcAdmission } from "./councilNpcAdmission";
import { materializeRussianCouncilPlayerFiling } from "./councilPlayerFiling";
import { materializeRussianCouncilRepeatResult as certify } from "./councilRepeatResult";
import { RU_1991_ECONOMIC_REGION_POPULATION } from "./data/ruPopulation1991";
import { RUSSIAN_COUNCIL_RESULTS_COLLECTION } from "./councilElectionResult";
import {
  resolveRussianCouncilCohort,
  type RussianCouncilCohortBallot,
} from "./rules/councilCohort";
import type { Election, ElectionCandidate } from "@/lib/db/types";
const session = { inTransaction: () => true } as ClientSession;
async function scenario() {
  const mem = createInMemoryDb();
  const db = mem as unknown as Db;
  const rootCohortId = new ObjectId();
  const dumaId = new ObjectId();
  const playerId = new ObjectId();
  mem.seed("gameState", [{ _id: "current", preset: "1991-default" }]);
  mem.seed("countryGameStates", [
    {
      _id: "RU",
      ruSovietSuccessionSinceTurn: 48,
      ruFederalAssemblyMandateSinceTurn: 129,
      ruFirstDumaElectionCohortId: dumaId,
      ruDumaNpcAdmissionCohortId: dumaId,
    },
  ]);
  mem.seed(
    "states",
    Object.entries(RU_1991_ECONOMIC_REGION_POPULATION).map(([id, population]) => ({
      _id: id,
      countryId: "RU",
      population,
      votingEligiblePopulation: population * 0.7,
    }))
  );
  await materializeRussianCouncilElectionOpening({
    db,
    session,
    game: { preset: "1991-default" },
    turn: 129,
    now: new Date(0),
    cohortId: rootCohortId,
    electionIds: Array.from({ length: 89 }, () => new ObjectId()),
  });
  const ballots: RussianCouncilCohortBallot[] = mem.collection("elections").docs.map((row) => ({
    id: (row._id as ObjectId).toHexString(),
    seatId: String(row.seatId),
    regionId: String(row.state),
    registeredVoters: 1000,
    validBallots: row.seatId === "RU-council-77" ? 0 : 1000,
    againstAllVotes: 0,
    candidates: [0, 1, 2].map((order) => ({
      id: new ObjectId().toHexString(),
      ownerId: `npc-${order}`,
      party: String(order + 1),
      isNpc: true,
      eligible: true,
      registrationOrder: order,
      votes: row.seatId === "RU-council-77" ? 0 : [600, 500, 400][order],
    })),
  }));
  mem.seed(RUSSIAN_COUNCIL_RESULTS_COLLECTION, [
    {
      _id: rootCohortId.toHexString(),
      cohortId: rootCohortId,
      countryId: "RU",
      preset: "1991-default",
      mandateSinceTurn: 129,
      resolvedOnTurn: 141,
      ballots,
      result: resolveRussianCouncilCohort(ballots),
      nominees: [],
    },
  ]);
  const cohortId = new ObjectId();
  const repeated = await materializeRussianCouncilRepeatOpening({
    db,
    session,
    rootCohortId,
    previousResultId: rootCohortId.toHexString(),
    cohortId,
    electionIds: [new ObjectId()],
    turn: 142,
    now: new Date(1000),
  });
  mem.seed(
    "politicalParties",
    [1, 2, 3].map((sequentialId) => ({ _id: new ObjectId(), countryId: "RU", sequentialId }))
  );
  const profileIds = [1, 2, 3].map(() => new ObjectId());
  mem.seed(
    "npps",
    profileIds.map((_id, index) => ({
      _id,
      countryId: "RU",
      party: String(index + 1),
      homeState: "CEN",
      name: `Profile ${index}`,
      currentOffice: { type: "congressDeputy" },
      personalAccount: { wealth: 12345 },
    }))
  );
  const character = {
    _id: playerId,
    countryId: "RU" as const,
    homeState: "CEN",
    party: "1",
    currentOffice: null,
  };
  mem.seed("characters", [{ ...character, personalAccount: { wealth: 23456 } }]);
  const election = mem
    .collection("elections")
    .docs.find((row) =>
      (row._id as ObjectId).equals(repeated!.record.electionIds[0])
    ) as unknown as Election;
  const npc = { db, session, cohortId, turn: 143, now: new Date(2000) };
  const filing = { db, election, character, turn: 143, registrationOrder: 3000, session };
  return {
    mem,
    db,
    rootCohortId,
    cohortId,
    profileIds,
    character,
    election,
    npc,
    filing,
    repeated,
  };
}
async function certificationScenario(player = false) {
  const setup = await scenario();
  await materializeRussianCouncilNpcAdmission(setup.npc);
  if (player) {
    const candidate: Omit<ElectionCandidate, "_id"> = {
      electionId: setup.election._id,
      countryId: "RU",
      characterId: setup.character._id,
      characterName: "Repeat player",
      party: "1",
      status: "active",
      enteredAt: new Date(3000),
    };
    expect(
      await materializeRussianCouncilPlayerFiling({
        db: setup.db,
        session,
        electionId: setup.election._id,
        candidateId: new ObjectId(),
        candidate,
        turn: 143,
        now: new Date(3000),
      })
    ).toMatchObject({ allowed: true });
  }
  const stored = setup.mem
    .collection("elections")
    .docs.find((row) => (row._id as ObjectId).equals(setup.election._id))!;
  stored.status = "completed";
  stored.endTurn = 154;
  const nominees = setup.mem
    .collection("electionCandidates")
    .docs.filter((row) => row.status === "active")
    .sort((a, b) => Number(!b.isNPP) - Number(!a.isNPP));
  const voters = setup.election.russianCouncilRound!.registeredVoters;
  setup.mem.seed("electionVoteTallies", [
    {
      _id: new ObjectId(),
      electionId: setup.election._id,
      finalized: false,
      totalVotes: Object.fromEntries(
        nominees.map((row, index) => [
          (row._id as ObjectId).toHexString(),
          index === 0 ? voters : index === 1 ? Math.floor(voters / 2) : 0,
        ])
      ),
      candidateParties: Object.fromEntries(
        nominees.map((row) => [(row._id as ObjectId).toHexString(), row.party])
      ),
      russianCouncilBallot: {
        registeredVoters: voters,
        validBallots: voters,
        againstAllVotes: 0,
        registrationOrderByCandidate: Object.fromEntries(
          nominees.map((row) => [
            (row._id as ObjectId).toHexString(),
            (row.russianCouncilNomination as { registrationOrder: number }).registrationOrder,
          ])
        ),
      },
    },
  ]);
  const input = {
    db: setup.db,
    session,
    rootCohortId: setup.rootCohortId,
    generation: 1,
    turn: 154,
    now: new Date(4000),
  };
  return { ...setup, input };
}
describe("Council repeat certification preserves accumulated mandates", () => {
  it("certifies only the replacement poll, retires current entries and keeps the predecessor unchanged", async () => {
    const { mem, input, cohortId, election } = await certificationScenario();
    const previous = structuredClone(mem.collection(RUSSIAN_COUNCIL_RESULTS_COLLECTION).docs[0]);
    const receipt = await certify(input);
    expect(receipt).toMatchObject({ cohortId, rootCohortId: input.rootCohortId, generation: 1 });
    expect(receipt.result.reduce((sum, row) => sum + row.winners.length, 0)).toBe(178);
    expect(receipt.ballots).toHaveLength(89);
    expect(mem.collection(RUSSIAN_COUNCIL_RESULTS_COLLECTION).docs[0]).toEqual(previous);
    expect(mem.collection("electionVoteTallies").docs[0]).toMatchObject({
      finalized: true,
      russianCouncilBallot: { outcome: "elected", certifiedCohortId: cohortId },
    });
    expect(
      mem.collection("electionCandidates").docs.every((row) => row.status === "withdrawn")
    ).toBe(true);
    expect(
      mem.collection("elections").docs.find((row) => (row._id as ObjectId).equals(election._id))
        ?.status
    ).toBe("resolved");
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty(
      "ruFederalAssemblySinceTurn"
    );
    expect(await certify({ ...input, turn: 155 })).toEqual(receipt);
    expect(mem.collection(RUSSIAN_COUNCIL_RESULTS_COLLECTION).docs).toHaveLength(2);
  });
  it("certifies an eligible player admitted to the repeat rather than rejecting all players", async () => {
    const { input, character } = await certificationScenario(true);
    const receipt = await certify(input);
    expect(
      receipt.result[76].winners.some(
        (row) => !row.isNpc && row.ownerId === character._id.toHexString()
      )
    ).toBe(true);
  });
  it("preserves a lawful second-seat vacancy in a successful subject", async () => {
    const { mem, input } = await certificationScenario();
    const previous = mem.collection(RUSSIAN_COUNCIL_RESULTS_COLLECTION).docs[0];
    const ballots = previous.ballots as RussianCouncilCohortBallot[];
    ballots[0].againstAllVotes = 600;
    ballots[0].candidates.forEach((row, index) => (row.votes = [300, 250, 150][index]));
    previous.result = resolveRussianCouncilCohort(ballots);
    const receipt = await certify(input);
    expect(receipt.result[0].winners).toHaveLength(1);
    expect(receipt.result[0].vacancies).toBe(1);
    expect(receipt.result.reduce((sum, row) => sum + row.winners.length, 0)).toBe(177);
  });
  it("retains a failed replacement for the next generation rather than forcing a winner", async () => {
    const { mem, input } = await certificationScenario();
    const tally = mem.collection("electionVoteTallies").docs[0];
    tally.totalVotes = Object.fromEntries(
      Object.keys(tally.totalVotes as object).map((id) => [id, 0])
    );
    (tally.russianCouncilBallot as { validBallots: number }).validBallots = 0;
    const receipt = await certify(input);
    expect(receipt.result[76].decision.outcome).toBe("repeat");
    expect(receipt.result.reduce((sum, row) => sum + row.winners.length, 0)).toBe(176);
  });
  it.each([
    "unfinished",
    "wrong-register",
    "wrong-predecessor",
    "wrong-generation",
    "changed-mandate",
    "handed-over",
  ])("rejects %s before result writes", async (defect) => {
    const { mem, input, election } = await certificationScenario();
    const stored = mem
      .collection("elections")
      .docs.find((row) => (row._id as ObjectId).equals(election._id))!;
    const round = stored.russianCouncilRound as {
      registeredVoters: number;
      predecessorElectionId: ObjectId;
      generation: number;
    };
    if (defect === "unfinished") stored.status = "active";
    if (defect === "wrong-register") round.registeredVoters++;
    if (defect === "wrong-predecessor") round.predecessorElectionId = new ObjectId();
    if (defect === "wrong-generation") round.generation = 2;
    if (defect === "changed-mandate")
      mem.collection("countryGameStates").docs[0].ruFederalAssemblyMandateSinceTurn = 130;
    if (defect === "handed-over")
      mem.collection("countryGameStates").docs[0].ruFederalAssemblySinceTurn = 154;
    await expect(certify(input)).rejects.toThrow();
    expect(mem.collection("electionVoteTallies").docs[0].finalized).toBe(false);
    expect(mem.collection(RUSSIAN_COUNCIL_RESULTS_COLLECTION).docs).toHaveLength(1);
  });
});
