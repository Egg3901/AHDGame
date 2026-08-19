/**
 * @vitest-environment happy-dom
 */
/**
 * Dues and services are the union head's two levers over the treasury and
 * approval. Everyone can see the current rate and slate; only the head gets
 * the slider and the toggles. These pin that gate: a rank-and-file member
 * (or a signed-out visitor) must never see a control that would let them
 * spend the treasury or move the union's approval.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import UnionPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: "u1" }),
}));

const UNION = {
  id: "u1",
  name: "United Dockworkers",
  countryId: "US",
  countryName: "United States",
  sectorType: "logistics",
  sectorLabel: "Logistics",
  ownerId: "leader-1" as string | null,
  pendingLeaderCharacterId: null,
  electionOpen: false,
  leadershipElectionMinStrength: 100,
  strength: 40,
  organizeActionCost: 5,
  organizeStrengthGain: 10,
  treasury: 5000,
  members: 1200,
  approval: 62,
  duesPerWorkerAnnual: 200,
  activeServices: ["healthFund"],
  annualWage: 10000,
  demandedWageLevel: null,
  suspended: false,
};

const PARAMS = {
  status: "fulfilled",
  value: { id: "u1" },
  then: (resolve: (v: { id: string }) => void) => resolve({ id: "u1" }),
} as unknown as Promise<{ id: string }>;

function mockFetch(myCharacterId: string, unionLeaderOf: string | null) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/character/me")) {
      return {
        ok: true,
        json: async () => ({ character: { _id: myCharacterId, actions: 20, unionLeaderOf } }),
      } as unknown as Response;
    }
    if (u.includes("/leader/vote")) {
      return {
        ok: true,
        json: async () => ({
          tallies: [],
          myVote: null,
          canVote: false,
          organizerCount: 0,
          myVotingPower: 0,
        }),
      } as unknown as Response;
    }
    return {
      ok: true,
      json: async () => ({ union: UNION, sectors: [], endorsements: [] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => vi.restoreAllMocks());

describe("dues and services controls, head-only gating", () => {
  it("shows a read-only summary, not the controls, to a member who is not the head", async () => {
    global.fetch = mockFetch("someone-else", null);
    render(<UnionPage params={PARAMS} />);

    await waitFor(() => expect(screen.getByText("United Dockworkers")).toBeTruthy());

    // Read-only dues line, no slider and no save button.
    // The figure carries a currency suffix and spans nested text nodes, so
    // match on the paragraph's whole text content.
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === "P" && /members pay \$?200\b.*a year each/i.test(el.textContent ?? "")
      )
    ).toBeTruthy();
    expect(screen.queryByRole("slider", { name: /percent of member wages/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /set dues/i })).toBeNull();

    // Read-only services list, no toggle switches and no save button.
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: /save services/i })).toBeNull();
    expect(screen.queryByRole("slider", { name: /percent of remaining budget/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /set political contributions/i })).toBeNull();
  });

  it("gives the union head the dues slider and the service toggles", async () => {
    global.fetch = mockFetch("leader-1", "u1");
    render(<UnionPage params={PARAMS} />);

    await waitFor(() => expect(screen.getByText("United Dockworkers")).toBeTruthy());

    expect(await screen.findByRole("slider", { name: /percent of member wages/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /set dues/i })).toBeTruthy();

    const switches = screen.getAllByRole("switch");
    expect(switches.length).toBe(4);
    expect(screen.getByRole("button", { name: /save services/i })).toBeTruthy();
    expect(screen.getByRole("slider", { name: /percent of remaining budget/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /set political contributions/i })).toBeTruthy();
  });
});
