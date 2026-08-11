import { describe, it, expect } from "vitest";
import {
  HOUSE_SEATS,
  STATE_IDS,
  TOTAL_HOUSE_SEATS,
  TOTAL_SENATE_SEATS,
  ELECTORAL_VOTES,
  ELECTORAL_VOTE_UNITS,
  TOTAL_ELECTORAL_VOTES,
  ELECTORAL_MAJORITY,
  UNIT_LEAN,
  HOUSE_SEATS_1991,
  ELECTORAL_VOTES_1991,
  ELECTORAL_VOTE_UNITS_1991,
  getHouseSeats,
  getElectoralVotes,
  getElectoralVoteUnits,
  getTravelActionCost,
  isUsElectoralState,
  subNationalChamberSeats,
  CN_PEOPLES_CONGRESS_SEATS,
} from "./states";

describe("states constants", () => {
  it("STATE_IDS matches HOUSE_SEATS keys", () => {
    expect(STATE_IDS).toEqual(Object.keys(HOUSE_SEATS));
  });

  it("HOUSE_SEATS sums to 435", () => {
    const sum = Object.values(HOUSE_SEATS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(435);
  });

  it("TOTAL_HOUSE_SEATS is 435", () => {
    expect(TOTAL_HOUSE_SEATS).toBe(435);
  });

  it("TOTAL_SENATE_SEATS is 100", () => {
    expect(TOTAL_SENATE_SEATS).toBe(100);
  });
});

describe("isUsElectoralState", () => {
  it("returns true for the 50 states (every HOUSE_SEATS key)", () => {
    for (const id of STATE_IDS) {
      expect(isUsElectoralState(id)).toBe(true);
    }
  });

  it("returns false for DC — a federal district with no congressional/gubernatorial seats", () => {
    expect(isUsElectoralState("DC")).toBe(false);
  });

  it("returns false for unknown / non-state region ids", () => {
    expect(isUsElectoralState("PR")).toBe(false);
    expect(isUsElectoralState("")).toBe(false);
    expect(isUsElectoralState("ENG")).toBe(false);
  });
});

describe("electoral vote constants", () => {
  it("ELECTORAL_VOTES sums to 538", () => {
    const sum = Object.values(ELECTORAL_VOTES).reduce((a, b) => a + b, 0);
    expect(sum).toBe(538);
  });

  it("TOTAL_ELECTORAL_VOTES is 538", () => {
    expect(TOTAL_ELECTORAL_VOTES).toBe(538);
  });

  it("ELECTORAL_MAJORITY is 270", () => {
    expect(ELECTORAL_MAJORITY).toBe(270);
  });

  it("ELECTORAL_VOTE_UNITS EV sum equals 538", () => {
    const sum = ELECTORAL_VOTE_UNITS.reduce((a, u) => a + u.ev, 0);
    expect(sum).toBe(538);
  });

  it("ELECTORAL_VOTE_UNITS includes ME and NE district splits", () => {
    const unitIds = new Set(ELECTORAL_VOTE_UNITS.map((u) => u.unitId));
    expect(unitIds.has("ME")).toBe(true);
    expect(unitIds.has("ME_CD1")).toBe(true);
    expect(unitIds.has("ME_CD2")).toBe(true);
    expect(unitIds.has("NE")).toBe(true);
    expect(unitIds.has("NE_CD1")).toBe(true);
    expect(unitIds.has("NE_CD2")).toBe(true);
    expect(unitIds.has("NE_CD3")).toBe(true);
  });

  it("ME has 4 EV (2 at-large + 2 districts)", () => {
    const meEv = ELECTORAL_VOTE_UNITS.filter((u) => u.stateId === "ME").reduce(
      (a, u) => a + u.ev,
      0
    );
    expect(meEv).toBe(4);
  });

  it("NE has 5 EV (2 at-large + 3 districts)", () => {
    const neEv = ELECTORAL_VOTE_UNITS.filter((u) => u.stateId === "NE").reduce(
      (a, u) => a + u.ev,
      0
    );
    expect(neEv).toBe(5);
  });

  it("UNIT_LEAN only has ME/NE district keys", () => {
    const leanKeys = Object.keys(UNIT_LEAN);
    expect(leanKeys).toContain("ME_CD1");
    expect(leanKeys).toContain("ME_CD2");
    expect(leanKeys).toContain("NE_CD1");
    expect(leanKeys).toContain("NE_CD2");
    expect(leanKeys).toContain("NE_CD3");
    expect(leanKeys.every((k) => k.startsWith("ME_") || k.startsWith("NE_"))).toBe(true);
  });
});

describe("1990-census apportionment bundles", () => {
  it("1990 House seats sum to 435", () => {
    const sum = Object.values(HOUSE_SEATS_1991).reduce((a, b) => a + b, 0);
    expect(sum).toBe(435);
  });

  it("1990 electoral votes sum to 538", () => {
    const sum = Object.values(ELECTORAL_VOTES_1991).reduce((a, b) => a + b, 0);
    expect(sum).toBe(538);
  });

  it("each 1990 EV equals House seats + 2 (DC = 3)", () => {
    for (const [st, ev] of Object.entries(ELECTORAL_VOTES_1991)) {
      if (st === "DC") {
        expect(ev).toBe(3);
      } else {
        expect(ev).toBe((HOUSE_SEATS_1991[st] ?? 0) + 2);
      }
    }
  });

  it("matches the 1992 electoral map on bellwether states", () => {
    expect(ELECTORAL_VOTES_1991.CA).toBe(54);
    expect(ELECTORAL_VOTES_1991.TX).toBe(32);
    expect(ELECTORAL_VOTES_1991.NY).toBe(33);
    expect(ELECTORAL_VOTES_1991.FL).toBe(25);
    expect(ELECTORAL_VOTES_1991.CT).toBe(8);
    expect(ELECTORAL_VOTES_1991.OH).toBe(21);
  });

  it("1990 unit splits preserve ME (2 CDs) and NE (3 CDs) and sum to 538", () => {
    const ids = new Set(ELECTORAL_VOTE_UNITS_1991.map((u) => u.unitId));
    expect(ids.has("ME_CD1")).toBe(true);
    expect(ids.has("ME_CD2")).toBe(true);
    expect(ids.has("NE_CD1")).toBe(true);
    expect(ids.has("NE_CD3")).toBe(true);
    const total = ELECTORAL_VOTE_UNITS_1991.reduce((a, u) => a + u.ev, 0);
    expect(total).toBe(538);
  });

  it("selectors pick the era bundle and fall back to 2019", () => {
    expect(getElectoralVotes("1991-default")).toBe(ELECTORAL_VOTES_1991);
    expect(getHouseSeats("1991-default")).toBe(HOUSE_SEATS_1991);
    expect(getElectoralVoteUnits("1991-default")).toBe(ELECTORAL_VOTE_UNITS_1991);
    expect(getElectoralVotes("2019-default")).toBe(ELECTORAL_VOTES);
    expect(getHouseSeats("unknown")).toBe(HOUSE_SEATS);
    expect(getElectoralVoteUnits("empty")).toBe(ELECTORAL_VOTE_UNITS);
    expect(getElectoralVotes(undefined)).toBe(ELECTORAL_VOTES);
  });

  it("getTravelActionCost scales by the preset's apportionment", () => {
    // IL: 22 EV in 1990 (top tier, >20) vs 19 EV in 2020 (mid tier, ≤20).
    expect(getTravelActionCost("IL", "1991-default")).toBe(10);
    expect(getTravelActionCost("IL")).toBe(7);
    // MO: 11 EV in 1990 (≤20 tier) vs 10 EV in 2020 (≤10 tier).
    expect(getTravelActionCost("MO", "1991-default")).toBe(7);
    expect(getTravelActionCost("MO")).toBe(5);
  });

  describe("subNationalChamberSeats", () => {
    it("sizes CN's chamber off the People's Congress, not stateSenateSeats (bug #0853)", () => {
      // Dongbei: People's Congress 321 vs stateSenateSeats 175 (CPPCC). The chamber
      // total must be 321 so per-party seats can't exceed the displayed cap.
      expect(subNationalChamberSeats("CN", { _id: "DB", stateSenateSeats: 175 })).toBe(
        CN_PEOPLES_CONGRESS_SEATS.DB
      );
      expect(subNationalChamberSeats("CN", { _id: "DB", stateSenateSeats: 175 })).toBe(321);
    });

    it("falls back to stateSenateSeats for a CN region without a People's Congress entry", () => {
      expect(subNationalChamberSeats("CN", { _id: "ZZ", stateSenateSeats: 99 })).toBe(99);
    });

    it("uses stateSenateSeats for non-CN countries", () => {
      expect(subNationalChamberSeats("US", { _id: "CA", stateSenateSeats: 40 })).toBe(40);
    });

    it("returns 0 when no total is available", () => {
      expect(subNationalChamberSeats("US", { _id: "CA" })).toBe(0);
    });
  });
});
