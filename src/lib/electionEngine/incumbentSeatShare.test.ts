import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { Election } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  computeSeatShareFromTally,
  getIncumbentSeatShareByParty,
  usesSeatShareIncumbency,
} from "./incumbentSeatShare";

describe("computeSeatShareFromTally", () => {
  it("returns empty Map for zero total votes", () => {
    const out = computeSeatShareFromTally({}, {});
    expect(out.size).toBe(0);
  });

  it("returns empty Map when every vote count is zero", () => {
    const out = computeSeatShareFromTally({ c1: 0, c2: 0 }, { c1: "dem", c2: "rep" });
    expect(out.size).toBe(0);
  });

  it("single-seat single-party prior maps to 1.0 for that party", () => {
    const out = computeSeatShareFromTally({ c1: 50_000 }, { c1: "dem" });
    expect(out.get("dem")).toBeCloseTo(1.0);
    expect(out.size).toBe(1);
  });

  it("single-seat contested prior maps proportional to vote share", () => {
    const out = computeSeatShareFromTally({ c1: 55_000, c2: 45_000 }, { c1: "dem", c2: "rep" });
    expect(out.get("dem")).toBeCloseTo(0.55);
    expect(out.get("rep")).toBeCloseTo(0.45);
  });

  it("multi-candidate-per-party sums candidates within a party", () => {
    // US House CA — multi-seat-from-vote-share; multiple Dem candidates,
    // multiple Rep candidates; their votes pool to party totals.
    const out = computeSeatShareFromTally(
      {
        d1: 30_000,
        d2: 30_000, // Dem total 60,000
        r1: 25_000,
        r2: 5_000, // Rep total 30,000
        g1: 10_000, // Grn total 10,000
      },
      {
        d1: "dem",
        d2: "dem",
        r1: "rep",
        r2: "rep",
        g1: "grn",
      }
    );
    expect(out.get("dem")).toBeCloseTo(0.6);
    expect(out.get("rep")).toBeCloseTo(0.3);
    expect(out.get("grn")).toBeCloseTo(0.1);
    // Shares sum to 1.0 (modulo float rounding).
    const sum = [...out.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0);
  });

  it("ignores candidates with missing party affiliation defensively", () => {
    const out = computeSeatShareFromTally(
      { c1: 50_000, ghost: 50_000 },
      { c1: "dem" } // ghost has no entry
    );
    // ghost's votes are excluded from both party-bucket and the
    // grand-total denominator → dem ends at 100% of accounted votes.
    expect(out.get("dem")).toBeCloseTo(1.0);
  });

  it("ignores negative or non-finite vote counts defensively", () => {
    const out = computeSeatShareFromTally(
      { c1: 50_000, c2: -100, c3: NaN, c4: Infinity },
      { c1: "dem", c2: "rep", c3: "grn", c4: "ind" }
    );
    expect(out.get("dem")).toBeCloseTo(1.0);
    expect(out.has("rep")).toBe(false);
    expect(out.has("grn")).toBe(false);
    expect(out.has("ind")).toBe(false);
  });
});

describe("usesSeatShareIncumbency", () => {
  const base = { countryId: "US", state: "FL", cycle: 5 } as unknown as Election;

  it("is true for multi-seat proportional chambers", () => {
    for (const electionType of ["house", "commons", "shugiin", "bundestag", "landtag"]) {
      expect(usesSeatShareIncumbency({ ...base, electionType } as Election)).toBe(true);
    }
  });

  it("is false for every single-winner executive office", () => {
    for (const electionType of ["governor", "president", "uachtaran", "ministerPresident"]) {
      expect(usesSeatShareIncumbency({ ...base, electionType } as Election)).toBe(false);
    }
  });

  it("is false for the US Senate (flat officeholder shield instead)", () => {
    expect(usesSeatShareIncumbency({ ...base, electionType: "senate" } as Election)).toBe(false);
  });

  it("is true for a BR senate race (multi-seat PR despite the shared type)", () => {
    expect(
      usesSeatShareIncumbency({ ...base, countryId: "BR", electionType: "senate" } as Election)
    ).toBe(true);
  });
});

describe("getIncumbentSeatShareByParty", () => {
  /** Mirrors the live FL cycle-4 result: party 1 won 72.13% of a two-way race. */
  const priorTally = {
    finalized: true,
    totalVotes: { c1: 721_300, c2: 278_700 },
    candidateParties: { c1: "1", c2: "2" },
  };

  function dbWithPrior(prior: Election, tally: unknown): MockDb {
    const db = createMockDb();
    db.collection.mockImplementation((name: string) => {
      if (name === "elections") {
        return { find: () => ({ sort: () => ({ toArray: async () => [prior] }) }) };
      }
      return { findOne: async () => tally };
    });
    return db;
  }

  function electionOf(electionType: string, cycle: number): Election {
    return {
      _id: `${electionType}-${cycle}`,
      countryId: "US",
      state: "FL",
      electionType,
      status: cycle === 4 ? "resolved" : "active",
      cycle,
    } as unknown as Election;
  }

  it("returns an empty map for a single-winner executive race even when a prior tally exists", async () => {
    // Regression: a VACANT governor seat leaves `incumbentPartyId` unset, so the
    // incumbency driver fell through to this map and read the prior race's
    // 72/28 vote split as a "seat share" — handing a party that never held the
    // seat a phantom -7.2pt drag (live FL Governor, cycle 5). Single-winner
    // executives must never produce this map; a vacant seat is an open seat.
    const db = dbWithPrior(electionOf("governor", 4), priorTally);
    const out = await getIncumbentSeatShareByParty(electionOf("governor", 5), db as unknown as Db);
    expect(out.size).toBe(0);
    // Bails out BEFORE any query: the guard also drops the two round-trips this
    // resolver otherwise pays on every executive race, every turn.
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("returns an empty map for a presidential race", async () => {
    const db = dbWithPrior(electionOf("president", 4), priorTally);
    const out = await getIncumbentSeatShareByParty(electionOf("president", 5), db as unknown as Db);
    expect(out.size).toBe(0);
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("returns an empty map for a US Senate race without querying", async () => {
    const db = dbWithPrior(electionOf("senate", 4), priorTally);
    const out = await getIncumbentSeatShareByParty(electionOf("senate", 5), db as unknown as Db);
    expect(out.size).toBe(0);
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("still returns the prior-cycle map for a multi-seat chamber", async () => {
    const db = dbWithPrior(electionOf("house", 4), priorTally);
    const out = await getIncumbentSeatShareByParty(electionOf("house", 5), db as unknown as Db);
    expect(out.get("1")).toBeCloseTo(0.7213, 4);
    expect(out.get("2")).toBeCloseTo(0.2787, 4);
    expect(db.collection).toHaveBeenCalled();
  });
});
