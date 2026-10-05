import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { loadDemocraticCompetition } from "./loadCompetition";

function historicalJustice(economicLean: number | null, socialLean: number | null, party = "1") {
  return {
    justiceMode: "historical",
    justiceParty: party,
    justiceCharacterId: null,
    justiceNppId: null,
    economicLean,
    socialLean,
  };
}

describe("loadDemocraticCompetition", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("tallies represented seats rather than official documents", async () => {
    db.collection("electedOfficials")
      .find()
      .toArray.mockResolvedValue([
        { officeType: "house", party: "dem", seatsHeld: 70 },
        { officeType: "house", party: "rep", seatsHeld: 20 },
        { officeType: "house", party: "rep", seatsHeld: 10 },
      ]);

    const result = await loadDemocraticCompetition(db as unknown as Db, "US", "1953-default", null);

    expect(result).toMatchObject({
      dominantPartyId: "dem",
      dominantSeatShare: 70,
      executiveSystem: "presidential",
      penalty: 9,
    });
    expect(db.collectionMocks.electedOfficials.find).toHaveBeenCalledWith({
      countryId: "US",
      officeType: { $in: ["house", "senate"] },
    });
  });

  it("loads both elected US chambers and weights their shares equally", async () => {
    db.collection("electedOfficials")
      .find()
      .toArray.mockResolvedValue([
        { officeType: "house", party: "dem", seatsHeld: 237 },
        { officeType: "house", party: "farmerLabor", seatsHeld: 165 },
        { officeType: "house", party: "conservative", seatsHeld: 25 },
        { officeType: "house", party: "corporatist", seatsHeld: 8 },
        { officeType: "senate", party: "dem", seatsHeld: 78 },
        { officeType: "senate", party: "farmerLabor", seatsHeld: 18 },
      ]);

    const result = await loadDemocraticCompetition(db as unknown as Db, "US", "1953-default", {
      presidentialTenureByCountry: { US: { party: "dem", consecutiveTerms: 2 } },
    });

    expect(result).toMatchObject({
      dominantPartyId: "dem",
      dominantSeatShare: 67.9,
      chambersMeasured: 2,
      executivePartyId: "dem",
      executiveAlignedWithLegislature: true,
      seatMarginPenalty: 7.7,
      executiveContinuityPenalty: 2,
      penalty: 9.7,
    });
  });

  it("includes uninterrupted chamber control and executive tenure", async () => {
    db.collection("electedOfficials")
      .find()
      .toArray.mockResolvedValue([
        { officeType: "house", party: "dem", seatsHeld: 60 },
        { officeType: "house", party: "rep", seatsHeld: 40 },
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
    expect(result.seatMarginPenalty).toBe(3);
    expect(result.legislativeContinuityPenalty).toBe(6);
    expect(result.executiveContinuityPenalty).toBe(6);
    expect(result.penalty).toBe(15);
  });

  it("adds a Court concentration penalty from seated US justices", async () => {
    db.collection("electedOfficials")
      .find()
      .toArray.mockResolvedValue([
        { officeType: "house", party: "1", seatsHeld: 218 },
        { officeType: "house", party: "2", seatsHeld: 217 },
        { officeType: "senate", party: "1", seatsHeld: 50 },
        { officeType: "senate", party: "2", seatsHeld: 50 },
      ]);
    db.collection("supremeCourtSeats")
      .find()
      .toArray.mockResolvedValue([
        ...Array.from({ length: 7 }, () => historicalJustice(3, 3, "1")),
        ...Array.from({ length: 2 }, () => historicalJustice(-3, -3, "2")),
      ]);

    const result = await loadDemocraticCompetition(db as unknown as Db, "US", "1953-default", null);

    expect(result).toMatchObject({
      courtSeated: 9,
      courtDominantBloc: "conservative",
      courtDominantShare: 77.8,
      courtPenalty: 4,
    });
    expect(result.penalty).toBe(result.seatMarginPenalty + 4);
  });

  it("counts occupied seats without lean data toward the seated bench", async () => {
    db.collection("electedOfficials").find().toArray.mockResolvedValue([]);
    db.collection("supremeCourtSeats")
      .find()
      .toArray.mockResolvedValue([
        ...Array.from({ length: 6 }, () => historicalJustice(3, 3, "1")),
        ...Array.from({ length: 3 }, () => historicalJustice(null, null, "")),
      ]);

    const result = await loadDemocraticCompetition(db as unknown as Db, "US", "1953-default", null);

    expect(result).toMatchObject({
      courtSeated: 9,
      courtDominantBloc: "conservative",
      courtDominantShare: 66.7,
      courtUnclassifiedSeats: 3,
      courtPenalty: 0,
    });
  });

  it("does not apply a separate presidential signal to parliamentary government", async () => {
    db.collection("electedOfficials")
      .find()
      .toArray.mockResolvedValue([
        { officeType: "commons", party: "labour", seatsHeld: 364 },
        { officeType: "commons", party: "conservative", seatsHeld: 215 },
        { officeType: "commons", party: "liberal", seatsHeld: 9 },
      ]);

    const result = await loadDemocraticCompetition(db as unknown as Db, "UK", "1953-default", {
      presidentialTenureByCountry: { UK: { party: "labour", consecutiveTerms: 4 } },
    });

    expect(result).toMatchObject({
      dominantPartyId: "labour",
      chambersMeasured: 1,
      executivePartyId: null,
      executiveSystem: "parliamentary",
      executiveAlignedWithLegislature: null,
      consecutiveExecutiveTerms: 0,
      executiveContinuityPenalty: 0,
    });
  });
});
