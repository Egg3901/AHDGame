/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
