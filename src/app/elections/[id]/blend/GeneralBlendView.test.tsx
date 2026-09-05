/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CandidateDetail, ElectionDetail } from "../components/ElectionDetailTypes";
import { GeneralBlendView } from "./GeneralBlendView";

function candidate(over: Partial<CandidateDetail> = {}): CandidateDetail {
  return {
    id: "c1",
    characterId: "ch1",
    characterName: "First Ticket",
    party: "1",
    partyName: "Democratic Party",
    partyColor: "#2563eb",
    isNPP: false,
    nppId: null,
    sharePct: 49.2,
    isYou: false,
    endorsements: [],
    ...over,
  } as unknown as CandidateDetail;
}

const CANDIDATES = [
  candidate({ id: "c1", characterName: "First Ticket", isYou: true }),
  candidate({
    id: "c2",
    characterName: "Second Ticket",
    party: "2",
    partyName: "Republican Party",
    partyColor: "#dc2626",
  }),
];

function election(): ElectionDetail {
  return {
    id: "e1",
    electionType: "president",
    state: "National",
    countryId: "US",
    cycle: 1,
    electionYear: 2028,
    status: "active",
    startTurn: 4100,
    endTurn: 4186,
    primaryEndTurn: 4150,
    inPrimary: false,
    isEnded: false,
    isUpcoming: false,
    inGeneral: true,
    primaryAdvanceCount: 1,
    byParty: [],
    allCandidates: CANDIDATES,
    snapshotHistory: [],
    myCharId: "ch1",
    myEndorsedCandidateId: null,
    gameState: { isActive: true, pausedAt: null, currentTurn: 4182 },
    generalVotes: {
      totalVotes: { c1: 69_473_000, c2: 67_213_000 },
      candidateNames: {},
      candidateParties: {},
      candidateColors: {},
      finalized: false,
      seatsEstimate: null,
      turnSnapshots: [],
      electoralVotesByCandidate: { c1: 276, c2: 251 },
      evByState: { CA: 54, TX: 40, PA: 19 },
      stateVoteData: {
        CA: { votesByCandidate: { c1: 700, c2: 300 }, evByCandidate: { c1: 54 } },
        TX: { votesByCandidate: { c1: 400, c2: 600 }, evByCandidate: { c2: 40 } },
        PA: { votesByCandidate: { c1: 510, c2: 490 }, evByCandidate: { c1: 19 } },
      },
    },
  } as unknown as ElectionDetail;
}

function renderView() {
  return render(
    <GeneralBlendView election={election()} electionId="e1" wire={[]} onRefresh={() => {}} />
  );
}

/**
 * Both trees are in the DOM at once (`lg:hidden` and `hidden lg:block`), so
 * anything reaching both layouts appears twice. Counting is the point: a
 * rail-only block reads as present when you only assert "at least one", which
 * is how these shipped invisible on mobile.
 */
describe("GeneralBlendView", () => {
  it("shows the reader their own ticket's standing on both layouts", () => {
    renderView();
    // 276 EV against 251 is a 25 EV lead.
    expect(screen.getAllByText("+25 EV lead")).toHaveLength(2);
    expect(screen.getAllByText("Your ticket")).toHaveLength(2);
  });

  it("carries the board's margin-tier legend to both layouts", () => {
    renderView();
    expect(screen.getAllByText("MARGIN TIERS:")).toHaveLength(2);
  });

  it("keeps the tiles themselves on both layouts", () => {
    renderView();
    expect(screen.getAllByText("PA")).toHaveLength(2);
  });
});

describe("nothing on this screen is won", () => {
  // GeneralBlendView renders only while a race is RUNNING; a concluded one gets
  // ResultsBlendView. So every figure here is a forecast from the votes banked
  // so far, and the screen has to say so rather than reading as a called result.
  it("says the figures are projected, on both layouts", () => {
    renderView();
    expect(screen.getAllByText(/No state is won until the race resolves/)).toHaveLength(2);
  });

  it("labels the tickets' columns rather than leaving bare numbers", () => {
    renderView();
    expect(screen.getAllByText(/Projected electoral votes/)).toHaveLength(2);
  });

  it("uses one masthead label across both layouts", () => {
    // The mobile masthead had its own hardcoded "Election Night", so fixing the
    // desktop kicker alone left the two trees disagreeing about what the race
    // even is.
    renderView();
    const mastheads = screen.getAllByText(/^(Election Night|The Campaign)$/);
    expect(mastheads).toHaveLength(2);
    expect(new Set(mastheads.map((n) => n.textContent)).size).toBe(1);
  });
});
