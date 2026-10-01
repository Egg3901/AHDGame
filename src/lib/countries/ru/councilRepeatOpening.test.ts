import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { RU_1991_ECONOMIC_REGION_POPULATION } from "./data/ruPopulation1991";
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "./data/councilSubjects1993";
import {
  resolveRussianCouncilCohort,
  type RussianCouncilCohortBallot,
} from "./rules/councilCohort";
import { materializeRussianCouncilRepeatOpening as open } from "./councilRepeatOpening";
import { RUSSIAN_COUNCIL_RESULTS_COLLECTION } from "./councilElectionResult";
import { RUSSIAN_COUNCIL_OPENINGS_COLLECTION } from "./councilElectionOpening";
const session = { inTransaction: () => true } as ClientSession;
function scenario() {
  const mem = createInMemoryDb();
  const rootCohortId = new ObjectId();
  const ballots: RussianCouncilCohortBallot[] = RUSSIAN_COUNCIL_SUBJECTS_1993.map(
    ([number, , regionId]) => ({
      id: new ObjectId().toHexString(),
      seatId: `RU-council-${number}`,
      regionId,
      registeredVoters: 1000,
      validBallots: number === 1 || number === 89 ? 0 : 1000,
      againstAllVotes: number === 2 ? 600 : 0,
      candidates: [0, 1, 2].map((order) => ({
        id: new ObjectId().toHexString(),
        ownerId: `npc-${order}`,
        party: String(order + 1),
        isNpc: true,
        eligible: true,
        registrationOrder: order,
        votes:
          number === 1 || number === 89
            ? 0
            : number === 2
              ? [300, 250, 150][order]
              : [600, 500, 400][order],
      })),
    })
  );
  const receipt = {
    _id: rootCohortId.toHexString(),
    cohortId: rootCohortId,
    countryId: "RU",
    preset: "1991-default",
    mandateSinceTurn: 129,
    resolvedOnTurn: 141,
    createdAt: new Date(0),
    ballots,
    result: resolveRussianCouncilCohort(ballots),
    nominees: [],
  };
  mem.seed(RUSSIAN_COUNCIL_RESULTS_COLLECTION, [receipt]);
  mem.seed("gameState", [{ _id: "current", preset: "1991-default" }]);
  mem.seed("countryGameStates", [
    {
      _id: "RU",
      ruSovietSuccessionSinceTurn: 48,
      ruFederalAssemblyMandateSinceTurn: 129,
      ruFirstCouncilElectionCohortId: rootCohortId,
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
  mem.seed("stateRegistrationPool", []);
  mem.seed("electedOfficials", [
    { _id: new ObjectId(), countryId: "RU", officeType: "congressDeputy" },
  ]);
  const input = {
    db: mem as unknown as Db,
    session,
    rootCohortId,
    previousResultId: receipt._id,
    cohortId: new ObjectId(),
    electionIds: [new ObjectId(), new ObjectId()],
    turn: 142,
    now: new Date(1000),
  };
  return { mem, input, receipt };
}
describe("Council repeat atomic opening", () => {
  it("reopens only failed subjects with fresh registers and preserves a lawful first mandate", async () => {
    const { mem, input, receipt } = scenario();
    const before = structuredClone(receipt);
    const opened = await open(input);
    expect(opened?.created).toBe(true);
    expect(opened?.record).toMatchObject({
      generation: 1,
      previousResultId: receipt._id,
      rootCohortId: input.rootCohortId,
      seatIds: ["RU-council-1", "RU-council-89"],
    });
    const elections = mem.collection("elections").docs;
    expect(elections).toHaveLength(2);
    expect(elections[0]).toMatchObject({
      state: receipt.ballots[0].regionId,
      totalSeats: 2,
      startTurn: 142,
      primaryEndTurn: 152,
      endTurn: 154,
      russianCouncilRound: {
        generation: 1,
        rootCohortId: input.rootCohortId,
        predecessorElectionId: new ObjectId(receipt.ballots[0].id),
        districtNumber: 1,
      },
    });
    expect(elections[0].russianCouncilRound).not.toMatchObject({ registeredVoters: 1000 });
    expect(mem.collection(RUSSIAN_COUNCIL_RESULTS_COLLECTION).docs[0]).toEqual(before);
    expect(mem.collection("electedOfficials").docs).toHaveLength(1);
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty(
      "ruFederalAssemblySinceTurn"
    );
  });
  it("opens after handover using the original Council clock and immutable seating proof", async () => {
    const { mem, input, receipt } = scenario();
    const dumaRoot = new ObjectId();
    const country = mem.collection("countryGameStates").docs[0];
    country.ruFirstDumaElectionCohortId = dumaRoot;
    country.ruFederalAssemblySinceTurn = 145;
    mem.collection(RUSSIAN_COUNCIL_RESULTS_COLLECTION).docs[0].seatedOnTurn = 145;
    mem.seed("russianAssemblySeatings", [
      {
        _id: `${dumaRoot.toHexString()}:${input.rootCohortId.toHexString()}`,
        countryId: "RU",
        preset: "1991-default",
        dumaRootCohortId: dumaRoot,
        councilRootCohortId: input.rootCohortId,
        dumaResultId: dumaRoot.toHexString(),
        councilResultId: receipt._id,
        seatedOnTurn: 145,
        dumaTermEndTurn: 237,
        councilTermEndTurn: 237,
      },
    ]);
    expect((await open({ ...input, turn: 150 }))?.created).toBe(true);
    expect(country.ruFederalAssemblySinceTurn).toBe(145);
    expect(mem.collection("russianAssemblySeatings").docs).toHaveLength(1);
  });
  it("replays without refreshing electorate, replacing identities or opening another generation", async () => {
    const { mem, input } = scenario();
    const first = await open(input);
    const before = structuredClone(mem.collection("elections").docs);
    mem.collection("states").docs[0].votingEligiblePopulation = 0;
    expect(await open({ ...input, cohortId: new ObjectId(), electionIds: [], turn: 143 })).toEqual({
      record: first?.record,
      created: false,
    });
    expect(mem.collection("elections").docs).toEqual(before);
    expect(mem.collection(RUSSIAN_COUNCIL_OPENINGS_COLLECTION).docs).toHaveLength(1);
  });
  it.each([
    "missing-receipt",
    "wrong-root",
    "wrong-mandate",
    "future-result",
    "seated-result",
    "incomplete-family",
    "invalid-generation",
    "missing-generation-opening",
    "handed-over",
  ])("rejects %s before creating polls", async (defect) => {
    const { mem, input } = scenario();
    const receipt = mem.collection(RUSSIAN_COUNCIL_RESULTS_COLLECTION).docs[0];
    if (defect === "missing-receipt") mem.collection(RUSSIAN_COUNCIL_RESULTS_COLLECTION).docs.pop();
    if (defect === "wrong-root") receipt.cohortId = new ObjectId();
    if (defect === "wrong-mandate") receipt.mandateSinceTurn = 130;
    if (defect === "future-result") receipt.resolvedOnTurn = 143;
    if (defect === "seated-result") receipt.seatedOnTurn = 142;
    if (defect === "incomplete-family") (receipt.ballots as unknown[]).pop();
    if (defect === "invalid-generation") receipt.generation = -1;
    if (defect === "missing-generation-opening") {
      const next = new ObjectId();
      receipt._id = next.toHexString();
      receipt.cohortId = next;
      receipt.rootCohortId = input.rootCohortId;
      receipt.generation = 1;
      input.previousResultId = String(receipt._id);
    }
    if (defect === "handed-over")
      mem.collection("countryGameStates").docs[0].ruFederalAssemblySinceTurn = 142;
    await expect(open(input)).rejects.toThrow();
    expect(mem.collection("elections").docs).toHaveLength(0);
  });
  it.each(["duplicate", "missing", "old-ballot", "old-cohort"])(
    "rejects %s identities",
    async (defect) => {
      const { mem, input, receipt } = scenario();
      if (defect === "duplicate") input.electionIds[1] = input.electionIds[0];
      if (defect === "missing") input.electionIds.pop();
      if (defect === "old-ballot") input.electionIds[0] = new ObjectId(receipt.ballots[1].id);
      if (defect === "old-cohort") input.cohortId = input.rootCohortId;
      await expect(open(input)).rejects.toThrow("distinct");
      expect(mem.collection("elections").docs).toHaveLength(0);
    }
  );
  it("validates repeated generations against their original mandate and opening", async () => {
    const { mem, input } = scenario();
    const first = await open(input);
    const receipt = mem.collection(RUSSIAN_COUNCIL_RESULTS_COLLECTION).docs[0];
    receipt._id = input.cohortId.toHexString();
    receipt.cohortId = input.cohortId;
    receipt.rootCohortId = input.rootCohortId;
    receipt.generation = 1;
    const accumulated = receipt.ballots as RussianCouncilCohortBallot[];
    for (const [index, seatId] of first!.record.seatIds!.entries())
      accumulated.find((row) => row.seatId === seatId)!.id =
        first!.record.electionIds[index].toHexString();
    const next = await open({
      ...input,
      previousResultId: String(receipt._id),
      cohortId: new ObjectId(),
      electionIds: [new ObjectId(), new ObjectId()],
      turn: 155,
    });
    expect(next?.record.generation).toBe(2);
    expect(next?.record.previousResultId).toBe(first?.record.cohortId.toHexString());
  });
  it("skips other presets and requires valid transaction inputs", async () => {
    const { mem, input } = scenario();
    mem.collection("gameState").docs[0].preset = "2019-default";
    expect(await open(input)).toBeNull();
    await expect(
      open({ ...input, session: { inTransaction: () => false } as ClientSession })
    ).rejects.toThrow("transaction");
    await expect(open({ ...input, turn: 0 })).rejects.toThrow("turn");
    await expect(open({ ...input, now: new Date(NaN) })).rejects.toThrow("time");
  });
});
