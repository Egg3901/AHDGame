import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { loadDemocraticCompetition } from "./loadCompetition";

describe("loadDemocraticCompetition", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("tallies represented seats rather than official documents", async () => {
    db.collection("electedOfficials")
      .find()
      .toArray.mockResolvedValue([
        { party: "dem", seatsHeld: 70 },
        { party: "rep", seatsHeld: 20 },
        { party: "rep", seatsHeld: 10 },
      ]);

    const result = await loadDemocraticCompetition(db as unknown as Db, "US", "1953-default", null);

    expect(result).toMatchObject({
      dominantPartyId: "dem",
      dominantSeatShare: 70,
      penalty: 9,
    });
    expect(db.collectionMocks.electedOfficials.find).toHaveBeenCalledWith({
      countryId: "US",
      officeType: "house",
    });
  });

  it("includes uninterrupted chamber control and executive tenure", async () => {
    db.collection("electedOfficials")
      .find()
      .toArray.mockResolvedValue([
        { party: "dem", seatsHeld: 60 },
        { party: "rep", seatsHeld: 40 },
      ]);
    db.collection("parliamentSeatsHistory")
      .find()
      .toArray.mockResolvedValue(
        Array.from({ length: 96 }, (_, index) => [
          { turn: index + 1, countryId: "US", officeType: "house", party: "dem", seats: 60 },
          { turn: index + 1, countryId: "US", officeType: "house", party: "rep", seats: 40 },
        ]).flat()
      );

    const result = await loadDemocraticCompetition(db as unknown as Db, "US", "1953-default", {
      presidentialTenureByCountry: { US: { party: "dem", consecutiveTerms: 4 } },
    });

    expect(result.uninterruptedControlTurns).toBe(96);
    expect(result.consecutiveExecutiveTerms).toBe(4);
    expect(result.penalty).toBe(17);
  });
});
