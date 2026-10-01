import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { materializeRussianPresidentialElectionResult as resolve } from "./presidentialElectionResult";
const session = { inTransaction: () => true } as ClientSession;
function scenario() {
  const mem = createInMemoryDb();
  const electionId = new ObjectId();
  const a = new ObjectId();
  const b = new ObjectId();
  const actor = new ObjectId();
  const mate = new ObjectId();
  mem.seed("gameState", [{ _id: "current", preset: "1991-default" }]);
  mem.seed("countryGameStates", [
    { _id: "RU", ruSovietSuccessionSinceTurn: 48, ruPresidencyMandateSinceTurn: 72 },
  ]);
  mem.seed("elections", [
    {
      _id: electionId,
      countryId: "RU",
      electionType: "president",
      status: "completed",
      endTurn: 84,
      russianPresidentialRound: { round: 1, mandateSinceTurn: 72, registeredVoters: 100 },
    },
  ]);
  mem.seed("electionVoteTallies", [
    {
      _id: new ObjectId(),
      electionId,
      finalized: false,
      candidateParties: { [a.toHexString()]: "1", [b.toHexString()]: "2" },
      totalVotes: { [a.toHexString()]: 35, [b.toHexString()]: 25 },
    },
  ]);
  mem.seed("electionCandidates", [
    {
      _id: a,
      electionId,
      countryId: "RU",
      isNPP: true,
      nppId: actor,
      russianRunningMateNppId: mate,
      characterName: "Winner",
      party: "1",
      status: "active",
    },
    {
      _id: b,
      electionId,
      countryId: "RU",
      isNPP: true,
      nppId: new ObjectId(),
      characterName: "Other",
      party: "2",
      status: "active",
    },
  ]);
  mem.seed("npps", [
    { _id: actor, countryId: "RU", currentOffice: { type: "congressDeputy" } },
    { _id: mate, countryId: "RU", name: "Running mate", party: "1" },
  ]);
  mem.seed("electedOfficials", [
    { _id: new ObjectId(), countryId: "RU", officeType: "chairmanOfSupremeSoviet" },
  ]);
  return {
    mem,
    a,
    b,
    electionId,
    input: { db: mem as unknown as Db, session, electionId, turn: 84, now: new Date(1000) },
  };
}
describe("Russian presidential result certification", () => {
  it("certifies the popular winner and leaves current office holders intact", async () => {
    const { mem, a, electionId, input } = scenario();
    const result = await resolve(input);
    expect(result.decision).toEqual({ outcome: "won", winnerCandidateId: a.toHexString() });
    expect(mem.collection("countryGameStates").docs[0]).toMatchObject({
      ruPresidencyElectionCertifiedSinceTurn: 84,
      ruPresidencyCertifiedElectionId: electionId,
    });
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty("ruPresidencySinceTurn");
    expect(mem.collection("electedOfficials").docs[0].officeType).toBe("chairmanOfSupremeSoviet");
    expect(mem.collection("npps").docs[0].currentOffice).toEqual({ type: "congressDeputy" });
    expect(mem.collection("electionVoteTallies").docs[0]).toMatchObject({
      finalized: true,
      russianPresidentialResult: {
        outcome: "won",
        winnerCandidateId: a.toHexString(),
        participants: 60,
      },
    });
    expect(mem.collection("electionVoteTallies").docs[0]).not.toHaveProperty(
      "electoralVotesByCandidate"
    );
    expect(await resolve({ ...input, turn: 85 })).toEqual(result);
    expect(mem.collection("russianPresidentialElectionResults").docs).toHaveLength(1);
  });
  it("records a low-turnout repeat without certifying or seating the apparent winner", async () => {
    const { mem, input } = scenario();
    mem.collection("elections").docs[0].russianPresidentialRound = {
      round: 1,
      mandateSinceTurn: 72,
      registeredVoters: 121,
    };
    expect((await resolve(input)).decision).toEqual({ outcome: "repeat", reason: "low-turnout" });
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty(
      "ruPresidencyElectionCertifiedSinceTurn"
    );
    expect(mem.collection("electedOfficials").docs).toHaveLength(1);
  });
  it("requires a completed bound ballot under the current mandate", async () => {
    const { mem, input } = scenario();
    await expect(resolve({ ...input, turn: 83 })).rejects.toThrow("not bound or completed");
    mem.collection("countryGameStates").docs[0].ruPresidencyMandateSinceTurn = 73;
    await expect(resolve(input)).rejects.toThrow("mandate changed");
    expect(mem.collection("electionVoteTallies").docs[0].finalized).toBe(false);
  });
  it("repeats a ballot invalidated by a withdrawn registered candidate", async () => {
    const { mem, input } = scenario();
    mem.collection("electionCandidates").docs[0].status = "withdrawn";
    expect((await resolve(input)).decision).toEqual({
      outcome: "repeat",
      reason: "invalid-ballot",
    });
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty(
      "ruPresidencyElectionCertifiedSinceTurn"
    );
  });
  it("repeats the ballot when its apparent winner has left Russia", async () => {
    const { mem, input } = scenario();
    mem.collection("npps").docs[0].countryId = "PL";
    expect((await resolve(input)).decision).toEqual({
      outcome: "repeat",
      reason: "invalid-ballot",
    });
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty(
      "ruPresidencyElectionCertifiedSinceTurn"
    );
  });
  it("requires an active transaction before touching result state", async () => {
    const { input } = scenario();
    await expect(
      resolve({ ...input, session: { inTransaction: () => false } as ClientSession })
    ).rejects.toThrow("transaction");
  });
});
