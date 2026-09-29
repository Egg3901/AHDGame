import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  buildChamberSeatMap,
  buildOverrideDisplay,
  didVetoOverridePass,
  tallyOverrideByChamber,
} from "./vetoOverrideTally";

describe("buildChamberSeatMap", () => {
  it("sums seatsHeld per chamber and indexes voters by characterId and npp_<nppId>", () => {
    const charId = new ObjectId();
    const nppId = new ObjectId();
    const { houseSeats, senateSeats, seatMap } = buildChamberSeatMap([
      { characterId: charId, nppId: undefined, officeType: "house", seatsHeld: 7 },
      { characterId: null, nppId, officeType: "house", seatsHeld: 10 },
      { characterId: new ObjectId(), nppId: undefined, officeType: "senate", seatsHeld: 1 },
      // Non-legislative office types are ignored.
      { characterId: new ObjectId(), nppId: undefined, officeType: "president", seatsHeld: 1 },
    ]);

    expect(houseSeats).toBe(17);
    expect(senateSeats).toBe(1);
    expect(seatMap.get(charId.toString())).toEqual({ chamber: "house", seats: 7 });
    expect(seatMap.get(`npp_${nppId.toString()}`)).toEqual({ chamber: "house", seats: 10 });
  });

  it("defaults a missing seatsHeld to 1", () => {
    const charId = new ObjectId();
    const { houseSeats, seatMap } = buildChamberSeatMap([
      { characterId: charId, nppId: undefined, officeType: "house" },
    ]);
    expect(houseSeats).toBe(1);
    expect(seatMap.get(charId.toString())).toEqual({ chamber: "house", seats: 1 });
  });
});

describe("tallyOverrideByChamber", () => {
  it("weights for/against by seats per chamber, ignoring abstain and unseated voters", () => {
    const hFor = new ObjectId();
    const hAgn = new ObjectId();
    const sFor = new ObjectId();
    const seatData = buildChamberSeatMap([
      { characterId: hFor, nppId: undefined, officeType: "house", seatsHeld: 20 },
      { characterId: hAgn, nppId: undefined, officeType: "house", seatsHeld: 12 },
      { characterId: sFor, nppId: undefined, officeType: "senate", seatsHeld: 3 },
    ]);

    const tally = tallyOverrideByChamber(
      {
        [hFor.toString()]: "for",
        [hAgn.toString()]: "against",
        [sFor.toString()]: "for",
        [new ObjectId().toString()]: "for", // no longer seated → ignored
        [new ObjectId().toString()]: "abstain", // abstain → ignored
      },
      seatData
    );

    expect(tally).toEqual({ houseFor: 20, houseAgainst: 12, senateFor: 3, senateAgainst: 0 });
  });

  it("returns zeroed tallies for undefined votes", () => {
    const seatData = buildChamberSeatMap([]);
    expect(tallyOverrideByChamber(undefined, seatData)).toEqual({
      houseFor: 0,
      houseAgainst: 0,
      senateFor: 0,
      senateAgainst: 0,
    });
  });
});

describe("buildOverrideDisplay", () => {
  it("pairs each chamber's seat-weighted for/against with its total seats", () => {
    const hFor = new ObjectId();
    const sAgn = new ObjectId();
    const seatData = buildChamberSeatMap([
      { characterId: hFor, nppId: undefined, officeType: "house", seatsHeld: 290 },
      { characterId: new ObjectId(), nppId: undefined, officeType: "house", seatsHeld: 145 },
      { characterId: sAgn, nppId: undefined, officeType: "senate", seatsHeld: 40 },
      { characterId: new ObjectId(), nppId: undefined, officeType: "senate", seatsHeld: 60 },
    ]);

    const display = buildOverrideDisplay(
      { [hFor.toString()]: "for", [sAgn.toString()]: "against" },
      seatData
    );

    expect(display).toEqual({
      house: { for: 290, against: 0, seats: 435 },
      senate: { for: 0, against: 40, seats: 100 },
    });
  });
});

describe("didVetoOverridePass", () => {
  it("requires two-thirds of the seats in both chambers", () => {
    expect(
      didVetoOverridePass(
        { houseFor: 290, houseAgainst: 145, senateFor: 67, senateAgainst: 33 },
        { houseSeats: 435, senateSeats: 100, seatMap: new Map() }
      )
    ).toBe(true);
    expect(
      didVetoOverridePass(
        { houseFor: 289, houseAgainst: 146, senateFor: 67, senateAgainst: 33 },
        { houseSeats: 435, senateSeats: 100, seatMap: new Map() }
      )
    ).toBe(false);
  });

  it("fails closed when a required chamber has no recognized seats", () => {
    expect(
      didVetoOverridePass(
        { houseFor: 0, houseAgainst: 0, senateFor: 67, senateAgainst: 33 },
        { houseSeats: 0, senateSeats: 100, seatMap: new Map() }
      )
    ).toBe(false);
    expect(
      didVetoOverridePass(
        { houseFor: 290, houseAgainst: 145, senateFor: 67, senateAgainst: 33 },
        { houseSeats: 435, senateSeats: 100, seatMap: new Map() },
        []
      )
    ).toBe(false);
  });
});
