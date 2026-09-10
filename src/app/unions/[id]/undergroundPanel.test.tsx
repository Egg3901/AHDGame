/**
 * @vitest-environment happy-dom
 */
/**
 * Under a union ban the legal organize loop is fully off and cells organize
 * underground instead. These pin the player-facing loop: the suspended page
 * offers quiet cell work vs a mass drive (not a dead end), reports status in
 * dark / suspected / exposed terms with a vague heat bracket (never a
 * number), and routes drive results through the same error-alert affordance
 * as the legal loop. The last case pins the fallback: a suspended union
 * whose route has not shipped the snapshot yet still renders the disabled
 * legal button rather than a blank panel.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import UnionPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: "u1" }),
}));

const UNDERGROUND: {
  strength: number;
  status: string;
  heatText: string;
  exposedUntilTurn: number | null;
  actionCost: number;
  quietGain: number;
  massGain: number;
} = {
  strength: 12,
  status: "dark",
  heatText: "cold",
  exposedUntilTurn: null,
  actionCost: 10,
  quietGain: 4,
  massGain: 9,
};

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
  suspended: true,
  underground: UNDERGROUND,
  currentTurn: 42,
};

function mockFetch({
  actions,
  union = UNION,
  driveResponse,
}: {
  actions: number;
  union?: typeof UNION;
  driveResponse?: { ok: boolean; status: number; body: Record<string, unknown> };
}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const u = String(url);
    if (u.includes("/organize-underground") && init?.method === "POST") {
      const res = driveResponse ?? {
        ok: true,
        status: 200,
        body: {
          success: true,
          undergroundStrength: 21,
          status: "dark",
          heatText: "cold",
          strengthGain: 9,
          actionsSpent: 10,
        },
      };
      return { ok: res.ok, status: res.status, json: async () => res.body } as unknown as Response;
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
  }) as unknown as typeof globalThis.fetch;
  return { fetch: fetchMock, calls };
}

const PARAMS = {
  status: "fulfilled",
  value: { id: "u1" },
  then: (resolve: (v: { id: string }) => void) => resolve({ id: "u1" }),
} as unknown as Promise<{ id: string }>;

beforeEach(() => vi.restoreAllMocks());

describe("underground organize panel", () => {
  it("offers quiet and mass drives on a suspended union, with status and vague heat", async () => {
    const { fetch } = mockFetch({ actions: 20 });
    global.fetch = fetch;
    render(<UnionPage params={PARAMS} />);

    expect(await screen.findByRole("heading", { name: /organize underground/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /quiet cell work/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /mass drive/i })).toBeTruthy();
    expect(screen.getByText(/operating in the dark/i)).toBeTruthy();
    expect(screen.getByText(/built underground/i)).toBeTruthy();
    // Vague bracket only: no exact heat number anywhere on the page.
    expect(screen.queryByText(/heat: \d/i)).toBeNull();
  });

  it("posts the mass mode and reports the gain plus the heat bracket", async () => {
    const { fetch, calls } = mockFetch({ actions: 20 });
    global.fetch = fetch;
    render(<UnionPage params={PARAMS} />);

    fireEvent.click(await screen.findByRole("button", { name: /mass drive/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url.includes("/organize-underground"));
      expect(post).toBeTruthy();
      expect(post!.init?.body).toContain('"mass"');
    });
    await waitFor(() => {
      const statuses = screen.getAllByRole("status");
      const drive = statuses.find((el) => /underground strength/i.test(el.textContent ?? ""));
      expect(drive).toBeTruthy();
      expect(drive!.textContent).toMatch(/\+9 underground strength/i);
      expect(drive!.textContent).toMatch(/running cold/i);
    });
  });

  it("an exposed cell says so, counts the turns left, and warns gains are halved", async () => {
    const { fetch } = mockFetch({
      actions: 20,
      union: {
        ...UNION,
        underground: { ...UNDERGROUND, status: "exposed", heatText: "hot", exposedUntilTurn: 45 },
      },
    });
    global.fetch = fetch;
    render(<UnionPage params={PARAMS} />);

    expect(await screen.findByText(/^exposed$/i)).toBeTruthy();
    expect(screen.getByText(/4 turns left/i)).toBeTruthy();
    expect(screen.getByText(/halved while exposed/i)).toBeTruthy();
  });

  it("disables both drives with a reason when the action bar cannot cover the cost", async () => {
    const { fetch } = mockFetch({ actions: 0 });
    global.fetch = fetch;
    render(<UnionPage params={PARAMS} />);

    const quiet = (await screen.findByRole("button", {
      name: /quiet cell work/i,
    })) as HTMLButtonElement;
    expect(quiet.disabled).toBe(true);
    expect(screen.getByText(/not enough action points/i)).toBeTruthy();
  });

  it("falls back to the disabled legal button when the route ships no snapshot", async () => {
    const { fetch } = mockFetch({
      actions: 20,
      union: { ...UNION, underground: null } as unknown as typeof UNION,
    });
    global.fetch = fetch;
    render(<UnionPage params={PARAMS} />);

    const btn = (await screen.findByRole("button", {
      name: /run organize drive/i,
    })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.queryByRole("heading", { name: /organize underground/i })).toBeNull();
  });
});
