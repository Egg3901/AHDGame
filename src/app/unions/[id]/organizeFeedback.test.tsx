/**
 * @vitest-environment happy-dom
 */
/**
 * The organize drive is paid from the player's own wallet, and a refusal used
 * to render as muted grey text at the bottom of the panel — indistinguishable
 * from "the button did nothing". These pin the two affordances that make the
 * refusal legible: the button is disabled with a reason when the player cannot
 * afford it, and a server refusal renders as an error alert.
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
  ownerId: null,
  pendingLeaderCharacterId: null,
  electionOpen: false,
  leadershipElectionMinPressure: 25,
  treasury: 100,
  membershipPressure: 20,
  demandedWageLevel: null,
  lastCalledStrikeTurn: null,
};

function mockFetch({
  cashOnHand,
  organizeStatus,
}: {
  cashOnHand: number;
  organizeStatus?: number;
}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/organize") && init?.method === "POST") {
      return {
        ok: false,
        status: organizeStatus ?? 402,
        json: async () => ({ error: "Not enough personal funds to run an organize drive." }),
      } as unknown as Response;
    }
    if (u.includes("/api/character/me")) {
      return {
        ok: true,
        json: async () => ({ character: { _id: "c1", cashOnHand, unionLeaderOf: null } }),
      } as unknown as Response;
    }
    if (u.includes("/leader/vote")) {
      return {
        ok: true,
        json: async () => ({ tallies: [], myVote: null, canVote: false, organizerCount: 0 }),
      } as unknown as Response;
    }
    return {
      ok: true,
      json: async () => ({ union: UNION, sectors: [], endorsements: [] }),
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
  it("disables the button and says why when the wallet is empty", async () => {
    global.fetch = mockFetch({ cashOnHand: 0 });
    render(<UnionPage params={PARAMS} />);

    const btn = await screen.findByRole("button", { name: /fund organize drive/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/not enough personal funds/i)).toBeTruthy();
    // The player's own balance is shown next to the cost.
    expect(screen.getByText(/you have 0/i)).toBeTruthy();
  });

  it("surfaces a server refusal as an error alert, not muted body text", async () => {
    global.fetch = mockFetch({ cashOnHand: 1_000_000 });
    render(<UnionPage params={PARAMS} />);

    const btn = await screen.findByRole("button", { name: /fund organize drive/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);

    await waitFor(() => {
      const alert = screen.getByRole("status");
      expect(alert.textContent).toMatch(/not enough personal funds/i);
      expect(alert.className).toMatch(/text-error/);
    });
  });
});
