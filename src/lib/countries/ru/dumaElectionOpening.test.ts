import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { RU_1991_ECONOMIC_REGION_POPULATION } from "./data/ruPopulation1991";
import { materializeRussianDumaElectionOpening as open } from "./dumaElectionOpening";

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
    electionIds: Array.from({ length: 226 }, () => new ObjectId()),
  };
  return { input, mem };
}

describe("First Russian Duma cohort opening", () => {
  it("opens the 225 constituency seats and 225 list seats together without retiring Congress", async () => {
    const { input, mem } = scenario();
    expect(await open(input)).toEqual({ cohortId: input.cohortId, created: true });
    const ballots = mem.collection("elections").docs;
    expect(ballots).toHaveLength(226);
    expect(ballots.reduce((sum, row) => sum + Number(row.totalSeats), 0)).toBe(450);
    expect(ballots.filter((row) => row.totalSeats === 1)).toHaveLength(225);
    const list = ballots.find((row) => row.seatId === "RU-duma-national-list")!;
    expect(list).toMatchObject({
      state: "RU",
      totalSeats: 225,
      startTurn: 129,
      primaryEndTurn: 139,
      endTurn: 141,
      electionYear: 1993,
      russianDumaRound: { tier: "list", mandateSinceTurn: 129 },
    });
    const constituents = ballots.filter((row) => row.totalSeats === 1);
    expect(
      constituents.reduce(
        (sum, row) =>
          sum + Number((row.russianDumaRound as { registeredVoters: number }).registeredVoters),
        0
      )
    ).toBe((list.russianDumaRound as { registeredVoters: number }).registeredVoters);
    expect(mem.collection("electedOfficials").docs).toHaveLength(1);
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty(
      "ruCongressDissolvedSinceTurn"
    );
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty(
      "ruFederalAssemblySinceTurn"
    );
  });
  it("replays the same complete cohort without creating ballots or new identities", async () => {
    const { input, mem } = scenario();
    await open(input);
    expect(await open({ ...input, turn: 130, cohortId: new ObjectId(), electionIds: [] })).toEqual({
      cohortId: input.cohortId,
      created: false,
    });
    expect(mem.collection("elections").docs).toHaveLength(226);
  });
  it("rejects a broken or wrongly bound existing cohort", async () => {
    const { input, mem } = scenario();
    await open(input);
    mem.collection("elections").docs.pop();
    await expect(open(input)).rejects.toThrow("no longer matches");
  });
  it("requires succession, an enacted mandate, and a founding-aware September 1993 date", async () => {
    const { input, mem } = scenario();
    expect(await open({ ...input, turn: 128 })).toBeNull();
    expect(
      await open({
        ...input,
        game: { ...input.game, preIteration: { active: true, startedTurn: 1 } },
      })
    ).toBeNull();
    delete mem.collection("countryGameStates").docs[0].ruFederalAssemblyMandateSinceTurn;
    expect(await open(input)).toBeNull();
    expect(mem.collection("elections").docs).toHaveLength(0);
  });
  it("preserves an established alternate-history Assembly", async () => {
    const { input, mem } = scenario();
    mem.collection("countryGameStates").docs[0].ruFederalAssemblySinceTurn = 129;
    expect(await open(input)).toBeNull();
  });
  it("rejects duplicate ballot identities and conflicting unresolved ballots", async () => {
    const { input, mem } = scenario();
    await expect(
      open({ ...input, electionIds: Array.from({ length: 226 }, () => input.electionIds[0]) })
    ).rejects.toThrow("distinct");
    mem.seed("elections", [
      { _id: new ObjectId(), countryId: "RU", electionType: "dumaDeputy", status: "active" },
    ]);
    await expect(open(input)).rejects.toThrow("unresolved");
  });
  it("refuses an incomplete regional register before writing a cohort claim", async () => {
    const { input, mem } = scenario();
    mem.collection("states").docs.pop();
    await expect(open(input)).rejects.toThrow("complete");
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty(
      "ruFirstDumaElectionCohortId"
    );
  });
  it("requires a live transaction", async () => {
    const { input } = scenario();
    await expect(
      open({ ...input, session: { inTransaction: () => false } as ClientSession })
    ).rejects.toThrow("transaction");
  });
  it("rejects replay with a changed regional binding or list registration", async () => {
    const { input, mem } = scenario();
    await open(input);
    const row = mem.collection("elections").docs[0];
    const originalState = row.state;
    row.state = "KAZ";
    await expect(open(input)).rejects.toThrow("no longer matches");
    row.state = originalState;
    const list = mem
      .collection("elections")
      .docs.find((ballot) => ballot.seatId === "RU-duma-national-list")!;
    (list.russianDumaRound as { registeredVoters: number }).registeredVoters++;
    await expect(open(input)).rejects.toThrow("inconsistent registration");
  });
});
