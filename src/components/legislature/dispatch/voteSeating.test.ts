import { describe, it, expect } from "vitest";
import { seatVoteColors, seatingThreshold, VOTE_COLORS } from "./voteSeating";

describe("seatingThreshold", () => {
  it("defaults to a simple majority of seats, shown as a rounded-up percentage", () => {
    // 100-seat Senate: majority = 51 seats = 51%
    expect(seatingThreshold(100)).toEqual({ need: 51, displayPct: 51 });
  });

  it("rounds the majority percentage up so a near-half chamber never reads as 50%", () => {
    // 435-seat House: majority = 218 seats = 50.1% -> displays 51%
    expect(seatingThreshold(435)).toEqual({ need: 218, displayPct: 51 });
  });

  it("uses the supplied percentage for filibuster cloture (3/5 of seats)", () => {
    expect(seatingThreshold(100, 60)).toEqual({ need: 60, displayPct: 60 });
  });

  it("uses the supplied percentage for a two-thirds supermajority", () => {
    expect(seatingThreshold(100, 67)).toEqual({ need: 67, displayPct: 67 });
  });

  it("rounds the required seat count up for an odd chamber under an explicit percentage", () => {
    // 65 seats at 60% = 39 -> ceil(39) = 39
    expect(seatingThreshold(65, 60)).toEqual({ need: 39, displayPct: 60 });
  });
});

describe("seatVoteColors", () => {
  it("returns one color per seat, ordered for | abstain | pending | against", () => {
    const colors = seatVoteColors({ for: 2, abstain: 1, against: 2 }, 6);
    expect(colors).toEqual([
      VOTE_COLORS.for,
      VOTE_COLORS.for,
      VOTE_COLORS.abstain,
      VOTE_COLORS.pending, // 6 total - 5 cast = 1 pending
      VOTE_COLORS.against,
      VOTE_COLORS.against,
    ]);
  });

  it("pads with pending when cast < total", () => {
    const colors = seatVoteColors({ for: 1, abstain: 0, against: 0 }, 4);
    expect(colors.filter((c) => c === VOTE_COLORS.pending)).toHaveLength(3);
    expect(colors).toHaveLength(4);
  });

  it("never overruns total when cast exceeds it", () => {
    const colors = seatVoteColors({ for: 5, abstain: 5, against: 5 }, 4);
    expect(colors).toHaveLength(4);
  });
});
