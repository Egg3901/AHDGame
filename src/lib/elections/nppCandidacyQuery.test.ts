import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { activeNppElectionCandidacyFilter } from "./nppCandidacyQuery";

describe("activeNppElectionCandidacyFilter", () => {
  it("matches election, active status, and characterId equal to NPP id", () => {
    const electionId = new ObjectId();
    const nppId = new ObjectId();
    const filter = activeNppElectionCandidacyFilter(electionId, nppId);
    expect(filter).toEqual({
      electionId,
      status: "active",
      characterId: nppId,
    });
  });
});
