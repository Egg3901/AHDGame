import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { RU_1991_ECONOMIC_REGION_POPULATION } from "./data/ruPopulation1991";
import {
  materializeRussianCouncilElectionOpening as open,
  RUSSIAN_COUNCIL_OPENINGS_COLLECTION,
} from "./councilElectionOpening";
const session = { inTransaction: () => true } as ClientSession;
function scenario() {
  const mem = createInMemoryDb();
  mem.seed("countryGameStates", [
    { _id: "RU", ruSovietSuccessionSinceTurn: 48, ruFederalAssemblyMandateSinceTurn: 129 },
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
  mem.seed("stateRegistrationPool", [
    { _id: "RU_CEN", countryId: "RU", stateId: "CEN", unregistered: 10 },
  ]);
  mem.seed("electedOfficials", [
    { _id: new ObjectId(), countryId: "RU", officeType: "congressDeputy" },
  ]);
  const input = {
    db: mem as unknown as Db,
    session,
    game: { preset: "1991-default" },
    turn: 129,
    now: new Date(1000),
    cohortId: new ObjectId(),
    electionIds: Array.from({ length: 89 }, () => new ObjectId()),
  };
  return { input, mem };
}
describe("First Council atomic opening", () => {
  it("opens every subject and 178 mandates with a frozen opening receipt while preserving Congress", async () => {
    const { input, mem } = scenario();
    expect(await open(input)).toEqual({ cohortId: input.cohortId, created: true });
    const ballots = mem.collection("elections").docs;
    expect(ballots).toHaveLength(89);
    expect(ballots.reduce((sum, row) => sum + Number(row.totalSeats), 0)).toBe(178);
    expect(ballots[19]).toMatchObject({
      electionType: "federationCouncilMember",
      seatId: "RU-council-20",
      state: "NCA",
      totalSeats: 2,
      startTurn: 129,
      primaryEndTurn: 139,
      endTurn: 141,
      electionYear: 1993,
    });
    expect(mem.collection(RUSSIAN_COUNCIL_OPENINGS_COLLECTION).docs).toHaveLength(1);
    expect(mem.collection("electedOfficials").docs).toHaveLength(1);
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty(
      "ruFederalAssemblySinceTurn"
    );
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty(
      "ruCongressDissolvedSinceTurn"
    );
  });
  it("replays the frozen receipt without reopening or refreshing registration", async () => {
    const { input, mem } = scenario();
    await open(input);
    const before = structuredClone(mem.collection("elections").docs);
    mem.collection("stateRegistrationPool").docs[0].unregistered = 90;
    expect(await open({ ...input, turn: 130, cohortId: new ObjectId(), electionIds: [] })).toEqual({
      cohortId: input.cohortId,
      created: false,
    });
    expect(mem.collection("elections").docs).toEqual(before);
    expect(mem.collection(RUSSIAN_COUNCIL_OPENINGS_COLLECTION).docs).toHaveLength(1);
  });
  it.each([
    "missing",
    "wrong-region",
    "changed-register",
    "changed-number",
    "changed-mandate",
    "changed-election",
    "missing-receipt",
  ])("rejects %s on replay", async (reason) => {
    const { input, mem } = scenario();
    await open(input);
    const rows = mem.collection("elections").docs;
    const binding = rows[0].russianCouncilRound as {
      registeredVoters: number;
      districtNumber: number;
      mandateSinceTurn: number;
    };
    if (reason === "missing") rows.pop();
    if (reason === "wrong-region") rows[0].state = "CEN";
    if (reason === "changed-register") binding.registeredVoters++;
    if (reason === "changed-number") binding.districtNumber++;
    if (reason === "changed-mandate") binding.mandateSinceTurn++;
    if (reason === "changed-election") rows[0]._id = new ObjectId();
    if (reason === "missing-receipt")
      mem.collection(RUSSIAN_COUNCIL_OPENINGS_COLLECTION).docs.pop();
    await expect(open(input)).rejects.toThrow("no longer matches");
  });
  it("requires an enacted post-Soviet mandate and founding-aware September 1993 date", async () => {
    const { input, mem } = scenario();
    expect(await open({ ...input, turn: 128 })).toBeNull();
    expect(
      await open({
        ...input,
        game: { ...input.game, preIteration: { active: true, startedTurn: 1 } },
      })
    ).toBeNull();
    expect(await open({ ...input, game: { preset: "2019-default" } })).toBeNull();
    delete mem.collection("countryGameStates").docs[0].ruFederalAssemblyMandateSinceTurn;
    expect(await open(input)).toBeNull();
    expect(mem.collection("elections").docs).toHaveLength(0);
  });
  it("preserves an established alternate-history Assembly", async () => {
    const { input, mem } = scenario();
    mem.collection("countryGameStates").docs[0].ruFederalAssemblySinceTurn = 129;
    expect(await open(input)).toBeNull();
  });
  it("refuses duplicate identities, incomplete states and conflicting Council ballots before claiming", async () => {
    const { input, mem } = scenario();
    await expect(
      open({ ...input, electionIds: Array.from({ length: 89 }, () => input.electionIds[0]) })
    ).rejects.toThrow("distinct");
    mem.collection("states").docs.pop();
    await expect(open(input)).rejects.toThrow("complete");
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty(
      "ruFirstCouncilElectionCohortId"
    );
    mem.seed("elections", [
      {
        _id: new ObjectId(),
        countryId: "RU",
        electionType: "federationCouncilMember",
        status: "active",
      },
    ]);
    await expect(open(input)).rejects.toThrow("unresolved");
  });
  it("requires a live transaction, safe turn and valid time", async () => {
    const { input } = scenario();
    await expect(
      open({ ...input, session: { inTransaction: () => false } as ClientSession })
    ).rejects.toThrow("transaction");
    await expect(open({ ...input, turn: 0 })).rejects.toThrow("turn");
    await expect(open({ ...input, now: new Date(NaN) })).rejects.toThrow("time");
  });
});
