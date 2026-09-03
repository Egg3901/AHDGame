/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { CountryId } from "@/lib/constants/countries";
import { FomcCommitteeTab } from "./FomcCommitteeTab";

vi.mock("@/components/PlayerSelector", () => ({
  PlayerSelector: () => <div data-testid="player-selector" />,
}));

function boardSeat(i: number, vacant: boolean): Record<string, unknown> {
  return {
    seatId: `seat-${i + 1}`,
    isChair: i === 0,
    occupantType: vacant ? "vacant" : i === 0 ? "player" : "npp",
    name: vacant ? "Vacant" : i === 0 ? "Poppy" : `Governor ${i + 1}`,
    alignment: "hawk",
    termExpiresAtTurn: vacant ? null : 900,
  };
}

function committeePayload(vacantCount: number): Record<string, unknown> {
  return {
    hasCommittee: true,
    primeRate: 4.65,
    rateChangesThisTerm: 3,
    rateChangesPerTerm: 16,
    currentTurn: 514,
    nextMeetingAtTurn: 518,
    termEndsAtTurn: 576,
    majorityNeeded: 4,
    meetingHistory: [],
    canNominate: false,
    viewerIsSenator: false,
    nominations: [],
    viewerSeatId: vacantCount === 6 ? "seat-1" : null,
    // Prod shape at ticket #1238: chair seated, the rest vacant.
    board: Array.from({ length: 7 }, (_, i) => boardSeat(i, i > 0 && i <= vacantCount)),
    meeting: null,
  };
}

function mockFetch(payload: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  ) as unknown as typeof fetch;
}

function governanceWith(
  ballot: { allowed: boolean; reason?: string },
  nextDeadline: { turn: number; kind: string } | null = null
): Record<string, unknown> {
  return {
    institutionId: "US",
    currency: "USD",
    memberCountryIds: ["US"],
    viewerRole: "member",
    allowedActions: [
      { action: "open_meeting", allowed: false, reason: "A meeting is already taking votes." },
      {
        action: "cast_ballot",
        allowed: ballot.allowed,
        ...(ballot.reason ? { reason: ballot.reason } : {}),
        deadlineTurn: 538,
      },
      { action: "resolve_meeting", allowed: true, deadlineTurn: 538 },
      { action: "set_rate", allowed: false, reason: "A seated committee decides." },
    ],
    nextDeadline,
    normalizedRateChoices: [4.5, 4.75, 5],
    primeRateOnGrid: 4.65,
  };
}

function votingMeeting(viewerHasVoted: boolean): Record<string, unknown> {
  return {
    motion: "hike",
    proposedDelta: 0.5,
    playerVoteDeadline: new Date(Date.UTC(2030, 0, 2)).toISOString(),
    resolvesOnTurn: 538,
    agree: 6,
    disagree: 0,
    needed: 4,
    viewerHasVoted,
    viewerCanVote: !viewerHasVoted,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FomcCommitteeTab — understaffed board (ticket #1238)", () => {
  it("shows why motions cannot pass when most seats are vacant", async () => {
    mockFetch(committeePayload(6));

    render(<FomcCommitteeTab countryId={"US" as CountryId} />);

    await waitFor(() => expect(screen.getByText("Board understaffed")).toBeTruthy());
    expect(screen.getByText(/6 of 7 board seats are vacant/)).toBeTruthy();
    expect(screen.getByText(/no motion can carry/)).toBeTruthy();
    expect(screen.getByText(/presidential nomination and Senate confirmation/)).toBeTruthy();
  });

  it("stays quiet on a fully staffed board", async () => {
    mockFetch(committeePayload(0));

    render(<FomcCommitteeTab countryId={"US" as CountryId} />);

    await waitFor(() => expect(screen.getByText("Board of Governors")).toBeTruthy());
    expect(screen.queryByText("Board understaffed")).toBeNull();
  });
});

describe("FomcCommitteeTab governance contract", () => {
  function governedPayload(
    meeting: Record<string, unknown> | null,
    ballot: { allowed: boolean; reason?: string },
    nextDeadline: { turn: number; kind: string } | null,
    viewerSeatId: string | null = "seat-1"
  ): Record<string, unknown> {
    return {
      ...committeePayload(0),
      viewerSeatId,
      meeting,
      governance: governanceWith(ballot, nextDeadline),
    };
  }

  it("open: shows the cadence deadline when no meeting is active", async () => {
    mockFetch(
      governedPayload(
        null,
        { allowed: false, reason: "No meeting is taking votes." },
        { turn: 518, kind: "cadence" },
        null
      )
    );

    render(<FomcCommitteeTab countryId={"US" as CountryId} />);

    await waitFor(() =>
      expect(screen.getByText("No meeting is currently in session.")).toBeTruthy()
    );
    expect(screen.getByText(/Next deadline: turn 518/)).toBeTruthy();
  });

  it("voting: enables the ballot buttons from the contract", async () => {
    mockFetch(
      governedPayload(
        votingMeeting(false),
        { allowed: true },
        { turn: 538, kind: "meeting_deadline" }
      )
    );

    render(<FomcCommitteeTab countryId={"US" as CountryId} />);

    await waitFor(() => expect(screen.getByText("Raise rate")).toBeTruthy());
    expect((screen.getByText("Raise rate") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/Next deadline: turn 538/)).toBeTruthy();
  });

  it("awaiting resolution: shows the recorded ballot", async () => {
    mockFetch(
      governedPayload(
        votingMeeting(true),
        { allowed: false, reason: "This seat already voted." },
        { turn: 538, kind: "meeting_deadline" }
      )
    );

    render(<FomcCommitteeTab countryId={"US" as CountryId} />);

    await waitFor(() => expect(screen.getByText("Your ballot is recorded.")).toBeTruthy());
  });

  it("resolved: lists the carried motion from history", async () => {
    const payload = governedPayload(null, { allowed: false }, { turn: 546, kind: "cadence" }, null);
    mockFetch({
      ...payload,
      meetingHistory: [
        {
          motion: "hike",
          proposedDelta: 0.5,
          result: "passed",
          openedAtTurn: 538,
          resolvedAtTurn: 539,
          agree: 4,
          disagree: 0,
          abstain: 3,
        },
      ],
    });

    render(<FomcCommitteeTab countryId={"US" as CountryId} />);

    await waitFor(() => expect(screen.getByText("Recent sessions")).toBeTruthy());
    expect(screen.getByText("Passed")).toBeTruthy();
  });

  it("ineligible: disables the buttons and shows the reason", async () => {
    mockFetch(
      governedPayload(
        votingMeeting(false),
        { allowed: false, reason: "Only a seated board member can vote." },
        { turn: 538, kind: "meeting_deadline" }
      )
    );

    render(<FomcCommitteeTab countryId={"US" as CountryId} />);

    await waitFor(() => expect(screen.getByText("Raise rate")).toBeTruthy());
    expect((screen.getByText("Raise rate") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Only a seated board member can vote.")).toBeTruthy();
  });
});
