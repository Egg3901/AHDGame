import { describe, expect, it } from "vitest";
import { isInPrimaryPhase, isPrimaryClosed } from "../electionDeadlineFilters";

const NOW = new Date("2026-06-24T00:00:00Z");
const TURN = 100;

describe("isInPrimaryPhase", () => {
  it("is true while a primary boundary is still ahead (turn-first)", () => {
    expect(isInPrimaryPhase({ primaryEndTurn: TURN + 10 }, TURN, NOW)).toBe(true);
  });

  it("is false once the primary boundary has passed (general phase)", () => {
    expect(isInPrimaryPhase({ primaryEndTurn: TURN - 10 }, TURN, NOW)).toBe(false);
  });

  it("is false for a general-only race with no primary boundary at all", () => {
    // Critically: an absent boundary must NOT read as an open primary, or
    // general-only races would wrongly get intra-party-only debate pairing.
    expect(isInPrimaryPhase({}, TURN, NOW)).toBe(false);
    expect(isPrimaryClosed({}, TURN, NOW)).toBe(false);
  });

  it("falls back to the Date boundary when no turn is set", () => {
    const future = new Date(NOW.getTime() + 60_000);
    const past = new Date(NOW.getTime() - 60_000);
    expect(isInPrimaryPhase({ primaryEndTime: future }, TURN, NOW)).toBe(true);
    expect(isInPrimaryPhase({ primaryEndTime: past }, TURN, NOW)).toBe(false);
  });
});
