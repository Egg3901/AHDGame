/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ContingentHouseVoteView } from "@/lib/elections/contingentHouseVoteView";
import { ContingentHouseVotePanel } from "./ContingentHouseVotePanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const STATES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
];

/** Fifty delegations: `a` holds 20, `b` 24, `c` 4, one tie and one empty. */
function realisticDelegations() {
  return STATES.map((stateId, i) => {
    if (i === 48) return { stateId, backing: null, tied: true };
    if (i === 49) return { stateId, backing: null, tied: false };
    const backing = i < 20 ? "a" : i < 44 ? "b" : "c";
    return { stateId, backing, tied: false };
  });
}

function view(overrides: Partial<ContingentHouseVoteView> = {}): ContingentHouseVoteView {
  return {
    status: "open",
    openedTurn: 10,
    closesTurn: 34,
    turnsLeft: 14,
    actingPresidentName: "Alex Acting",
    threshold: 26,
    delegationsVoting: 48,
    winnerId: null,
    candidates: [
      { id: "a", name: "Ada Alpha", delegations: 20, members: 190, dropped: false },
      { id: "b", name: "Ben Beta", delegations: 24, members: 200, dropped: false },
      { id: "c", name: "Cy Gamma", delegations: 4, members: 40, dropped: false },
    ],
    delegations: realisticDelegations(),
    whips: [
      {
        key: "party:3",
        scope: "party",
        name: "Party Three",
        candidateId: "a",
        setByName: "Pat Chair",
        turn: 12,
      },
      {
        key: "coalition:7",
        scope: "coalition",
        name: "Coalition Seven",
        candidateId: "free",
        setByName: "Cal Chair",
        turn: 13,
      },
    ],
    ballots: [
      { turn: 10, opening: true, totals: { a: 19, b: 22, c: 4 }, winnerId: null },
      { turn: 11, opening: false, totals: { a: 20, b: 23, c: 4 }, winnerId: null },
      { turn: 12, opening: false, totals: { a: 20, b: 24, c: 4 }, winnerId: null },
    ],
    defiances: [],
    viewer: { isHouseMember: false, canVote: false, choiceId: null, whip: null, canWhip: [] },
    ...overrides,
  };
}

function mockFetch(payload: ContingentHouseVoteView | null, postOk = true) {
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return { ok: postOk, json: async () => (postOk ? { success: true } : { error: "Closed" }) };
    }
    return { ok: true, json: async () => ({ vote: payload }) };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const posts = (fn: ReturnType<typeof mockFetch>) =>
  fn.mock.calls.filter(([, init]) => init?.method === "POST");

describe("ContingentHouseVotePanel", () => {
  it("renders nothing when the election has no House vote", async () => {
    const fetchFn = mockFetch(null);
    const { container } = render(<ContingentHouseVotePanel electionId="e1" />);
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("shows the live board to a spectator: acting president, window, majority, grid, whips, ballots", async () => {
    mockFetch(view());
    render(<ContingentHouseVotePanel electionId="e1" />);
    expect(await screen.findByText("House vote")).toBeTruthy();
    expect(screen.getByText(/Closes on turn 34 \(14 turns left\)/)).toBeTruthy();
    expect(screen.getByText(/chose Alex Acting as vice president/)).toBeTruthy();
    expect(screen.getByText(/State delegations now/)).toBeTruthy();
    expect(screen.getByText(/first candidate with 26 state delegations wins/)).toBeTruthy();
    expect(screen.getByText(/A tied delegation casts no vote/)).toBeTruthy();
    expect(screen.getByText(/The District of Columbia has no House vote/)).toBeTruthy();

    // Delegations versus the majority, leader first.
    const rows = screen.getAllByText(/of 26 delegations/).map((n) => n.textContent);
    expect(rows[0]).toBe("24 of 26 delegations, 200 members");
    expect(rows[1]).toBe("20 of 26 delegations, 190 members");

    // State grid: backing, tie and no-vote tiles are labelled.
    expect(screen.getByLabelText("OH: Ben Beta")).toBeTruthy();
    expect(screen.getByLabelText("WI: tied, no vote")).toBeTruthy();
    expect(screen.getByLabelText("WY: no vote")).toBeTruthy();
    expect(screen.getByText("WI*")).toBeTruthy();

    // Whips in force.
    expect(screen.getByText(/party whip: Ada Alpha, set by Pat Chair on turn 12/)).toBeTruthy();
    expect(
      screen.getByText(/coalition whip: a free vote, set by Cal Chair on turn 13/)
    ).toBeTruthy();

    // Ballot history, newest first, deadlock labelled.
    const ballots = screen.getByText("Ballots").parentElement!;
    const lines = within(ballots)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(lines[0]).toContain("Turn 12");
    expect(lines[2]).toContain("Turn 10 (deadlock)");

    // Spectators get no buttons.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lets a House member vote, change their vote and see their whip", async () => {
    const fetchFn = mockFetch(
      view({
        viewer: {
          isHouseMember: true,
          canVote: true,
          choiceId: "b",
          whip: { name: "Party Three", scope: "party", candidateId: "a" },
          canWhip: [],
        },
      })
    );
    render(<ContingentHouseVotePanel electionId="e1" />);
    const mine = await screen.findByRole("button", { name: "Your vote" });
    expect(mine.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Your party \(Party Three\)/)).toBeTruthy();
    expect(screen.getByText(/whip is Ada Alpha/)).toBeTruthy();
    expect(screen.getByText(/You are voting against it/)).toBeTruthy();
    expect(screen.getByText(/\(your whip\)/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Vote for Ada Alpha" }));
    await waitFor(() => expect(posts(fetchFn)).toHaveLength(1));
    const [url, init] = posts(fetchFn)[0];
    expect(url).toBe("/api/elections/e1/contingent-vote");
    expect(JSON.parse(init!.body as string)).toEqual({ candidateId: "a" });
    // Re-reads the board after voting.
    await waitFor(() =>
      expect(fetchFn.mock.calls.filter(([, i]) => !i?.method).length).toBeGreaterThan(1)
    );
  });

  it("does not offer a vote for a candidacy that left the race", async () => {
    mockFetch(
      view({
        candidates: [
          { id: "a", name: "Ada Alpha", delegations: 20, members: 190, dropped: false },
          { id: "b", name: "Ben Beta", delegations: 0, members: 0, dropped: true },
          { id: "c", name: "Cy Gamma", delegations: 4, members: 40, dropped: false },
        ],
        viewer: { isHouseMember: true, canVote: true, choiceId: null, whip: null, canWhip: [] },
      })
    );
    render(<ContingentHouseVotePanel electionId="e1" />);
    expect(await screen.findByText(/left the race/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Vote for Ada Alpha" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Vote for Ben Beta" })).toBeNull();
  });

  it("shows the server's reason when a vote is refused", async () => {
    mockFetch(
      view({
        viewer: { isHouseMember: true, canVote: true, choiceId: null, whip: null, canWhip: [] },
      }),
      false
    );
    render(<ContingentHouseVotePanel electionId="e1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Vote for Ada Alpha" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Closed");
  });

  it("lists members who defied their whip", async () => {
    mockFetch(
      view({
        defiances: [{ name: "Dana Defier", stateId: "OH", candidateId: "b", whipCandidateId: "a" }],
      })
    );
    render(<ContingentHouseVotePanel electionId="e1" />);
    expect(await screen.findByText("Members who defied their whip")).toBeTruthy();
    expect(screen.getByText(/votes Ben Beta, whip said Ada Alpha/)).toBeTruthy();
  });

  it("lets a party chair set, change and clear a whip", async () => {
    const fetchFn = mockFetch(
      view({
        viewer: {
          isHouseMember: false,
          canVote: false,
          choiceId: null,
          whip: null,
          canWhip: [
            { scope: "party", sequentialId: 3, name: "Party Three", current: "a" },
            { scope: "coalition", sequentialId: 7, name: "Coalition Seven", current: null },
          ],
        },
      })
    );
    render(<ContingentHouseVotePanel electionId="e1" />);
    expect(await screen.findByText("Set a whip")).toBeTruthy();
    const partyGroup = screen.getByText("Party Three", { selector: "div" }).parentElement!;
    // The current whip is pressed and cannot be re-sent.
    expect(
      within(partyGroup).getByRole("button", { name: "Ada Alpha" }).getAttribute("aria-pressed")
    ).toBe("true");

    fireEvent.click(within(partyGroup).getByRole("button", { name: "Ben Beta" }));
    await waitFor(() => expect(posts(fetchFn)).toHaveLength(1));
    expect(posts(fetchFn)[0][0]).toBe("/api/elections/e1/contingent-vote/whip");
    expect(JSON.parse(posts(fetchFn)[0][1]!.body as string)).toEqual({
      scope: "party",
      sequentialId: 3,
      candidateId: "b",
    });

    const coalitionGroup = screen.getByText("Coalition Seven", { selector: "div" }).parentElement!;
    fireEvent.click(within(coalitionGroup).getByRole("button", { name: "Free vote" }));
    await waitFor(() => expect(posts(fetchFn)).toHaveLength(2));
    expect(JSON.parse(posts(fetchFn)[1][1]!.body as string)).toEqual({
      scope: "coalition",
      sequentialId: 7,
      candidateId: "free",
    });
    fireEvent.click(within(partyGroup).getByRole("button", { name: "No whip" }));
    await waitFor(() => expect(posts(fetchFn)).toHaveLength(3));
    expect(JSON.parse(posts(fetchFn)[2][1]!.body as string).candidateId).toBe("clear");
  });

  it("states the outcome and the final ballot after a winner is elected", async () => {
    mockFetch(
      view({
        status: "closed",
        turnsLeft: 0,
        winnerId: "b",
        candidates: [
          { id: "a", name: "Ada Alpha", delegations: 20, members: null, dropped: false },
          { id: "b", name: "Ben Beta", delegations: 27, members: null, dropped: false },
          { id: "c", name: "Cy Gamma", delegations: 3, members: null, dropped: false },
        ],
        ballots: [
          { turn: 10, opening: true, totals: { a: 19, b: 22, c: 4 }, winnerId: null },
          { turn: 13, opening: false, totals: { a: 20, b: 27, c: 3 }, winnerId: "b" },
        ],
        viewer: { isHouseMember: true, canVote: false, choiceId: "a", whip: null, canWhip: [] },
      })
    );
    render(<ContingentHouseVotePanel electionId="e1" />);
    expect(
      await screen.findByText(/elected Ben Beta president with 27 state delegations/)
    ).toBeTruthy();
    expect(screen.getByText(/Alex Acting is vice president/)).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.getByText("Final delegations")).toBeTruthy();
    expect(screen.getByText(/Ben Beta wins/)).toBeTruthy();
    expect(screen.getByText(/\(elected\)/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("states the outcome when the House closes without a majority", async () => {
    mockFetch(view({ status: "closed", turnsLeft: 0, whips: [] }));
    render(<ContingentHouseVotePanel electionId="e1" />);
    expect(await screen.findByText(/closed without a majority/)).toBeTruthy();
    expect(screen.getByText(/Alex Acting continues as acting president/)).toBeTruthy();
    expect(screen.queryByText(/Whips in force/)).toBeNull();
  });

  it("refreshes while the vote is open and stops once it closes", async () => {
    vi.useFakeTimers();
    const fetchFn = mockFetch(view());
    render(<ContingentHouseVotePanel electionId="e1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const count = () => fetchFn.mock.calls.length;
    const first = count();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(count()).toBe(first + 1);

    // The next payload says the vote closed: polling stops.
    fetchFn.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ vote: view({ status: "closed", turnsLeft: 0 }) }),
    }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const afterClose = count();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(count()).toBe(afterClose);
  });
});
