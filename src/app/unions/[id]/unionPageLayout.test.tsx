/**
 * @vitest-environment happy-dom
 */
/**
 * The corp-style layout (player suggestion 374) moved every panel behind a
 * tab. Earlier page rebuilds silently dropped controls and tooltips, so this
 * pins that nothing the long-scroll page had went missing: each panel is
 * reachable from a tab, every key figure keeps its tooltip, and drives report
 * their outcome where they were run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import UnionPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: "u1" }),
}));

const PARAMS = {
  status: "fulfilled",
  value: { id: "u1" },
  then: (resolve: (value: { id: string }) => void) => resolve({ id: "u1" }),
} as unknown as Promise<{ id: string }>;

const UNION = {
  id: "u1",
  name: "Steelworkers United",
  countryId: "US",
  countryName: "United States",
  sectorType: "manufacturing",
  sectorLabel: "Manufacturing",
  ownerId: "c1",
  pendingLeaderCharacterId: null,
  electionOpen: false,
  leadershipElectionMinStrength: 100,
  strength: 120,
  organizeActionCost: 5,
  organizeStrengthGain: 10,
  treasury: 50_000,
  members: 900,
  approval: 60,
  duesPerWorkerAnnual: 100,
  activeServices: [],
  annualWage: 30_000,
  demandedWageLevel: 1.2,
  suspended: false,
  underground: null,
  currentTurn: 50,
};

function sector(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    sectorId: id,
    corporationId: `corp-${id}`,
    corporationName: name,
    stateId: "PA",
    wageLevel: 1.1,
    workers: 1000,
    wageGap: 0.1,
    unionization: 30,
    representingUnionId: "u1",
    strikeActive: false,
    strikeCooldownUntilTurn: null,
    strikeBlockReason: null,
    ...overrides,
  };
}

const SECTORS = [
  sector("s1", "Keystone Steel"),
  sector("s2", "Ohio Forge", { strikeActive: true }),
  sector("s3", "Rival Mill", { representingUnionId: "u9", representingUnionApproval: 55 }),
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/organize-sectors") && init?.method === "POST") {
      return {
        ok: true,
        json: async () => ({
          success: true,
          completed: 1,
          requested: 2,
          stopped: {
            sectorId: "s3",
            status: 402,
            error: "Not enough union treasury to run an organizing drive.",
          },
          results: [
            { sectorId: "s1", ok: true, wasRaid: false, won: true, unionization: 33 },
            { sectorId: "s3", ok: false, error: "Not enough union treasury." },
          ],
        }),
      } as Response;
    }
    if (path.endsWith("/organize-sector") && init?.method === "POST") {
      return {
        ok: true,
        json: async () => ({ success: true, wasRaid: true, won: false, unionization: 30 }),
      } as Response;
    }
    if (path.includes("/api/character/me")) {
      return {
        ok: true,
        json: async () => ({ character: { _id: "c1", actions: 10, unionLeaderOf: "u1" } }),
      } as Response;
    }
    if (path.includes("/leader/vote")) {
      return {
        ok: true,
        json: async () => ({ tallies: [], candidates: [], canVote: false, organizerCount: 1 }),
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({
        union: UNION,
        sectors: SECTORS,
        workforce: { totalWorkers: 3000, unionizedWorkers: 900, density: 0.3 },
        employerOptions: [],
        bargainingCampaigns: [],
        pensionScheme: null,
        actionableBills: [
          { billId: "b1", billTitle: "Fair Wages Act", status: "active", stance: null },
        ],
        endorsements: [],
      }),
    } as Response;
  });
  global.fetch = fetchMock as typeof fetch;
});

const tab = (name: RegExp | string) => screen.getByRole("button", { name });

describe("union page, corp-style tabs", () => {
  it("compares the loaded union approval with the rival in the sectors tab", async () => {
    render(<UnionPage params={PARAMS} />);
    await screen.findByText("Steelworkers United");
    fireEvent.click(tab(/^Sectors\s*\d+$/));
    const rival = screen.getByRole("link", { name: "Rival Mill" }).closest("tr")!;
    expect(within(rival).getByText("Rival approval: 55%")).toBeTruthy();
    expect(within(rival).getByText("This union: 60%")).toBeTruthy();
    expect(within(rival).getByText("Current edge: 5 points (needs 5)")).toBeTruthy();
    expect(within(rival).getByText("Meets current raid edge")).toBeTruthy();
  });

  it("keeps every key figure's tooltip in the masthead", async () => {
    render(<UnionPage params={PARAMS} />);
    await screen.findByText("Steelworkers United");
    for (const label of ["Members", "Approval", "Treasury", "Open campaigns", "Strength"]) {
      expect(screen.getByRole("button", { name: `What ${label} means` })).toBeTruthy();
    }
  });

  it("reaches every panel the long page had from some tab", async () => {
    render(<UnionPage params={PARAMS} />);
    await screen.findByText("Steelworkers United");

    // Overview: the open organize drive and the head's own levers.
    expect(screen.getByRole("button", { name: "Run organize drive" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set demand" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resign leadership" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Shops at a glance" })).toBeTruthy();

    fireEvent.click(tab(/^Sectors\s*\d+$/));
    expect(screen.getByRole("link", { name: "Keystone Steel" })).toBeTruthy();
    expect(screen.getByText("Striking")).toBeTruthy();

    fireEvent.click(tab("Dues & services"));
    expect(screen.getByRole("heading", { name: /dues, services & politics/i })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /set dues/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /save services/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /set political contributions/i })).toBeTruthy();

    fireEvent.click(tab(/^Bargaining/));
    expect(screen.queryByRole("button", { name: "Run organize drive" })).toBeNull();

    fireEvent.click(tab(/^Leadership/));
    expect(screen.getByRole("heading", { name: /leadership contest/i })).toBeTruthy();

    fireEvent.click(tab(/^Legislative stances/));
    expect(screen.getByRole("button", { name: "Endorse" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Oppose" })).toBeTruthy();
  });

  it("opens the Sectors tab filtered from the overview", async () => {
    render(<UnionPage params={PARAMS} />);
    await screen.findByText("Steelworkers United");
    fireEvent.click(screen.getByRole("button", { name: /1 on strike/i }));
    expect(screen.getByRole("link", { name: "Ohio Forge" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Keystone Steel" })).toBeNull();
    expect(
      (screen.getByLabelText(/filter sectors by strike status/i) as HTMLSelectElement).value
    ).toBe("striking");
  });

  it("runs ticked shops in one request and reports where it stopped", async () => {
    render(<UnionPage params={PARAMS} />);
    await screen.findByText("Steelworkers United");
    fireEvent.click(tab(/^Sectors\s*\d+$/));
    fireEvent.click(screen.getByLabelText("Select Keystone Steel in PA"));
    fireEvent.click(screen.getByLabelText("Select Rival Mill in PA"));
    fireEvent.click(
      within(screen.getByRole("region", { name: "Selected drives" })).getByRole("button", {
        name: "Run 2 drives",
      })
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/unions/u1/organize-sectors",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ sectorIds: ["s1", "s3"] }),
        })
      )
    );
    expect(
      await screen.findByText(
        /Ran 1 of 2 drives: 1 organized\. Stopped at Rival Mill \(PA\): Not enough union treasury/
      )
    ).toBeTruthy();
  });

  it("reports a lost raid under the table instead of 'Done.'", async () => {
    render(<UnionPage params={PARAMS} />);
    await screen.findByText("Steelworkers United");
    fireEvent.click(tab(/^Sectors\s*\d+$/));
    fireEvent.click(screen.getByRole("button", { name: "Raid" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/raid on Rival Mill \(PA\) failed/i);
    expect(screen.queryByText("Done.")).toBeNull();
  });
});
