import { describe, it, expect } from "vitest";
import { isVotingDeadlinePassed } from "./billVotingWindow";

describe("isVotingDeadlinePassed", () => {
  const now = new Date("2026-04-19T18:00:00.000Z");

  it("returns false when deadline is null or undefined", () => {
    expect(isVotingDeadlinePassed(null, now)).toBe(false);
    expect(isVotingDeadlinePassed(undefined, now)).toBe(false);
  });

  it("returns false when deadline is in the future", () => {
    const future = new Date("2026-04-19T20:00:00.000Z");
    expect(isVotingDeadlinePassed(future, now)).toBe(false);
    expect(isVotingDeadlinePassed(future.toISOString(), now)).toBe(false);
  });

  it("returns true when deadline is in the past", () => {
    const past = new Date("2026-04-19T11:21:30.000Z");
    expect(isVotingDeadlinePassed(past, now)).toBe(true);
    expect(isVotingDeadlinePassed(past.toISOString(), now)).toBe(true);
  });

  it("returns true when deadline exactly equals now (matches useCountdown)", () => {
    expect(isVotingDeadlinePassed(now, now)).toBe(true);
    expect(isVotingDeadlinePassed(now.toISOString(), now)).toBe(true);
  });

  it("returns false for invalid date strings", () => {
    expect(isVotingDeadlinePassed("not-a-date", now)).toBe(false);
    expect(isVotingDeadlinePassed("", now)).toBe(false);
  });
});
