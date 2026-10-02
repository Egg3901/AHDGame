import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { materializeRussianPresidentialElectionOpening as open } from "./presidentialElectionOpening";
const session = { inTransaction: () => true } as ClientSession;
function scenario() {
  const mem = createInMemoryDb();
  mem.seed("countryGameStates", [
    { _id: "RU", ruSovietSuccessionSinceTurn: 48, ruPresidencyMandateSinceTurn: 72 },
  ]);
  mem.seed("states", [
    { _id: "RU_A", countryId: "RU", population: 1000, votingEligiblePopulation: 700 },
    { _id: "RU_B", countryId: "RU", population: 500, votingEligiblePopulation: 350 },
    { _id: "UA", countryId: "UA", population: 50000 },
  ]);
  mem.seed("stateRegistrationPool", [
    { _id: "RU_RU_A", countryId: "RU", stateId: "RU_A", unregistered: 10 },
  ]);
  const input = {
    db: mem as unknown as Db,
    session,
    game: { preset: "1991-default" },
    turn: 72,
    now: new Date(1000),
    electionId: new ObjectId(),
  };
  return { mem, input };
}
describe("Russian first presidential ballot opening", () => {
  it("freezes real registered voters and one election without activating the office", async () => {
    const { mem, input } = scenario();
    expect(await open(input)).toEqual({ electionId: input.electionId, created: true });
    expect(mem.collection("elections").docs[0]).toMatchObject({
      countryId: "RU",
      state: "RU",
      electionType: "president",
      startTurn: 72,
      primaryEndTurn: 82,
      endTurn: 84,
      russianPresidentialRound: { round: 1, mandateSinceTurn: 72, registeredVoters: 980 },
    });
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty("ruPresidencySinceTurn");
    expect(await open({ ...input, electionId: new ObjectId(), turn: 73 })).toEqual({
      electionId: input.electionId,
      created: false,
    });
    expect(mem.collection("elections").docs).toHaveLength(1);
  });
  it("requires an enacted mandate and the founding-aware decision date", async () => {
    const { input, mem } = scenario();
    expect(
      await open({
        ...input,
        game: { ...input.game, preIteration: { active: true, startedTurn: 1 } },
      })
    ).toBeNull();
    delete mem.collection("countryGameStates").docs[0].ruPresidencyMandateSinceTurn;
    expect(await open(input)).toBeNull();
    expect(mem.collection("elections").docs).toHaveLength(0);
  });
  it("preserves a pre-existing presidency instead of opening another first race", async () => {
    const { input, mem } = scenario();
    mem.collection("countryGameStates").docs[0].ruPresidencySinceTurn = 50;
    expect(await open(input)).toBeNull();
  });
  it("refuses a conflicting unresolved ballot or a broken first-ballot reference", async () => {
    const { input, mem } = scenario();
    mem.seed("elections", [
      { _id: new ObjectId(), countryId: "RU", electionType: "president", status: "active" },
    ]);
    await expect(open(input)).rejects.toThrow("unresolved");
    mem.collection("countryGameStates").docs[0].ruPresidencyFirstElectionId = new ObjectId();
    await expect(open(input)).rejects.toThrow("no longer matches");
  });
  it("rejects a write outside a required transaction", async () => {
    const { input } = scenario();
    await expect(
      open({ ...input, session: { inTransaction: () => false } as ClientSession })
    ).rejects.toThrow("transaction");
  });
});
