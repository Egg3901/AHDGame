import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { materializeRussianPresidentialFollowup as followup } from "./presidentialElectionFollowup";
const session = { inTransaction: () => true } as ClientSession;
function scenario(kind: "runoff" | "repeat" | "won" = "runoff") {
  const mem = createInMemoryDb();
  mem.seed("gameState", [{ _id: "current", preset: "1991-default" }]);
  const predecessorElectionId = new ObjectId();
  const electionId = new ObjectId();
  const finalists = [new ObjectId(), new ObjectId()];
  mem.seed("countryGameStates", [{ _id: "RU", ruPresidencyMandateSinceTurn: 72 }]);
  mem.seed("elections", [
    {
      _id: predecessorElectionId,
      countryId: "RU",
      electionType: "president",
      status: "resolved",
      cycle: 1,
      electionYear: 1992,
    },
  ]);
  mem.seed("russianPresidentialElectionResults", [
    {
      _id: predecessorElectionId.toHexString(),
      electionId: predecessorElectionId,
      countryId: "RU",
      preset: "1991-default",
      mandateSinceTurn: 72,
      registeredVoters: 100,
      resolvedOnTurn: 84,
      decision:
        kind === "runoff"
          ? { outcome: "runoff", finalistCandidateIds: finalists.map((id) => id.toHexString()) }
          : kind === "repeat"
            ? { outcome: "repeat", reason: "low-turnout" }
            : { outcome: "won", winnerCandidateId: finalists[0].toHexString() },
    },
  ]);
  mem.seed(
    "electionCandidates",
    finalists.map((_id, i) => ({
      _id,
      electionId: predecessorElectionId,
      countryId: "RU",
      characterId: new ObjectId(),
      characterName: `Candidate ${i}`,
      party: "1",
      status: "active",
      support: 99,
      targetedAds: [{ cost: 100 }],
      enteredAt: new Date(0),
    }))
  );
  return {
    mem,
    input: {
      db: mem as unknown as Db,
      session,
      predecessorElectionId,
      electionId,
      candidateIds: [new ObjectId(), new ObjectId()] as [ObjectId, ObjectId],
      turn: 84,
      now: new Date(1000),
    },
  };
}
describe("Russian presidential fresh ballots", () => {
  it("keeps a finalist's campaign id, funds and upgrades without moving eliminated campaigns", async () => {
    const { mem, input } = scenario();
    const campaignId = new ObjectId();
    const outsiderId = new ObjectId();
    const owner = mem.collection("electionCandidates").docs[0].characterId;
    mem.seed("campaigns", [
      {
        _id: campaignId,
        electionId: input.predecessorElectionId,
        candidateId: owner,
        funds: 12345,
        campaignStrength: 50000,
        groundGameLevel: 3,
      },
      {
        _id: outsiderId,
        electionId: input.predecessorElectionId,
        candidateId: new ObjectId(),
        funds: 678,
      },
    ]);
    await followup(input);
    expect(mem.collection("campaigns").docs[0]).toMatchObject({
      _id: campaignId,
      electionId: input.electionId,
      funds: 12345,
      campaignStrength: 50000,
      groundGameLevel: 3,
    });
    expect(mem.collection("campaigns").docs[1]).toMatchObject({
      _id: outsiderId,
      electionId: input.predecessorElectionId,
      funds: 678,
    });
    await followup(input);
    expect(mem.collection("campaigns").docs).toHaveLength(2);
  });
  it("opens a fresh two-finalist ballot without carrying votes or campaign purchases", async () => {
    const { mem, input } = scenario();
    expect(await followup(input)).toEqual(input.electionId);
    const next = mem.collection("elections").docs[1];
    expect(next).toMatchObject({
      startTurn: 84,
      primaryEndTurn: 84,
      endTurn: 86,
      russianPresidentialRound: {
        round: 2,
        registeredVoters: 100,
        predecessorElectionId: input.predecessorElectionId,
      },
    });
    const candidates = mem.collection("electionCandidates").docs.slice(2);
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.party === "1")).toBe(true);
    expect(candidates[0]).not.toHaveProperty("targetedAds");
    expect(candidates[0]).not.toHaveProperty("support");
    const tally = mem.collection("electionVoteTallies").docs[0];
    expect(Object.values(tally.totalVotes as object)).toEqual([0, 0]);
    expect(tally.primaryResults).toEqual({ byParty: {}, recordedAt: input.now });
    expect(await followup({ ...input, electionId: new ObjectId(), turn: 85 })).toEqual(
      input.electionId
    );
    expect(mem.collection("elections").docs).toHaveLength(2);
  });
  it("reopens filing after a failed ballot while retaining the electoral register", async () => {
    const { mem, input } = scenario("repeat");
    await followup(input);
    expect(mem.collection("elections").docs[1]).toMatchObject({
      primaryEndTurn: 90,
      endTurn: 92,
      russianPresidentialRound: { round: 1, registeredVoters: 100 },
    });
    expect(mem.collection("electionCandidates").docs).toHaveLength(2);
    expect(mem.collection("electionVoteTallies").docs).toHaveLength(0);
  });
  it("does not open another ballot for a certified winner", async () => {
    const { mem, input } = scenario("won");
    expect(await followup(input)).toBeNull();
    expect(mem.collection("elections").docs).toHaveLength(1);
  });
  it("refuses stale mandates, withdrawn finalists and nontransactional writes", async () => {
    const { mem, input } = scenario();
    await expect(
      followup({ ...input, session: { inTransaction: () => false } as ClientSession })
    ).rejects.toThrow("transaction");
    mem.collection("countryGameStates").docs[0].ruPresidencyMandateSinceTurn = 73;
    await expect(followup(input)).rejects.toThrow("mandate changed");
    mem.collection("countryGameStates").docs[0].ruPresidencyMandateSinceTurn = 72;
    mem.collection("electionCandidates").docs[0].status = "withdrawn";
    await expect(followup(input)).rejects.toThrow("finalists changed");
    expect(mem.collection("elections").docs).toHaveLength(1);
  });
});
