import { describe, expect, it } from "vitest";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import {
  CHARTER_DEADLINE_MIN_IRL_HOURS,
  CHARTER_DEADLINE_TURNS,
  computeCharterDeadline,
} from "./charterDeadlines";

describe("computeCharterDeadline", () => {
  it("returns max(14 turns, 72 IRL hours) from start", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const result = computeCharterDeadline(start);
    const turnDelta = CHARTER_DEADLINE_TURNS * MS_PER_TURN;
    const irlDelta = CHARTER_DEADLINE_MIN_IRL_HOURS * 60 * 60 * 1000;
    const expectedDelta = Math.max(turnDelta, irlDelta);
    expect(result.getTime() - start.getTime()).toBe(expectedDelta);
  });

  it("returns at least 72 IRL hours regardless of cadence", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const result = computeCharterDeadline(start);
    const irlMs = CHARTER_DEADLINE_MIN_IRL_HOURS * 60 * 60 * 1000;
    expect(result.getTime() - start.getTime()).toBeGreaterThanOrEqual(irlMs);
  });

  it("returns at least 14 turns of duration", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const result = computeCharterDeadline(start);
    const turnMs = CHARTER_DEADLINE_TURNS * MS_PER_TURN;
    expect(result.getTime() - start.getTime()).toBeGreaterThanOrEqual(turnMs);
  });

  it("is a pure function — same input → same output", () => {
    const a = computeCharterDeadline(new Date("2026-01-01T00:00:00Z"));
    const b = computeCharterDeadline(new Date("2026-01-01T00:00:00Z"));
    expect(a.getTime()).toBe(b.getTime());
  });
});
