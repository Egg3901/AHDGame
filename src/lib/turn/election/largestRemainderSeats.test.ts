import { describe, it, expect } from "vitest";
import { largestRemainderSeats } from "./seatAllocation";

const c = (id: string, votes: number, party?: string | null) => ({ id, votes, party });

describe("largestRemainderSeats — the one apportionment rule (#585)", () => {
  it("assigns floors then the remainder by largest fractional part", () => {
    // 10 seats over 100 votes: exact = 5.7 / 2.8 / 1.5 → floors 5/2/1, 2 left,
    // handed to the two largest remainders (.8 then .7).
    const { seats } = largestRemainderSeats([c("a", 57), c("b", 28), c("c", 15)], 10, {
      minShare: 0,
      totalVotesForShare: 100,
    });
    expect(seats).toEqual({ a: 6, b: 3, c: 1 });
    expect(seats.a + seats.b + seats.c).toBe(10);
  });

  it("conserves the seat total exactly", () => {
    const { seats } = largestRemainderSeats([c("a", 33), c("b", 33), c("c", 33), c("d", 1)], 7, {
      minShare: 0,
      totalVotesForShare: 100,
    });
    expect(Object.values(seats).reduce((s, v) => s + v, 0)).toBe(7);
  });

  it("pools same-party candidates against the threshold", () => {
    // Neither Labour candidate clears 20% alone; together they hold 43%.
    const { seats, usedFallback } = largestRemainderSeats(
      [c("lab1", 22, "1"), c("lab2", 21, "1"), c("con", 57, "2")],
      10,
      { minShare: 0.2, totalVotesForShare: 100 }
    );
    expect(usedFallback).toBe(false);
    expect(seats.lab1 + seats.lab2).toBeGreaterThan(0);
  });

  it("keeps independents standing alone rather than pooling them together", () => {
    const { seats } = largestRemainderSeats(
      [c("i1", 12, "independent"), c("i2", 11, "independent"), c("p", 77, "2")],
      10,
      { minShare: 0.2, totalVotesForShare: 100 }
    );
    // 12% and 11% each fall under the 20% gate on their own, so only the party
    // clears it and takes every seat.
    expect(seats).toEqual({ i1: 0, i2: 0, p: 10 });
  });

  it("does not re-admit sub-threshold candidates when someone clears the gate", () => {
    // The bug behind ticket #1032: a 0.8% fringe candidate used to be seated
    // whenever there were fewer candidates than seats.
    const { seats, usedFallback } = largestRemainderSeats(
      [c("big", 99.2, "1"), c("fringe", 0.8, "2")],
      90,
      { minShare: 0.05, totalVotesForShare: 100 }
    );
    expect(usedFallback).toBe(false);
    expect(seats.fringe).toBe(0);
    expect(seats.big).toBe(90);
  });

  it("falls back to ranked order only when nobody clears the gate", () => {
    const { seats, usedFallback } = largestRemainderSeats(
      [c("a", 30, "1"), c("b", 25, "2"), c("d", 20, "3")],
      2,
      { minShare: 0.9, totalVotesForShare: 100 }
    );
    expect(usedFallback).toBe(true);
    // Fallback is capped at min(totalSeats, candidates) in ranked order.
    expect(seats.d).toBe(0);
    expect(seats.a + seats.b).toBe(2);
  });

  it("reports a zero-vote pool instead of inventing an allocation", () => {
    const { poolVotes, seats } = largestRemainderSeats([c("a", 0), c("b", 0)], 5, {
      minShare: 0,
      totalVotesForShare: 0,
    });
    expect(poolVotes).toBe(0);
    expect(seats).toEqual({ a: 0, b: 0 });
  });

  it("returns every input id, including those that won nothing", () => {
    const { seats } = largestRemainderSeats([c("a", 100, "1"), c("z", 1, "2")], 3, {
      minShare: 0.5,
      totalVotesForShare: 101,
    });
    expect(Object.keys(seats).sort()).toEqual(["a", "z"]);
    expect(seats.z).toBe(0);
  });

  it("still conserves seats when the winner's bonus re-weights the pool", () => {
    const { seats } = largestRemainderSeats(
      [c("a", 45, "1"), c("b", 35, "2"), c("d", 20, "3")],
      20,
      {
        minShare: 0,
        totalVotesForShare: 100,
        majoritarianBonus: { exponent: 1.6, taper: 0 } as never,
      }
    );
    expect(Object.values(seats).reduce((s, v) => s + v, 0)).toBe(20);
    // The bonus boosts the plurality party; it must never shrink it.
    expect(seats.a).toBeGreaterThanOrEqual(9);
  });
});
