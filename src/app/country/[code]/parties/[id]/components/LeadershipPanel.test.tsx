/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LeadershipPanel } from "./LeadershipPanel";

interface FetchCall {
  url: string;
  init: RequestInit;
}

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    partyName: "Conservative Party",
    family: "con",
    committeeName: "1922 Committee",
    ruleset: {
      triggerThresholdPct: 0.15,
      electorate: "mps",
      removalMajorityPct: 0.5,
      survivalImmunityTurns: 48,
    },
    leader: { characterId: "leader1", name: "Leader Lex" },
    committee: {
      members: [
        { characterId: "mp1", name: "MP One", role: "chair", faction: null },
        { characterId: "mp2", name: "MP Two", role: "member", faction: "right" },
      ],
      control: { totalSeats: 2, leadingFaction: "right", leadingSeats: 1, majorityHeld: false },
    },
    immunity: { protected: false, turnsRemaining: 0 },
    amendment: { canAmendNow: true, turnsUntilAmendable: 0 },
    activeChallenge: null,
    capabilities: {
      isPartyMember: true,
      isCommitteeMember: true,
      isPartyMp: true,
      canInitiate: true,
    },
    history: [],
    ...overrides,
  };
}

function stubFetch(state: unknown, extra: Record<string, unknown> = {}) {
  const calls: FetchCall[] = [];
  const handler = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const method = (init.method ?? "GET").toUpperCase();
    if (method === "GET") {
      return { ok: true, json: async () => state };
    }
    return { ok: true, json: async () => ({ success: true, ...extra }) };
  });
  vi.stubGlobal("fetch", handler);
  return { calls, handler };
}

function renderPanel() {
  render(<LeadershipPanel countryCode="UK" partyId="2" />);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LeadershipPanel", () => {
  it("shows a loading skeleton while the state loads", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined))
    );
    renderPanel();
    const loader = screen.getByLabelText("Loading leadership");
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
    expect(await screen.findByText(/1922 Committee: Leader Lex/)).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it("renders the leader, committee, ruleset and immunity notice", async () => {
    stubFetch(makeState({ immunity: { protected: true, turnsRemaining: 12 } }));
    renderPanel();
    expect(await screen.findByText(/1922 Committee: Leader Lex/)).toBeTruthy();
    expect(screen.getByText(/immune for 12 more turn/)).toBeTruthy();
    expect(screen.getByText("15% of MPs")).toBeTruthy();
    // Ballot electorate readout plus the amendment-form option.
    expect(screen.getAllByText("MPs")).toHaveLength(2);
    expect(screen.getByText("MP One")).toBeTruthy();
    expect(screen.getByText("MP Two")).toBeTruthy();
  });

  it("hides the amendment form from non-committee members", async () => {
    stubFetch(
      makeState({
        capabilities: {
          isPartyMember: true,
          isCommitteeMember: false,
          isPartyMp: true,
          canInitiate: true,
        },
      })
    );
    renderPanel();
    expect(await screen.findByText(/1922 Committee: Leader Lex/)).toBeTruthy();
    expect(screen.queryByText("Amend removal rules")).toBeNull();
  });

  it("submits a rules amendment, shows success, and refreshes", async () => {
    const { calls } = stubFetch(makeState());
    renderPanel();
    expect(await screen.findByText("Amend removal rules")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("0.15"), { target: { value: "0.2" } });
    fireEvent.click(screen.getByRole("button", { name: "Amend rules" }));

    await waitFor(() => expect(screen.getByText("Rules amended.")).toBeTruthy());
    const patch = calls.find((c) => c.url.endsWith("/ruleset"));
    expect(patch?.init.method).toBe("PATCH");
    expect(JSON.parse(patch?.init.body as string)).toEqual({ triggerThresholdPct: 0.2 });
    // Initial load plus the post-action refresh.
    expect(calls.filter((c) => (c.init.method ?? "GET") === "GET")).toHaveLength(2);
  });

  it("disables amendment during the cooldown with an explanatory title", async () => {
    stubFetch(makeState({ amendment: { canAmendNow: false, turnsUntilAmendable: 20 } }));
    renderPanel();
    expect(await screen.findByText(/available again in 20 turn/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "Amend rules" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toMatch(/Cooling down/);
  });

  it("files a challenge, shows success, and refreshes", async () => {
    const { calls } = stubFetch(makeState());
    renderPanel();
    const button = await screen.findByRole("button", { name: "Challenge the leader" });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText("Challenge filed.")).toBeTruthy());
    const post = calls.find((c) => c.url.endsWith("/challenge"));
    expect(post?.init.method).toBe("POST");
  });

  it("disables the challenge button for non-MPs with an explanatory title", async () => {
    stubFetch(
      makeState({
        capabilities: {
          isPartyMember: true,
          isCommitteeMember: false,
          isPartyMp: false,
          canInitiate: false,
        },
      })
    );
    renderPanel();
    const button = await screen.findByRole("button", { name: "Challenge the leader" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toMatch(/Only a sitting MP/);
  });

  it("backs and withdraws a gathering challenge", async () => {
    const { calls } = stubFetch(
      makeState({
        activeChallenge: {
          challengeId: "abc123",
          status: "gathering",
          targetName: "Leader Lex",
          backers: [{ characterId: "mp1", characterName: "MP One" }],
          backersNeeded: 2,
          totalMps: 10,
          ballot: null,
        },
      })
    );
    renderPanel();
    expect(await screen.findByText(/2 more to force a ballot/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back the challenge" }));
    await waitFor(() => expect(screen.getByText("Letter added.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Withdraw backing" }));
    await waitFor(() => expect(screen.getByText("Backing withdrawn.")).toBeTruthy());

    const backs = calls.filter((c) => c.url.endsWith("/challenge/back"));
    expect(backs).toHaveLength(2);
    expect(JSON.parse(backs[0].init.body as string)).toEqual({ back: true });
    expect(JSON.parse(backs[1].init.body as string)).toEqual({ back: false });
  });

  it("votes in a ballot and disables voting for non-members", async () => {
    const { calls } = stubFetch(
      makeState({
        activeChallenge: {
          challengeId: "abc123",
          status: "ballot",
          targetName: "Leader Lex",
          backers: [{ characterId: "mp1", characterName: "MP One" }],
          backersNeeded: 0,
          totalMps: 10,
          ballot: {
            electorate: "mps",
            votesFor: 3,
            votesAgainst: 1,
            closesOnTurn: 124,
            turnsRemaining: 20,
          },
        },
      })
    );
    renderPanel();
    expect(await screen.findByText(/3 remove \/ 1 retain/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByText("Voted to remove.")).toBeTruthy());
    const vote = calls.find((c) => c.url.endsWith("/ballot/vote"));
    expect(JSON.parse(vote?.init.body as string)).toEqual({ challengeId: "abc123", vote: "aye" });
  });

  it("disables ballot voting for viewers outside the party", async () => {
    stubFetch(
      makeState({
        capabilities: {
          isPartyMember: false,
          isCommitteeMember: false,
          isPartyMp: false,
          canInitiate: false,
        },
        activeChallenge: {
          challengeId: "abc123",
          status: "ballot",
          targetName: "Leader Lex",
          backers: [],
          backersNeeded: 0,
          totalMps: 10,
          ballot: {
            electorate: "mps",
            votesFor: 0,
            votesAgainst: 0,
            closesOnTurn: 124,
            turnsRemaining: 20,
          },
        },
      })
    );
    renderPanel();
    const remove = await screen.findByRole("button", { name: "Remove" });
    const retain = screen.getByRole("button", { name: "Retain" });
    expect((remove as HTMLButtonElement).disabled).toBe(true);
    expect((retain as HTMLButtonElement).disabled).toBe(true);
    expect(remove.getAttribute("title")).toMatch(/Only party members vote/);
  });

  it("surfaces server action errors in the live status region", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if ((init.method ?? "GET").toUpperCase() === "GET") {
          return { ok: true, json: async () => makeState() };
        }
        return {
          ok: false,
          json: async () => ({ error: "A leadership challenge is already in progress" }),
        };
      })
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Challenge the leader" }));
    const status = await screen.findByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    await waitFor(() => expect(status.textContent).toMatch(/already in progress/));
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
    fireEvent.click(await screen.findByRole("button", { name: "Challenge the leader" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/network error/));
  });
});
