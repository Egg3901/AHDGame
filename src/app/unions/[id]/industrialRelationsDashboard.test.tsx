/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const BASE_UNION = {
  id: "u1",
  name: "Industrial Workers",
  countryId: "US",
  countryName: "United States",
  sectorType: "manufacturing",
  sectorLabel: "Manufacturing",
  ownerId: "c1",
  pendingLeaderCharacterId: null,
  electionOpen: false,
  leadershipElectionMinPressure: 25,
  treasury: 500,
  membershipPressure: 40,
  demandedWageLevel: 1.15,
  suspended: false,
  currentTurn: 10,
};

beforeEach(() => vi.restoreAllMocks());

describe("union industrial-relations dashboard", () => {
  it("retires direct strike calls but keeps the public wage claim and local readiness", async () => {
    global.fetch = vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes("/api/character/me")) {
        return {
          ok: true,
          json: async () => ({
            character: { _id: "c1", cashOnHand: 100_000, unionLeaderOf: "u1" },
          }),
        } as Response;
      }
      if (path.includes("/leader/vote")) {
        return {
          ok: true,
          json: async () => ({ tallies: [], candidates: [], canVote: false, organizerCount: 0 }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          union: BASE_UNION,
          sectors: [
            {
              sectorId: "s1",
              corporationId: "corp1",
              corporationName: "Ready Motors",
              stateId: "MI",
              wageLevel: 1.05,
              wageGap: 0.1,
              unionization: 45,
              strikeActive: false,
              strikeCooldownUntilTurn: null,
              strikeBlockReason: null,
            },
            {
              sectorId: "s2",
              corporationId: "corp2",
              corporationName: "Weak Steel",
              stateId: "PA",
              wageLevel: 1.15,
              wageGap: 0,
              unionization: 20,
              strikeActive: false,
              strikeCooldownUntilTurn: null,
              strikeBlockReason: "underorganized",
            },
          ],
          actionableBills: [],
          endorsements: [],
        }),
      } as Response;
    }) as typeof fetch;

    render(<UnionPage params={PARAMS} />);

    await screen.findByText("Industrial Workers");
    expect(screen.queryByRole("button", { name: "Call Strike" })).toBeNull();
    // The public wage claim is back as a leader control: it is the only thing
    // that can make the gap column below say anything at all.
    expect(screen.getByRole("button", { name: "Set Demand" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Withdraw Demand" })).toBeTruthy();
    expect(screen.getByText("0.10× short")).toBeTruthy();
    expect(screen.getByText("Strike ready")).toBeTruthy();
    expect(screen.getByText("Needs organizing")).toBeTruthy();
  });

  it("offers valid candidates and lets the leader take a stance on a live bill", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/endorse") && init?.method === "POST") {
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }
      if (path.includes("/api/character/me")) {
        return {
          ok: true,
          json: async () => ({
            character: { _id: "c1", cashOnHand: 100_000, unionLeaderOf: "u1" },
          }),
        } as Response;
      }
      if (path.includes("/leader/vote")) {
        return {
          ok: true,
          json: async () => ({
            tallies: [],
            candidates: [
              {
                characterId: "c2",
                name: "Alex Organizer",
                sequentialId: 42,
                avatarUrl: null,
              },
            ],
            canVote: true,
            organizerCount: 1,
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          union: {
            ...BASE_UNION,
            ownerId: null,
            electionOpen: true,
          },
          sectors: [],
          actionableBills: [
            { billId: "b1", billTitle: "Fair Bargaining Act", status: "active", stance: null },
          ],
          endorsements: [],
        }),
      } as Response;
    });
    global.fetch = fetchMock as typeof fetch;

    render(<UnionPage params={PARAMS} />);

    fireEvent.click(await screen.findByRole("button", { name: /^Leadership/i }));
    const candidateSelect = await screen.findByRole("combobox", { name: /candidate/i });
    expect(candidateSelect.textContent).toMatch(/Alex Organizer #42/);
    expect(screen.queryByPlaceholderText(/paste character id/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Legislative Stances/i }));
    const endorseButton = await screen.findByRole("button", { name: "Endorse" });
    fireEvent.click(endorseButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/unions/u1/endorse",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ billId: "b1", stance: "endorse" }),
        })
      );
    });
  });

  it("opens an employer-scoped bargaining campaign with explicit wage and peace terms", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/bargaining") && init?.method === "POST") {
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }
      if (path.includes("/api/character/me")) {
        return {
          ok: true,
          json: async () => ({
            character: { _id: "c1", cashOnHand: 100_000, unionLeaderOf: "u1" },
          }),
        } as Response;
      }
      if (path.includes("/leader/vote")) {
        return {
          ok: true,
          json: async () => ({ tallies: [], candidates: [], canVote: false, organizerCount: 0 }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          union: BASE_UNION,
          sectors: [],
          employerOptions: [
            {
              corporationId: "507f1f77bcf86cd799439011",
              corporationName: "Acme Manufacturing",
              localCount: 2,
              averageWageLevel: 1,
              averageUnionization: 55,
              openCampaignId: null,
              agreementExpiresAtTurn: null,
            },
          ],
          bargainingCampaigns: [],
          actionableBills: [],
          endorsements: [],
        }),
      } as Response;
    });
    global.fetch = fetchMock as typeof fetch;

    render(<UnionPage params={PARAMS} />);

    fireEvent.click(await screen.findByRole("button", { name: /bargaining/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Open campaign" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/unions/u1/bargaining",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            employerCorporationId: "507f1f77bcf86cd799439011",
            wageLevel: 1.1,
            agreementDurationTurns: 48,
            noStrikeTurns: 24,
            // A8: a campaign opened without touching the pension field asks for
            // nothing, and asking for nothing is sent explicitly rather than
            // omitted, so the employer sees a term that was on the table.
            pensionContributionRate: 0,
          }),
        })
      );
    });
  });

  it("says the union is suspended and disables its actions under a union ban", async () => {
    global.fetch = vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes("/api/character/me")) {
        return {
          ok: true,
          json: async () => ({
            character: { _id: "c1", cashOnHand: 100_000, actions: 20, unionLeaderOf: "u1" },
          }),
        } as Response;
      }
      if (path.includes("/leader/vote")) {
        return {
          ok: true,
          json: async () => ({ tallies: [], candidates: [], canVote: false, organizerCount: 0 }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          union: { ...BASE_UNION, treasury: 100_000, suspended: true },
          sectors: [],
          actionableBills: [],
          endorsements: [],
        }),
      } as Response;
    }) as typeof fetch;

    render(<UnionPage params={PARAMS} />);

    await screen.findByText(/Unions are banned under current law in United States/);
    expect(
      (screen.getByRole("button", { name: "Run Organize Drive" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Run Recruitment Drive" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect((screen.getByRole("button", { name: "Set Demand" }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it("publishes a public wage claim and shows a benefit cut on the pension scheme", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/demand-wage") && init?.method === "POST") {
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }
      if (path.includes("/api/character/me")) {
        return {
          ok: true,
          json: async () => ({
            character: { _id: "c1", cashOnHand: 100_000, unionLeaderOf: "u1" },
          }),
        } as Response;
      }
      if (path.includes("/leader/vote")) {
        return {
          ok: true,
          json: async () => ({ tallies: [], candidates: [], canVote: false, organizerCount: 0 }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          union: { ...BASE_UNION, demandedWageLevel: null },
          sectors: [],
          pensionScheme: {
            assetsAnchor: 1000,
            investedValueAnchor: 500,
            totalAssetsAnchor: 1500,
            liabilitiesAnchor: 10_000,
            benefitsInPaymentAnchor: 800,
            totalContributionsAnchor: 4000,
            totalTopUpsAnchor: 200,
            totalInvestedAnchor: 600,
            totalBenefitsPaidAnchor: 2400,
            totalBenefitsUnpaidAnchor: 900,
            lastBenefitCutFraction: 0.3,
            fundingRatio: 0.15,
            band: "critical",
            explanation: "This scheme cannot cover what it owes.",
          },
          employerOptions: [],
          bargainingCampaigns: [],
          actionableBills: [],
          endorsements: [],
        }),
      } as Response;
    });
    global.fetch = fetchMock as typeof fetch;

    render(<UnionPage params={PARAMS} />);

    await screen.findByText("This union has no standing wage claim.");
    fireEvent.change(screen.getByPlaceholderText("1.15"), { target: { value: "1.2" } });
    fireEvent.click(screen.getByRole("button", { name: "Set Demand" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/unions/u1/demand-wage",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ demandedWageLevel: 1.2 }),
        })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /bargaining/i }));
    expect(screen.getByText(/Benefits were cut 30%/)).toBeTruthy();
    expect(screen.getByText("₳900 in arrears")).toBeTruthy();
  });
});
