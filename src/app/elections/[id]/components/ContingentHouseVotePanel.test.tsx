/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ContingentHouseVoteView } from "@/lib/elections/contingentHouseVoteView";
import { ContingentHouseVotePanel } from "./ContingentHouseVotePanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
      { id: "a", name: "Ada Alpha", delegations: 20, members: 190 },
      { id: "b", name: "Ben Beta", delegations: 24, members: 200 },
      { id: "c", name: "Cy Gamma", delegations: 4, members: 40 },
    ],
    viewer: { isHouseMember: false, canVote: false, choiceId: null },
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

describe("ContingentHouseVotePanel", () => {
  it("renders nothing when the election has no House vote", async () => {
    const fetchFn = mockFetch(null);
    const { container } = render(<ContingentHouseVotePanel electionId="e1" />);
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("shows the acting president, the window and the projected delegations", async () => {
    mockFetch(view());
    render(<ContingentHouseVotePanel electionId="e1" />);
    expect(await screen.findByText("House vote")).toBeTruthy();
    expect(screen.getByText(/Closes on turn 34 \(14 turns left\)/)).toBeTruthy();
    expect(screen.getByText(/Alex Acting is acting president/)).toBeTruthy();
    expect(screen.getByText(/24 of 26 delegations/)).toBeTruthy();
    // Ranked by delegations.
    const names = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(names[0]).toContain("Ben Beta");
    // Spectators get no vote buttons.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lets a House member vote and marks their current choice", async () => {
    const fetchFn = mockFetch(
      view({ viewer: { isHouseMember: true, canVote: true, choiceId: "a" } })
    );
    render(<ContingentHouseVotePanel electionId="e1" />);
    expect(await screen.findByRole("button", { name: "Your vote" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Your vote" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "Vote for Ben Beta" }));
    await waitFor(() => {
      const post = fetchFn.mock.calls.find(([, init]) => init?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(post![1]!.body as string)).toEqual({ candidateId: "b" });
    });
  });

  it("shows the server's reason when a vote is refused", async () => {
    mockFetch(view({ viewer: { isHouseMember: true, canVote: true, choiceId: null } }), false);
    render(<ContingentHouseVotePanel electionId="e1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Vote for Ada Alpha" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Closed");
  });

  it("states the outcome after a winner is elected", async () => {
    mockFetch(
      view({
        status: "closed",
        turnsLeft: 0,
        winnerId: "b",
        candidates: [
          { id: "a", name: "Ada Alpha", delegations: 20, members: 190 },
          { id: "b", name: "Ben Beta", delegations: 27, members: 200 },
        ],
      })
    );
    render(<ContingentHouseVotePanel electionId="e1" />);
    expect(
      await screen.findByText(/elected Ben Beta president with 27 state delegations/)
    ).toBeTruthy();
    expect(screen.getByText(/Alex Acting is vice president/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("states the outcome when the House closes without a majority", async () => {
    mockFetch(view({ status: "closed", turnsLeft: 0 }));
    render(<ContingentHouseVotePanel electionId="e1" />);
    expect(await screen.findByText(/closed without a majority/)).toBeTruthy();
    expect(screen.getByText(/Alex Acting continues as acting president/)).toBeTruthy();
  });
});
