import { describe, it, expect } from "vitest";
import { US_HOUSE_1953, US_SENATE_1953, US_GOVERNOR_1953 } from "./historicalSeats";
import { HOUSE_SEATS_1953, SENATE_CLASSES_BY_STATE } from "./states";
import { states1953 } from "@/lib/seeds/reference/states1953";

const SOLID_SOUTH = ["AL", "AR", "FL", "GA", "LA", "MS", "NC", "SC", "TN", "TX", "VA"];
const STATES_1953 = Object.keys(HOUSE_SEATS_1953); // 48 contiguous states (no AK/HI)
const seats = (rows: { seatsHeld?: number }[]) => rows.reduce((n, r) => n + (r.seatsHeld ?? 1), 0);
const byParty = (rows: { party: string; seatsHeld?: number }[], party: string) =>
  seats(rows.filter((r) => r.party === party));

describe("US 1953 House — full 83rd Congress (1950 apportionment)", () => {
  it("seats the real 213 D / 221 R / 1 I = 435-seat chamber", () => {
    expect(seats(US_HOUSE_1953)).toBe(435);
    expect(byParty(US_HOUSE_1953, "democrat")).toBe(213);
    expect(byParty(US_HOUSE_1953, "republican")).toBe(221);
    expect(byParty(US_HOUSE_1953, "independent")).toBe(1);
  });

  it("every state's delegation sums to its 1950-census apportionment", () => {
    for (const s of STATES_1953) {
      const total = seats(US_HOUSE_1953.filter((r) => r.state === s));
      expect(total, `${s} House total`).toBe(HOUSE_SEATS_1953[s]);
    }
    // all 48 states authored, none outside the 1950 map (no AK/HI territories)
    expect(new Set(US_HOUSE_1953.map((r) => r.state))).toEqual(new Set(STATES_1953));
  });

  it("seats the Solid South at 100 D / 6 R (VA is 7 D / 3 R — Poff/Wampler/Broyhill)", () => {
    const south = US_HOUSE_1953.filter((r) => SOLID_SOUTH.includes(r.state));
    expect(byParty(south, "democrat")).toBe(100);
    expect(byParty(south, "republican")).toBe(6);
    expect(byParty(south, "independent")).toBe(0);
  });

  it("seats the lone Independent (Frazier Reams) in Ohio", () => {
    const ind = US_HOUSE_1953.filter((r) => r.party === "independent");
    expect(ind).toHaveLength(1);
    expect(ind[0].state).toBe("OH");
  });
});

describe("US 1953 Senate — full 83rd Congress", () => {
  it("seats 96 senators: 47 D / 48 R / 1 I (Wayne Morse)", () => {
    expect(US_SENATE_1953).toHaveLength(96);
    expect(US_SENATE_1953.filter((r) => r.party === "democrat")).toHaveLength(47);
    expect(US_SENATE_1953.filter((r) => r.party === "republican")).toHaveLength(48);
    const ind = US_SENATE_1953.filter((r) => r.party === "independent");
    expect(ind).toHaveLength(1);
    expect(ind[0].state).toBe("OR"); // Wayne Morse
  });

  it("gives each of the 48 states exactly 2 seats in its canonical classes", () => {
    for (const s of STATES_1953) {
      const rows = US_SENATE_1953.filter((r) => r.state === s);
      expect(rows, `${s} senate seats`).toHaveLength(2);
      const classes = rows.map((r) => r.senateClass).sort();
      const canon = [...SENATE_CLASSES_BY_STATE[s]].sort();
      expect(classes, `${s} senate classes`).toEqual(canon);
    }
    expect(new Set(US_SENATE_1953.map((r) => r.state))).toEqual(new Set(STATES_1953));
  });

  it("keeps all 22 Southern Senate seats Democratic", () => {
    const south = US_SENATE_1953.filter((r) => SOLID_SOUTH.includes(r.state));
    expect(south).toHaveLength(22);
    expect(south.every((r) => r.party === "democrat")).toBe(true);
  });
});

describe("US 1953 Governors — full slate", () => {
  it("seats all 48 statehouses: 18 D / 30 R", () => {
    expect(US_GOVERNOR_1953).toHaveLength(48);
    expect(US_GOVERNOR_1953.filter((r) => r.party === "democrat")).toHaveLength(18);
    expect(US_GOVERNOR_1953.filter((r) => r.party === "republican")).toHaveLength(30);
    expect(new Set(US_GOVERNOR_1953.map((r) => r.state))).toEqual(new Set(STATES_1953));
  });

  it("keeps all 11 Southern statehouses Democratic", () => {
    const south = US_GOVERNOR_1953.filter((r) => SOLID_SOUTH.includes(r.state));
    expect(south).toHaveLength(11);
    expect(south.every((r) => r.party === "democrat")).toBe(true);
  });
});

describe("1953 apportionment is internally consistent", () => {
  // The census/reapportionment reads state.houseDistricts (states1953) while seat
  // slots + EV read HOUSE_SEATS_1953; they MUST agree or a state elects a different
  // number of members than it holds. (Caught a stray NY=45 from the 1940 census.)
  const usStates1953 = states1953.filter((s) => s.countryId === "US");

  it("states1953 US houseDistricts match HOUSE_SEATS_1953 exactly (sum 435)", () => {
    for (const s of usStates1953) {
      const hd = s.houseDistricts ?? 0;
      if (hd > 0) {
        expect(HOUSE_SEATS_1953[s._id], `${s._id} houseDistricts`).toBe(hd);
      } else {
        // territories / DC — absent from the apportionment map
        expect(
          HOUSE_SEATS_1953[s._id],
          `${s._id} should have no apportioned seats`
        ).toBeUndefined();
      }
    }
    const sum = usStates1953.reduce((n, s) => n + (s.houseDistricts ?? 0), 0);
    expect(sum).toBe(435);
  });

  it("Alaska and Hawaii are territories with zero house districts", () => {
    for (const id of ["AK", "HI"]) {
      const s = usStates1953.find((x) => x._id === id);
      expect(s?.houseDistricts ?? 0, `${id} houseDistricts`).toBe(0);
    }
  });
});
