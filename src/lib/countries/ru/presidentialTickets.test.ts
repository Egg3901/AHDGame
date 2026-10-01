import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { materializeRussianPresidentialTickets as prepare } from "./presidentialTickets";
import type { Election } from "@/lib/db/types";
const session = { inTransaction: () => true } as ClientSession;
function scenario() {
  const mem = createInMemoryDb();
  const electionId = new ObjectId();
  const nominee = new ObjectId(),
    mate = new ObjectId();
  mem.seed("electionCandidates", [
    { _id: new ObjectId(), electionId, status: "active", isNPP: true, nppId: nominee, party: "1" },
  ]);
  mem.seed("npps", [
    { _id: nominee, countryId: "RU", party: "1" },
    { _id: mate, countryId: "RU", party: "1" },
    { _id: new ObjectId(), countryId: "US", party: "1" },
  ]);
  return {
    mem,
    mate,
    input: {
      db: mem as unknown as Db,
      session,
      election: {
        _id: electionId,
        countryId: "RU",
        electionType: "president",
        russianPresidentialRound: { round: 1, registeredVoters: 100, mandateSinceTurn: 72 },
      } as Election,
      now: new Date(1000),
    },
  };
}
describe("Russian paired presidential tickets", () => {
  it("does not nominate a retired NPC as vice president", async () => {
    const { mem, input } = scenario();
    mem.collection("npps").docs[1].retiredAt = new Date(1);
    await expect(prepare(input)).rejects.toThrow("eligible running mate");
  });
  it("registers a distinct same-party NPC once", async () => {
    const { mem, mate, input } = scenario();
    await prepare(input);
    expect(mem.collection("electionCandidates").docs[0].russianRunningMateNppId).toEqual(mate);
    expect(mem.collection("electionCandidates").docs[0].russianTicketLocked).toBe(true);
    await prepare(input);
    expect(mem.collection("electionCandidates").docs[0].russianRunningMateNppId).toEqual(mate);
  });
  it("preserves a chosen player mate and refuses to use the nominee as their own mate", async () => {
    const { mem, input } = scenario();
    mem.collection("electionCandidates").docs[0].runningMateId = new ObjectId();
    await prepare(input);
    expect(mem.collection("electionCandidates").docs[0]).not.toHaveProperty(
      "russianRunningMateNppId"
    );
    expect(mem.collection("electionCandidates").docs[0].russianTicketLocked).toBe(true);
    const fresh = scenario();
    fresh.mem.collection("npps").docs.splice(1);
    await expect(prepare(fresh.input)).rejects.toThrow("eligible running mate");
  });
});
