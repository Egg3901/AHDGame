import { describe, expect, it } from "vitest";
import { allocateRussianDumaListMandates as allocate } from "./assemblyList";
const player = { id: "player", party: "first", order: 0, isNpc: false, capacity: 1 };
const slate = { id: "slate", party: "first", order: 1, isNpc: true, capacity: 225 };
describe("Russian bounded Duma list mandates", () => {
  it("gives one player one seat and preserves the 225-seat list tier", () => {
    expect(allocate({ partySeats: { first: 225 }, nominees: [player, slate] })).toEqual({
      seatsByNominee: { player: 1, slate: 224 },
      vacanciesByParty: { first: 0 },
    });
  });
  it("removes a successful constituency player from list seating", () => {
    expect(
      allocate({
        partySeats: { first: 225 },
        nominees: [{ ...player, constituencyWinner: true }, slate],
      }).seatsByNominee
    ).toEqual({ player: 0, slate: 225 });
  });
  it("does not transfer unfilled mandates to another party or invent holders", () => {
    const result = allocate({
      partySeats: { first: 100, second: 125 },
      nominees: [player, { ...slate, capacity: 90 }],
    });
    expect(result.vacanciesByParty).toEqual({ first: 9, second: 125 });
    expect(result.seatsByNominee).toEqual({ player: 1, slate: 90 });
  });
  it("uses nomination order rather than personal votes for list ranking", () => {
    const result = allocate({
      partySeats: { first: 225 },
      nominees: [
        { ...slate, order: 0 },
        { ...player, order: 1 },
      ],
    });
    expect(result.seatsByNominee.player).toBe(0);
  });
  it("rejects a player masquerading as a multi-person slate", () => {
    expect(() =>
      allocate({ partySeats: { first: 225 }, nominees: [{ ...player, capacity: 225 }] })
    ).toThrow("capacity");
  });
  it("rejects duplicate identities across party lists", () => {
    expect(() =>
      allocate({ partySeats: { first: 225 }, nominees: [player, { ...player, party: "second" }] })
    ).toThrow("unique");
  });
  it.each([224, 226, NaN])("rejects an incorrect list-tier total %s", (seats) => {
    expect(() => allocate({ partySeats: { first: seats }, nominees: [slate] })).toThrow("225");
  });
});
