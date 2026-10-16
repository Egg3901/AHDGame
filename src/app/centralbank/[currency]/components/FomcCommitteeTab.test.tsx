/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CountryId } from "@/lib/constants/countries";
import messages from "../../../../../messages/en/centralBank.json";
import { FomcCommitteeTab } from "./FomcCommitteeTab";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    key
      .split(".")
      .reduce<unknown>(
        (value, part) => (value as Record<string, unknown>)[part],
        messages.centralBank
      ),
}));

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
    majorityNeeded: Math.floor((7 - vacantCount) / 2) + 1,
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
  it("encourages filling vacant seats without saying motions cannot pass", async () => {
    mockFetch(committeePayload(6));

    render(<FomcCommitteeTab countryId={"US" as CountryId} />);

    await waitFor(() => expect(screen.getByText("Board understaffed")).toBeTruthy());
    expect(screen.getByText(/6 of 7 board seats are vacant/)).toBeTruthy();
    expect(screen.getByText(/1 vote from seated governors/)).toBeTruthy();
    expect(screen.queryByText(/no motion can carry/)).toBeNull();
    expect(screen.getByText(/presidential nomination and Senate confirmation/)).toBeTruthy();
  });

  it("stays quiet on a fully staffed board", async () => {
    mockFetch(committeePayload(0));

    render(<FomcCommitteeTab countryId={"US" as CountryId} />);

    await waitFor(() => expect(screen.getByText("Board of governors")).toBeTruthy());
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

it("shows a carried motion's blocked execution and policy reason", async () => {
  mockFetch({
    ...committeePayload(0),
    meetingHistory: [
      {
        motion: "hike",
        proposedDelta: 0.5,
        result: "passed",
        executionOutcome: "blocked",
        executionBlockedReason: "fx-committed",
        openedAtTurn: 500,
        resolvedAtTurn: 524,
        agree: 5,
        disagree: 2,
        abstain: 0,
      },
    ],
  });
  render(<FomcCommitteeTab countryId="US" />);
  await waitFor(() => expect(screen.getByText("Passed, execution blocked")).toBeTruthy());
  expect(
    screen.getByText("The exchange-rate commitment currently prevents an independent rate change.")
  ).toBeTruthy();
});

it("shows a rejected motion beside its controls and clears it while retrying before refreshing", async () => {
  const policyError =
    "The currency is pegged and the capital account is open. Float the currency or impose capital controls.";
  const payload = {
    ...committeePayload(0),
    viewerSeatId: "seat-1",
    meeting: { ...votingMeeting(false), motion: "hold", proposedDelta: 0 },
    governance: {
      ...governanceWith({ allowed: true }),
      allowedActions: [{ action: "set_motion", allowed: true }],
    },
  };
  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  let completeRetry!: (response: Response) => void;
  const retry = new Promise<Response>((resolve) => {
    completeRetry = resolve;
  });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(payload))
    .mockResolvedValueOnce(jsonResponse({ error: policyError }, 400))
    .mockReturnValueOnce(retry)
    .mockResolvedValueOnce(
      jsonResponse({
        ...payload,
        meeting: { ...votingMeeting(false), motion: "hike", proposedDelta: 0.5 },
      })
    );
  vi.stubGlobal("fetch", fetchMock);
  render(<FomcCommitteeTab countryId="US" />);

  const button = await screen.findByRole("button", { name: "Table motion" });
  const controls = screen.getByText("Table your motion").parentElement!;
  fireEvent.change(screen.getByRole("combobox", { name: "Motion" }), { target: { value: "hike" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Rate change" }), {
    target: { value: "0.5" },
  });
  fireEvent.click(button);

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain(policyError);
  expect(screen.queryByText("Your motion is on the table.")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "/api/country/us/fomc/motion",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ motion: "hike", delta: 0.5 }),
    })
  );
  expect(within(controls).getByRole("alert")).toBe(alert);

  fireEvent.click(button);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("Your motion is on the table.")).toBeNull();
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await act(async () => {
    completeRetry(jsonResponse({ ok: true }));
  });
  await screen.findByText("Motion: Raise rate (+0.50pp)");
  expect(within(controls).getByText("Your motion is on the table.")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(fetchMock).toHaveBeenLastCalledWith("/api/country/us/fomc", { cache: "no-store" });
});
