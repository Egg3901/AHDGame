/**
 * @vitest-environment happy-dom
 */
/**
 * The organize drive is paid in action points, and a refusal used to render as
 * muted grey text at the bottom of the panel, indistinguishable from "the
 * button did nothing". These pin the affordances that make the refusal
 * legible: the button is disabled with a reason when the player cannot afford
 * it, and a server refusal renders as an error alert. The last case pins the
 * rank-and-file loop itself, that the button is there at all on a union that
 * already has a president.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import UnionPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: "u1" }),
}));

const UNION = {
  id: "u1",
  name: "Union of Post Office Workers",
  countryId: "UK",
  countryName: "United Kingdom",
  sectorType: "telecommunications",
  sectorLabel: "Telecommunications",
  ownerId: null as string | null,
  pendingLeaderCharacterId: null,
  electionOpen: false,
  leadershipElectionMinStrength: 100,
  strength: 40,
  organizeActionCost: 5,
  organizeStrengthGain: 10,
  treasury: 100,
  members: 340,
  approval: 55,
  duesPerWorkerAnnual: 0,
  activeServices: [] as string[],
  annualWage: 0,
  demandedWageLevel: null,
  suspended: false,
};

function mockFetch({
  actions,
  organizeStatus,
  union = UNION,
}: {
  actions: number;
  organizeStatus?: number;
  union?: typeof UNION;
}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/organize") && init?.method === "POST") {
      return {
        ok: false,
        status: organizeStatus ?? 400,
        json: async () => ({ error: "An organize drive costs 5 action points (you have 0)." }),
      } as unknown as Response;
    }
    if (u.includes("/api/character/me")) {
      return {
        ok: true,
        json: async () => ({ character: { _id: "c1", actions, unionLeaderOf: null } }),
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
      json: async () => ({ union, sectors: [], endorsements: [] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

// React's `use` reads a thenable synchronously when it is already fulfilled,
// which avoids suspending the whole tree in a test with no RSC boundary.
const PARAMS = {
  status: "fulfilled",
  value: { id: "u1" },
  then: (resolve: (v: { id: string }) => void) => resolve({ id: "u1" }),
} as unknown as Promise<{ id: string }>;

beforeEach(() => vi.restoreAllMocks());

describe("organize drive affordances", () => {
  it("disables the button and says why when the action bar is empty", async () => {
    global.fetch = mockFetch({ actions: 0 });
    render(<UnionPage params={PARAMS} />);

    const btn = await screen.findByRole("button", { name: /run organize drive/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/not enough action points/i)).toBeTruthy();
    // The player's own action count is shown next to the cost.
    expect(screen.getByText(/you have 0/i)).toBeTruthy();
  });

  it("offers the drive on a union that already has a president", async () => {
    global.fetch = mockFetch({ actions: 20, union: { ...UNION, ownerId: "someone-else" } });
    render(<UnionPage params={PARAMS} />);

    const btn = await screen.findByRole("button", { name: /run organize drive/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    // The leader-only election panel stays hidden; the rank-and-file panel does not.
    expect(screen.queryByText(/elect a president/i)).toBeNull();
  });

  it("shows the player their own banked voting power", async () => {
    global.fetch = mockFetch({ actions: 20 });
    render(<UnionPage params={PARAMS} />);

    expect(await screen.findByText(/your voting power/i)).toBeTruthy();
  });

  it("surfaces a server refusal as an error alert, not muted body text", async () => {
    global.fetch = mockFetch({ actions: 20 });
    render(<UnionPage params={PARAMS} />);

    const btn = await screen.findByRole("button", { name: /run organize drive/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/action points/i);
      expect(alert.className).toMatch(/text-error/);
    });
  });
});
