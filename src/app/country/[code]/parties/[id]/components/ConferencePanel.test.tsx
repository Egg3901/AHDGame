/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConferencePanel } from "./ConferencePanel";

interface FetchCall {
  url: string;
  init: RequestInit;
}

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    conferenceId: "UK:2:1",
    year: 1,
    status: "open",
    partyName: "Conservative Party",
    isNpp: false,
    opensAtTurn: 100,
    votingClosesTurn: 120,
    turnsUntilOpen: 0,
    turnsUntilClose: 20,
    proposal: null,
    motions: [],
    platform: null,
    ratified: false,
    outcome: null,
    payoff: { due: false, appliedTurn: null },
    catalog: [
      { id: "pledge-a", label: "Pledge A", blurb: "First pledge" },
      { id: "pledge-b", label: "Pledge B", blurb: "Second pledge" },
      { id: "pledge-c", label: "Pledge C", blurb: "Third pledge" },
    ],
    capabilities: {
      isPartyMember: true,
      isCommitteeMember: true,
      isLeader: false,
      canPropose: true,
      canVote: true,
    },
    history: [],
    ...overrides,
  };
}

function makeProposal(overrides: Record<string, unknown> = {}) {
  return {
    pledgeIds: ["pledge-a", "pledge-b"],
    proposedByName: "Leader Lex",
    proposedAtTurn: 101,
    votesFor: 3,
    votesAgainst: 1,
    status: "voting",
    resolvedAtTurn: null,
    quorumNeeded: 2,
    eligibleVoters: 10,
    ...overrides,
  };
}

function makeMotion(overrides: Record<string, unknown> = {}) {
  return {
    motionId: "motion-1",
    patch: { triggerThresholdPct: 0.2 },
    proposedByName: "MP One",
    createdAtTurn: 102,
    votesFor: 1,
    votesAgainst: 0,
    status: "voting",
    voidReason: null,
    resolvedAtTurn: null,
    quorumNeeded: 2,
    eligibleVoters: 5,
    ...overrides,
  };
}

function stubGetThenOk(state: unknown) {
  const calls: FetchCall[] = [];
  const handler = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if ((init.method ?? "GET").toUpperCase() === "GET") {
      return { ok: true, json: async () => state };
    }
    return { ok: true, json: async () => ({ success: true }) };
  });
  vi.stubGlobal("fetch", handler);
  return { calls, handler };
}

function renderPanel() {
  render(<ConferencePanel countryCode="UK" partyId="2" />);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConferencePanel loading and error", () => {
  it("shows a loading skeleton while the state loads", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined))
    );
    renderPanel();
    const loader = screen.getByLabelText("Loading conference");
    expect(loader.getAttribute("aria-busy")).toBe("true");
  });

  it("shows the load error with a working retry", async () => {
    const state = makeState();
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) {
          return { ok: false, json: async () => ({ error: "Party not found" }) };
        }
        return { ok: true, json: async () => state };
      })
    );
    renderPanel();
    expect(await screen.findByText("Party not found")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/Conservative Party conference 1: Open/)).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it("surfaces a network failure on the initial load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      })
    );
    renderPanel();
    expect(await screen.findByText("Network error loading conference state")).toBeTruthy();
  });
});

describe("ConferencePanel status and deadlines", () => {
  it("renders the scheduled window with opening and closing turns", async () => {
    stubGetThenOk(makeState({ status: "scheduled", turnsUntilOpen: 5, turnsUntilClose: 25 }));
    renderPanel();
    expect(await screen.findByText(/Conservative Party conference 1: Scheduled/)).toBeTruthy();
    expect(
      screen.getByText(/Opens in 5 turn\(s\) \(turn 100\); voting closes turn 120/)
    ).toBeTruthy();
  });

  it("renders the open window with turns remaining", async () => {
    stubGetThenOk(makeState({ status: "open", turnsUntilClose: 20 }));
    renderPanel();
    expect(await screen.findByText(/conference 1: Open/)).toBeTruthy();
    expect(screen.getByText(/Voting closes in 20 turn\(s\) \(turn 120\)/)).toBeTruthy();
  });

  it("renders the completed ratified outcome with the applied payoff", async () => {
    stubGetThenOk(
      makeState({
        status: "completed",
        outcome: "ratified",
        ratified: true,
        payoff: { due: true, appliedTurn: 125 },
        platform: { pledgeIds: ["pledge-a"], ratifiedYear: 1, ratifiedAtTurn: 120 },
      })
    );
    renderPanel();
    expect(await screen.findByText(/Completed: the platform was ratified/)).toBeTruthy();
    expect(screen.getByText(/and the payoff applied/)).toBeTruthy();
    expect(screen.getByText("Standing platform")).toBeTruthy();
    expect(screen.getByText(/Ratified at the 1 conference \(turn 120\)/)).toBeTruthy();
  });

  it("renders a completed conference with no ratification and no payoff", async () => {
    stubGetThenOk(makeState({ status: "completed", outcome: "closedWithoutRatification" }));
    renderPanel();
    expect(
      await screen.findByText("Completed without ratifying a platform: no payoff.")
    ).toBeTruthy();
  });

  it("renders an expired conference that missed its window", async () => {
    stubGetThenOk(makeState({ status: "expired", outcome: "missed" }));
    renderPanel();
    expect(
      await screen.findByText("This conference missed its window and expired with no platform.")
    ).toBeTruthy();
  });

  it("tells non-members their actions are disabled", async () => {
    stubGetThenOk(
      makeState({
        capabilities: {
          isPartyMember: false,
          isCommitteeMember: false,
          isLeader: false,
          canPropose: false,
          canVote: false,
        },
      })
    );
    renderPanel();
    expect(
      await screen.findByText(
        "You are not a member of this party: conference actions are disabled."
      )
    ).toBeTruthy();
  });

  it("renders history entries and the empty-history notice", async () => {
    stubGetThenOk(
      makeState({
        history: [
          { turn: 100, at: "2026-09-17T00:00:00Z", kind: "opened", detail: "opened today" },
        ],
      })
    );
    renderPanel();
    expect(await screen.findByText(/Turn 100 \(opened\): opened today/)).toBeTruthy();
  });

  it("renders the empty-history notice when there are no events", async () => {
    stubGetThenOk(makeState());
    renderPanel();
    expect(await screen.findByText("No conference events yet.")).toBeTruthy();
  });
});

describe("ConferencePanel platform proposal and voting", () => {
  it("proposes a platform, shows success, and refreshes", async () => {
    const { calls } = stubGetThenOk(makeState());
    renderPanel();
    expect(await screen.findByText("No platform proposed yet.")).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Pledge A/));
    fireEvent.click(screen.getByLabelText(/Pledge B/));
    fireEvent.click(screen.getByRole("button", { name: "Propose platform" }));

    await waitFor(() => expect(screen.getByText("Platform proposed.")).toBeTruthy());
    const post = calls.find((c) => c.url.endsWith("/platform"));
    expect(post?.init.method).toBe("POST");
    expect(JSON.parse(post?.init.body as string)).toEqual({ pledgeIds: ["pledge-a", "pledge-b"] });
    // Initial load plus the post-action refresh.
    expect(calls.filter((c) => (c.init.method ?? "GET") === "GET")).toHaveLength(2);
  });

  it("offers to replace an existing proposal and resets the vote note", async () => {
    stubGetThenOk(makeState({ proposal: makeProposal() }));
    renderPanel();
    expect(await screen.findByText(/Replace the proposal/)).toBeTruthy();
    expect(screen.getByText(/replacing resets the vote/)).toBeTruthy();
    expect(screen.getByText(/Proposed by Leader Lex \(turn 101\): voting/)).toBeTruthy();
    expect(screen.getByText(/3 ratify, 1 reject \(quorum 2 of 10 members\)/)).toBeTruthy();
  });

  it("records ratify and reject votes with success feedback", async () => {
    const { calls } = stubGetThenOk(makeState({ proposal: makeProposal() }));
    renderPanel();
    expect(await screen.findByRole("button", { name: "Ratify" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ratify" }));
    await waitFor(() => expect(screen.getByText("Ratify vote recorded.")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(screen.getByText("Reject vote recorded.")).toBeTruthy());

    const votes = calls.filter((c) => c.url.endsWith("/platform/vote"));
    expect(votes).toHaveLength(2);
    expect(JSON.parse(votes[0].init.body as string)).toEqual({ vote: "aye" });
    expect(JSON.parse(votes[1].init.body as string)).toEqual({ vote: "nay" });
  });

  it("disables platform voting for viewers who cannot vote", async () => {
    stubGetThenOk(
      makeState({
        proposal: makeProposal(),
        capabilities: {
          isPartyMember: false,
          isCommitteeMember: false,
          isLeader: false,
          canPropose: false,
          canVote: false,
        },
      })
    );
    renderPanel();
    const ratify = await screen.findByRole("button", { name: "Ratify" });
    const reject = screen.getByRole("button", { name: "Reject" });
    expect((ratify as HTMLButtonElement).disabled).toBe(true);
    expect((reject as HTMLButtonElement).disabled).toBe(true);
    expect(ratify.getAttribute("title")).toBe("Party members only");
  });

  it("disables the propose form for viewers who cannot propose", async () => {
    stubGetThenOk(
      makeState({
        capabilities: {
          isPartyMember: true,
          isCommitteeMember: false,
          isLeader: false,
          canPropose: false,
          canVote: true,
        },
      })
    );
    renderPanel();
    const propose = await screen.findByRole("button", { name: "Propose platform" });
    expect((propose as HTMLButtonElement).disabled).toBe(true);
    expect(propose.getAttribute("title")).toBe("Leader or committee only");
  });
});

describe("ConferencePanel committee motions", () => {
  it("renders the empty-motions notice", async () => {
    stubGetThenOk(makeState());
    renderPanel();
    expect(await screen.findByText("No motions at this conference.")).toBeTruthy();
  });

  it("votes for and against a committee motion", async () => {
    const { calls } = stubGetThenOk(makeState({ motions: [makeMotion()] }));
    renderPanel();
    expect(await screen.findByText(/triggerThresholdPct = 0.2/)).toBeTruthy();
    expect(screen.getByText(/1 for, 0 against \(quorum 2 of 5 committee\)/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "For" }));
    await waitFor(() => expect(screen.getByText("Motion vote recorded.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Against" }));
    await waitFor(() => expect(screen.getByText("Motion vote recorded.")).toBeTruthy());

    const votes = calls.filter((c) => c.url.endsWith("/motions/vote"));
    expect(votes).toHaveLength(2);
    expect(JSON.parse(votes[0].init.body as string)).toEqual({
      motionId: "motion-1",
      vote: "aye",
    });
    expect(JSON.parse(votes[1].init.body as string)).toEqual({
      motionId: "motion-1",
      vote: "nay",
    });
  });

  it("shows resolved and voided motions without vote buttons", async () => {
    stubGetThenOk(
      makeState({
        motions: [
          makeMotion({ motionId: "m-pass", status: "passed" }),
          makeMotion({
            motionId: "m-void",
            status: "void",
            voidReason: "Superseded by a newer amendment",
          }),
        ],
      })
    );
    renderPanel();
    expect(await screen.findByText(/Superseded by a newer amendment/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "For" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Against" })).toBeNull();
  });

  it("disables motion voting for non-committee members", async () => {
    stubGetThenOk(
      makeState({
        motions: [makeMotion()],
        capabilities: {
          isPartyMember: true,
          isCommitteeMember: false,
          isLeader: false,
          canPropose: false,
          canVote: true,
        },
      })
    );
    renderPanel();
    const forButton = await screen.findByRole("button", { name: "For" });
    expect((forButton as HTMLButtonElement).disabled).toBe(true);
    expect(forButton.getAttribute("title")).toBe("Committee only");
  });
});

describe("ConferencePanel NPP conferences", () => {
  it("explains AI-run conferences and disables player actions", async () => {
    stubGetThenOk(makeState({ isNpp: true }));
    renderPanel();
    expect(
      await screen.findByText(/AI-run: its committee tables and acclaims the standing platform/)
    ).toBeTruthy();
    // The propose form is player-only.
    expect(screen.queryByRole("button", { name: "Propose platform" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ratify" })).toBeNull();
  });
});

describe("ConferencePanel action failures and live feedback", () => {
  it("announces success in the polite live status region", async () => {
    stubGetThenOk(makeState({ proposal: makeProposal() }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Ratify" }));
    const status = await screen.findByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    await waitFor(() => expect(status.textContent).toBe("Ratify vote recorded."));
  });

  it("surfaces server action errors in the live status region", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if ((init.method ?? "GET").toUpperCase() === "GET") {
          return { ok: true, json: async () => makeState({ proposal: makeProposal() }) };
        }
        return { ok: false, json: async () => ({ error: "Already voted" }) };
      })
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Ratify" }));
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status.textContent).toBe("Error: Already voted"));
  });

  it("surfaces conflict responses without refreshing state", async () => {
    const gets: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if ((init.method ?? "GET").toUpperCase() === "GET") {
          gets.push(url);
          return { ok: true, json: async () => makeState({ proposal: makeProposal() }) };
        }
        return { ok: false, json: async () => ({ error: "Version conflict: reload" }) };
      })
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Error: Version conflict: reload")
    );
    // The failed action does not trigger a refresh.
    expect(gets).toHaveLength(1);
  });

  it("surfaces forbidden responses for disallowed voters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if ((init.method ?? "GET").toUpperCase() === "GET") {
          return { ok: true, json: async () => makeState({ proposal: makeProposal() }) };
        }
        return { ok: false, json: async () => ({ error: "Forbidden: members only" }) };
      })
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Ratify" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Error: Forbidden: members only")
    );
  });

  it("surfaces network failures on actions as errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit = {}) => {
        if ((init.method ?? "GET").toUpperCase() === "GET") {
          return { ok: true, json: async () => makeState() };
        }
        throw new Error("boom");
      })
    );
    renderPanel();
    expect(await screen.findByText("No platform proposed yet.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Pledge A/));
    fireEvent.click(screen.getByRole("button", { name: "Propose platform" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Error: network error")
    );
  });
});
