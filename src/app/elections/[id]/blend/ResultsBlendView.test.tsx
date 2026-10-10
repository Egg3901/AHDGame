/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";
import type { ElectionDetail } from "../components/ElectionDetailTypes";
import { ResultsBlendView, ResolutionBanners } from "./ResultsBlendView";

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
 * One stage serves every width, so each figure appears exactly once. These
 * count rather than assert "at least one", so a duplicated block shows up.
 */
describe("ResultsBlendView", () => {
  it("gives every ticket's result on the stage", () => {
    render(<ResultsBlendView data={data()} route="concluded" />);
    // The compact vote total appears only on a ticket row; the candidate's name
    // also shows in the states table's winner column, so it cannot be counted.
    expect(screen.getAllByText("71.9M")).toHaveLength(1);
    expect(screen.getAllByText("67.1M")).toHaveLength(1);
  });

  it("names the winner", () => {
    render(<ResultsBlendView data={data()} route="concluded" />);
    // The winner's star sits beside their row in the final tickets.
    expect(screen.getAllByText("★")).toHaveLength(1);
  });

  it("lists the closest states", () => {
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
            candidates: [
              { id: "c1", name: "First Ticket", delegations: 20, members: 190, dropped: false },
            ],
            delegations: [{ stateId: "OH", backing: "c1", tied: false }],
            whips: [],
            ballots: [{ turn: 10, opening: true, totals: { c1: 20 }, winnerId: null }],
            defiances: [],
            viewer: {
              isHouseMember: false,
              canVote: false,
              choiceId: null,
              whip: null,
              canWhip: [],
            },
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

describe("ResolutionBanners", () => {
  const colors = new Map([["c1", "#2563eb"]]);
  function ended(over: Record<string, unknown> = {}) {
    return {
      isEnded: true,
      allCandidates: [
        {
          id: "c1",
          characterName: "First Ticket",
          partyName: "Democratic Party",
          partyColor: "#2563eb",
        },
        {
          id: "c2",
          characterName: "Second Ticket",
          partyName: "Republican Party",
          partyColor: "#dc2626",
        },
      ],
      generalVotes: {
        totalVotes: { c1: 600, c2: 400 },
        electoralVotesByCandidate: { c1: 300, c2: 238 },
        evByState: { OH: 538 },
        ...over,
      },
    } as unknown as ElectionDetail;
  }

  it("announces the winner of a concluded race", () => {
    render(<ResolutionBanners election={ended()} colorMap={colors} />);
    expect(screen.getByText("First Ticket Wins the Presidency")).toBeTruthy();
    expect(screen.getByText(/300 Electoral Votes · 60\.0% Popular Vote/)).toBeTruthy();
  });

  it("says the contingent ballot is pending when nobody is seated yet", () => {
    const e = ended({
      electoralVotesByCandidate: { c1: 260, c2: 240 },
      contingentResolutionPending: true,
    });
    render(<ResolutionBanners election={e} colorMap={colors} />);
    expect(screen.getByText("Contingent resolution pending")).toBeTruthy();
    expect(screen.queryByText(/Wins the Presidency/)).toBeNull();
  });

  it("renders nothing for a race still running", () => {
    const e = { ...ended(), isEnded: false } as unknown as ElectionDetail;
    const { container } = render(<ResolutionBanners election={e} colorMap={colors} />);
    expect(container.textContent).toBe("");
  });
});
