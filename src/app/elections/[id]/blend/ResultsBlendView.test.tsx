/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";
import { ResultsBlendView } from "./ResultsBlendView";

function unit(id: string, name: string, weight: number, leaderId: string, marginPct: number) {
  return {
    id,
    name,
    weight,
    totalVotes: 1000,
    reportingPct: 100,
    called: true,
    calledFor: leaderId,
    leaderId,
    tied: false,
    leaderMargin: 0,
    leaderMarginPct: marginPct,
    candidates: [],
  };
}

function data(): ElectionResultsResponse {
  return {
    election: {
      id: "e1",
      countryId: "US",
      electionType: "president",
      state: "National",
      status: "completed",
      cycle: 1,
      electionYear: 2028,
      currentTurn: 4186,
      startTurn: 4100,
      endTurn: 4186,
      totalSeats: 1,
      evNeeded: 63,
      totalEv: 124,
    },
    candidates: [
      {
        id: "c1",
        name: "First Ticket",
        party: "1",
        partyName: "Democratic Party",
        partyColor: "#2563eb",
        isNPP: false,
        totalVotes: 71_937_000,
        voteSharePct: 50.1,
        electoralVotes: 73,
      },
      {
        id: "c2",
        name: "Second Ticket",
        party: "2",
        partyName: "Republican Party",
        partyColor: "#dc2626",
        isNPP: false,
        totalVotes: 67_055_000,
        voteSharePct: 46.7,
        electoralVotes: 51,
      },
    ],
    units: [unit("CA", "California", 54, "c1", 28.4), unit("PA", "Pennsylvania", 19, "c1", 1.4)],
    summary: {
      totalVotes: 143_588_000,
      unitsReporting: 2,
      totalUnits: 2,
      unitsCalled: 2,
      projectedWinner: "c1",
    },
  } as unknown as ElectionResultsResponse;
}

/**
 * The desktop tree is `hidden lg:block` and the mobile one `lg:hidden`, so both
 * are in the DOM at once and anything reaching both layouts appears twice.
 * Asserting "at least one" is what let a rail-only block ship as invisible on
 * mobile, so these count.
 */
describe("ResultsBlendView", () => {
  it("gives every ticket's result to both layouts, not the desktop rail alone", () => {
    render(<ResultsBlendView data={data()} route="concluded" />);
    // The compact vote total appears only on a ticket row; the candidate's name
    // also shows in the states table's winner column, so it cannot be counted.
    expect(screen.getAllByText("71.9M")).toHaveLength(2);
    expect(screen.getAllByText("67.1M")).toHaveLength(2);
  });

  it("names the winner on both layouts", () => {
    render(<ResultsBlendView data={data()} route="concluded" />);
    // The winner's star sits beside their row in each tree.
    expect(screen.getAllByText("★")).toHaveLength(2);
  });

  it("lists the closest states on both layouts", () => {
    render(<ResultsBlendView data={data()} route="concluded" />);
    expect(screen.getAllByText("Pennsylvania").length).toBeGreaterThanOrEqual(2);
  });

  describe("House vote panel", () => {
    afterEach(() => {
      cleanup();
      vi.unstubAllGlobals();
    });

    it("mounts once for a deadlocked House, above both layouts", async () => {
      const fetchFn = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          vote: {
            status: "open",
            openedTurn: 10,
            closesTurn: 34,
            turnsLeft: 14,
            actingPresidentName: "Alex Acting",
            threshold: 26,
            delegationsVoting: 48,
            winnerId: null,
            candidates: [{ id: "c1", name: "First Ticket", delegations: 20, members: 190 }],
            viewer: { isHouseMember: false, canVote: false, choiceId: null },
          },
        }),
      }));
      vi.stubGlobal("fetch", fetchFn);
      const withVote = data();
      withVote.summary.contingentHouseVote = {
        status: "open",
        actingPresidentName: "Alex Acting",
        closesTurn: 34,
      };
      render(<ResultsBlendView data={withVote} route="concluded" />);
      await waitFor(() => expect(screen.getAllByLabelText("House vote")).toHaveLength(1));
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("stays out of the way when there is no House vote", () => {
      const fetchFn = vi.fn();
      vi.stubGlobal("fetch", fetchFn);
      render(<ResultsBlendView data={data()} route="concluded" />);
      expect(screen.queryByLabelText("House vote")).toBeNull();
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });
});
