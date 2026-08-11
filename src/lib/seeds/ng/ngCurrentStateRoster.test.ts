import { describe, it, expect } from "vitest";
import { buildNGCurrentRoster } from "./ngCurrentStateRoster";

const ZONES = [
  "NORTH_WEST",
  "NORTH_EAST",
  "NORTH_CENTRAL",
  "SOUTH_WEST",
  "SOUTH_SOUTH",
  "SOUTH_EAST",
];
const shares = {
  NORTH_WEST: { sdp: 42, nrc: 58 },
  NORTH_EAST: { sdp: 45, nrc: 55 },
  NORTH_CENTRAL: { sdp: 58, nrc: 42 },
  SOUTH_WEST: { sdp: 72, nrc: 28 },
  SOUTH_SOUTH: { sdp: 55, nrc: 45 },
  SOUTH_EAST: { sdp: 48, nrc: 52 },
};
const pops = {
  NORTH_WEST: 18_500_000,
  NORTH_EAST: 9_500_000,
  NORTH_CENTRAL: 10_000_000,
  SOUTH_WEST: 14_000_000,
  SOUTH_SOUTH: 10_500_000,
  SOUTH_EAST: 8_500_000,
};
const house = {
  NORTH_WEST: 95,
  NORTH_EAST: 50,
  NORTH_CENTRAL: 53,
  SOUTH_WEST: 72,
  SOUTH_SOUTH: 47,
  SOUTH_EAST: 43,
};
const senate = {
  NORTH_WEST: 21,
  NORTH_EAST: 18,
  NORTH_CENTRAL: 18,
  SOUTH_WEST: 18,
  SOUTH_SOUTH: 18,
  SOUTH_EAST: 16,
};
const regionalCouncil = {
  NORTH_WEST: 259,
  NORTH_EAST: 137,
  NORTH_CENTRAL: 146,
  SOUTH_WEST: 197,
  SOUTH_SOUTH: 134,
  SOUTH_EAST: 117,
};
const input = {
  voteShares: shares,
  zonePopulations: pops,
  houseSeatsByZone: house,
  senateSeatsByZone: senate,
  regionalCouncilSeatsByZone: regionalCouncil,
  cycle: 4,
  electionYear: 2005,
  ctx: { startingYear: 1991, preset: "1991-default" },
};

describe("buildNGCurrentRoster", () => {
  it("house seats per zone sum to that zone's total; national house = 360", () => {
    const { historicalSeats } = buildNGCurrentRoster(input);
    const houseSeats = historicalSeats.filter((s) => s.officeType === "house");
    const total = houseSeats.reduce((n, s) => n + (s.seatsHeld ?? 0), 0);
    expect(total).toBe(360);
    for (const z of ZONES) {
      const sum = houseSeats
        .filter((s) => s.state === z)
        .reduce((n, s) => n + (s.seatsHeld ?? 0), 0);
      expect(sum).toBe(house[z as keyof typeof house]);
    }
  });

  it("president winner is SDP under the 1991 shares × populations", () => {
    expect(buildNGCurrentRoster(input).presidentSlug).toBe("ng_sdp");
  });

  it("includes a president HistoricalSeat + resolved cycle-4 (2005) elections at turn 720", () => {
    const { historicalSeats, resolvedElections } = buildNGCurrentRoster(input);
    expect(historicalSeats.some((s) => s.officeType === "president" && s.state === "NG")).toBe(
      true
    );
    const pres = resolvedElections.find((e) => e.electionType === "president");
    expect(pres).toMatchObject({ cycle: 4, electionYear: 2005, endTurn: 720, state: "NG" });
  });

  it("senate seatsHeld entries sum to 109", () => {
    const { senateSeatsHeld } = buildNGCurrentRoster(input);
    expect(senateSeatsHeld.reduce((n, s) => n + s.seats, 0)).toBe(109);
  });

  it("emits regionalCouncil seatsHeld summing to 990 + resolved assembly elections", () => {
    const { historicalSeats, resolvedElections } = buildNGCurrentRoster(input);
    const rcTotal = historicalSeats
      .filter((s) => s.officeType === "regionalCouncil")
      .reduce((n, s) => n + (s.seatsHeld ?? 0), 0);
    expect(rcTotal).toBe(990);
    for (const z of ZONES) {
      const sum = historicalSeats
        .filter((s) => s.officeType === "regionalCouncil" && s.state === z)
        .reduce((n, s) => n + (s.seatsHeld ?? 0), 0);
      expect(sum).toBe(regionalCouncil[z as keyof typeof regionalCouncil]);
    }
    expect(resolvedElections.filter((e) => e.electionType === "regionalCouncil")).toHaveLength(6);
  });
});
