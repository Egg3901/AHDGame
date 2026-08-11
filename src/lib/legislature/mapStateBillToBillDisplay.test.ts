import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mapStateBillToBillDisplay } from "./mapStateBillToBillDisplay";
import type { StateBillDisplay } from "@/lib/legislature/dto/stateLegislature";

function buildBill(overrides: Partial<StateBillDisplay> = {}): StateBillDisplay {
  return {
    id: "bill-1",
    title: "Tax reform act",
    summary: "A reform",
    sponsorName: "Anthony Norman Albanese",
    status: "active",
    votesFor: 38,
    votesAgainst: 0,
    votesAbstain: 0,
    proposedAt: "2026-04-17T00:00:00.000Z",
    votingEndsAt: "2026-04-19T11:21:30.000Z",
    ...overrides,
  };
}

describe("mapStateBillToBillDisplay — canVoteOrigin deadline gating", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows voting on an active bill before the deadline", () => {
    vi.setSystemTime(new Date("2026-04-19T10:00:00.000Z"));
    const result = mapStateBillToBillDisplay(buildBill(), { chamber: "senate", canVote: true });
    expect(result.canVoteOrigin).toBe(true);
  });

  it("blocks voting on an active bill after the deadline has passed but before the turn resolves", () => {
    // Exactly the screenshot scenario: bill is still `active` but votingEndsAt is in the past.
    vi.setSystemTime(new Date("2026-04-19T18:00:00.000Z"));
    const result = mapStateBillToBillDisplay(buildBill(), { chamber: "senate", canVote: true });
    expect(result.canVoteOrigin).toBe(false);
  });

  it("blocks voting when user has no seat, regardless of deadline", () => {
    vi.setSystemTime(new Date("2026-04-19T10:00:00.000Z"));
    const result = mapStateBillToBillDisplay(buildBill(), { chamber: "senate", canVote: false });
    expect(result.canVoteOrigin).toBe(false);
  });

  it("allows override voting on a veto_override bill before override deadline", () => {
    vi.setSystemTime(new Date("2026-04-19T10:00:00.000Z"));
    const result = mapStateBillToBillDisplay(
      buildBill({
        status: "veto_override",
        overrideVotingEndsAt: "2026-04-19T20:00:00.000Z",
      }),
      { chamber: "senate", canVote: true }
    );
    expect(result.canVoteOrigin).toBe(true);
  });

  it("blocks override voting after override deadline has passed", () => {
    vi.setSystemTime(new Date("2026-04-19T22:00:00.000Z"));
    const result = mapStateBillToBillDisplay(
      buildBill({
        status: "veto_override",
        overrideVotingEndsAt: "2026-04-19T20:00:00.000Z",
      }),
      { chamber: "senate", canVote: true }
    );
    expect(result.canVoteOrigin).toBe(false);
  });

  it("does not set canVoteOrigin for terminal statuses", () => {
    vi.setSystemTime(new Date("2026-04-19T10:00:00.000Z"));
    const result = mapStateBillToBillDisplay(buildBill({ status: "enacted" }), {
      chamber: "senate",
      canVote: true,
    });
    expect(result.canVoteOrigin).toBe(false);
  });

  it("preserves adminProposed for shared bill displays", () => {
    vi.setSystemTime(new Date("2026-04-19T10:00:00.000Z"));
    const result = mapStateBillToBillDisplay(buildBill({ adminProposed: true }), {
      chamber: "senate",
      canVote: true,
    });
    expect(result.adminProposed).toBe(true);
  });

  it("passes sponsorId and sponsorSequentialId through for profile links", () => {
    vi.setSystemTime(new Date("2026-04-19T10:00:00.000Z"));
    const result = mapStateBillToBillDisplay(
      buildBill({
        sponsorId: "aaaaaaaaaaaaaaaaaaaaaaaa",
        sponsorSequentialId: 7,
        sponsorName: "Kimberly Kowalski",
      }),
      { chamber: "senate", canVote: false }
    );
    expect(result.sponsorId).toBe("aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(result.sponsorSequentialId).toBe(7);
    expect(result.sponsorName).toBe("Kimberly Kowalski");
  });
});
