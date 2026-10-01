import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { materializeRussianCouncilElectionOpening } from "./councilElectionOpening";
import { materializeRussianCouncilRepeatOpening } from "./councilRepeatOpening";
import { materializeRussianCouncilNpcAdmission } from "./councilNpcAdmission";
import {
  materializeRussianCouncilPlayerFiling,
  validateRussianCouncilPlayerFiling,
} from "./councilPlayerFiling";
import { loadRussianCouncilOpeningBinding } from "./councilOpeningBinding";
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
describe("Council repeat admission uses the frozen generation", () => {
  it("admits bounded association nominees only into the failed subject and replays once", async () => {
    const { mem, npc, election, rootCohortId } = await scenario();
    expect(await materializeRussianCouncilNpcAdmission(npc)).toEqual({
      created: 6,
      unrepresentedParties: [],
    });
    expect(mem.collection("electionCandidates").docs).toHaveLength(6);
    expect(
      mem
        .collection("electionCandidates")
        .docs.every((row) => (row.electionId as ObjectId).equals(election._id))
    ).toBe(true);
    expect(await materializeRussianCouncilNpcAdmission(npc)).toEqual({
      created: 0,
      unrepresentedParties: [],
    });
    expect(
      (
        mem.collection("countryGameStates").docs[0].ruFirstCouncilElectionCohortId as ObjectId
      ).equals(rootCohortId)
    ).toBe(true);
    expect(
      mem
        .collection("npps")
        .docs.every((row) => (row.personalAccount as { wealth: number }).wealth === 12345)
    ).toBe(true);
  });
  it("keeps Duma profiles reserved and reports an unrepresented association", async () => {
    const { mem, npc, profileIds } = await scenario();
    mem.seed("electionCandidates", [
      {
        _id: new ObjectId(),
        countryId: "RU",
        isNPP: true,
        nppId: profileIds[0],
        russianDumaNomination: { capacity: 1 },
        status: "withdrawn",
        electionId: new ObjectId(),
      },
    ]);
    expect(await materializeRussianCouncilNpcAdmission(npc)).toEqual({
      created: 4,
      unrepresentedParties: ["1"],
    });
  });
  it("admits a player into a bounded slot without changing the root cohort or accounts", async () => {
    const { mem, npc, filing, election, character, rootCohortId } = await scenario();
    await materializeRussianCouncilNpcAdmission(npc);
    expect(await validateRussianCouncilPlayerFiling(filing)).toMatchObject({ allowed: true });
    const candidate: Omit<ElectionCandidate, "_id"> = {
      electionId: election._id,
      countryId: "RU",
      characterId: character._id,
      characterName: "Repeat player",
      party: "1",
      status: "active",
      enteredAt: new Date(3000),
      support: 0,
    };
    expect(
      await materializeRussianCouncilPlayerFiling({
        db: filing.db,
        session,
        electionId: election._id,
        candidateId: new ObjectId(),
        candidate,
        turn: 143,
        now: new Date(3000),
      })
    ).toMatchObject({ allowed: true });
    expect(
      mem.collection("electionCandidates").docs.filter((row) => row.status === "active")
    ).toHaveLength(6);
    expect(
      (
        mem.collection("countryGameStates").docs[0].ruFirstCouncilElectionCohortId as ObjectId
      ).equals(rootCohortId)
    ).toBe(true);
    expect(
      (mem.collection("characters").docs[0].personalAccount as { wealth: number }).wealth
    ).toBe(23456);
  });
  it("rejects an already certified Council player even before seating", async () => {
    const { mem, filing, character } = await scenario();
    const receipt = mem.collection(RUSSIAN_COUNCIL_RESULTS_COLLECTION).docs[0];
    (
      receipt.result as Array<{ winners: Array<{ ownerId: string; isNpc: boolean }> }>
    )[0].winners[0] = { ownerId: character._id.toHexString(), isNpc: false };
    expect(await validateRussianCouncilPlayerFiling(filing)).toEqual({
      allowed: false,
      reason: "council-mandate",
    });
  });
  it.each(["root", "generation", "identity", "predecessor", "register", "subject"])(
    "rejects changed repeat %s before admission",
    async (defect) => {
      const { mem, npc, filing, election } = await scenario();
      const opening = mem.collection("russianCouncilElectionOpenings").docs[1];
      if (defect === "root") opening.rootCohortId = new ObjectId();
      if (defect === "generation") opening.generation = 2;
      if (defect === "identity") opening._id = "changed";
      if (defect === "predecessor") opening.previousResultId = new ObjectId().toHexString();
      if (defect === "register") election.russianCouncilRound!.registeredVoters++;
      if (defect === "subject") opening.seatIds = ["RU-council-1"];
      expect(await validateRussianCouncilPlayerFiling(filing)).toMatchObject({ allowed: false });
      if (defect !== "register")
        await expect(materializeRussianCouncilNpcAdmission(npc)).rejects.toThrow();
      expect(mem.collection("electionCandidates").docs).toHaveLength(0);
    }
  );
  it("rejects a changed persisted repeat register before NPC admission writes", async () => {
    const { mem, npc, election } = await scenario();
    const stored = mem
      .collection("elections")
      .docs.find((row) => (row._id as ObjectId).equals(election._id))!;
    (stored.russianCouncilRound as { registeredVoters: number }).registeredVoters++;
    await expect(materializeRussianCouncilNpcAdmission(npc)).rejects.toThrow("ballot bindings");
    expect(mem.collection("electionCandidates").docs).toHaveLength(0);
  });
  it("loads the original and repeat opening without accepting a foreign family", async () => {
    const { mem, db, rootCohortId, cohortId } = await scenario();
    const country = mem.collection("countryGameStates").docs[0] as unknown as Parameters<
      typeof loadRussianCouncilOpeningBinding
    >[0]["country"];
    expect(
      (await loadRussianCouncilOpeningBinding({ db, country, cohortId: rootCohortId }))?.ballots
    ).toHaveLength(89);
    expect(
      (await loadRussianCouncilOpeningBinding({ db, country, cohortId }))?.ballots
    ).toHaveLength(1);
    expect(
      await loadRussianCouncilOpeningBinding({ db, country, cohortId: new ObjectId() })
    ).toBeNull();
  });
});
