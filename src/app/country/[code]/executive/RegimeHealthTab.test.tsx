/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RegimeHealthTab } from "./RegimeHealthTab";

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
): void {
  global.fetch = vi
    .fn()
    .mockImplementation((url, init) => handler(String(url), init)) as unknown as typeof fetch;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const leaderPayload: Record<string, unknown> = {
  countryId: "CN",
  currentTurn: 500,
  governmentType: "onePartyState",
  scalars: {
    popularLegitimacy: 55.5,
    popularBand: "discontent",
    partyConfidence: 60.0,
    confidenceBand: "watchful",
  },
  history: { popularLegitimacy: [], partyConfidence: [] },
  stage: "discontent",
  dwellCounters: {
    stage1: 8,
    stage2: { sustained: 0, cumulativeIn168: 0 },
    stage3: 0,
    stage4: 0,
  },
  activeDecision: null,
  convention: null,
  conventionInProgress: false,
  conversionPendingAtTurn: null,
  stage4Delay: null,
  transitionHistory: [],
  reformAvailability: {
    legalizeParty: { available: true, note: "Per-party cooldown" },
    reduceVoteMultipliers: { available: true },
    holdHonestByElection: { available: true },
    anticorruptionPurge: { available: true },
    constitutionalAmendment: { available: true },
  },
  pendingReformDiscount: null,
  pendingHonestByElection: null,
  pendingPostConversionElection: null,
  bannedParties: [],
};

describe("RegimeHealthTab", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders forbidden state when leader API returns 403", async () => {
    mockFetch(() => jsonResponse({ error: "Forbidden" }, 403));
    render(<RegimeHealthTab countryCode="CN" />);
    await waitFor(() => {
      expect(screen.getByTestId("regime-health-forbidden")).toBeTruthy();
    });
  });

  it("renders raw scalars as numbers when leader", async () => {
    mockFetch(() => jsonResponse(leaderPayload));
    render(<RegimeHealthTab countryCode="CN" />);
    await waitFor(() => {
      expect(screen.getByTestId("regime-scalars").textContent).toMatch(/55\.5/);
    });
    expect(screen.getByTestId("regime-scalars").textContent).toMatch(/60\.0/);
  });

  it("shows 'no longer a one-party state' message when governmentType has flipped", async () => {
    mockFetch(() => jsonResponse({ ...leaderPayload, governmentType: "parliamentaryRepublic" }));
    render(<RegimeHealthTab countryCode="CN" />);
    await waitFor(() => {
      expect(screen.getByTestId("regime-health-na")).toBeTruthy();
    });
  });

  it("renders the active decision with all its options when present", async () => {
    mockFetch(() =>
      jsonResponse({
        ...leaderPayload,
        activeDecision: {
          id: "65f000000000000000000001",
          kind: "stage1.addressDiscontent",
          offeredAtTurn: 480,
          expiresAtTurn: 528,
          payload: {},
          options: [
            { id: "acknowledge", label: "Acknowledge", description: "..." },
            { id: "crackDown", label: "Crack down", description: "..." },
            { id: "ignore", label: "Ignore", description: "..." },
          ],
        },
      })
    );
    render(<RegimeHealthTab countryCode="CN" />);
    await waitFor(() => {
      expect(screen.getByTestId("regime-option-acknowledge")).toBeTruthy();
    });
    expect(screen.getByTestId("regime-option-crackDown")).toBeTruthy();
    expect(screen.getByTestId("regime-option-ignore")).toBeTruthy();
  });

  it("disables reform buttons on cooldown and labels the cooldown turn", async () => {
    mockFetch(() =>
      jsonResponse({
        ...leaderPayload,
        reformAvailability: {
          ...((leaderPayload as Record<string, unknown>).reformAvailability as Record<
            string,
            unknown
          >),
          reduceVoteMultipliers: { available: false, cooldownUntil: 700 },
        },
      })
    );
    render(<RegimeHealthTab countryCode="CN" />);
    await waitFor(() => {
      const btn = screen.getByTestId("regime-reform-reduceVoteMultipliers");
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });
    expect(screen.getByTestId("regime-reform-cooldown-reduceVoteMultipliers").textContent).toMatch(
      /turn 700/
    );
  });

  it("shows the announce-convention button when no convention is in progress", async () => {
    mockFetch(() => jsonResponse(leaderPayload));
    render(<RegimeHealthTab countryCode="CN" />);
    await waitFor(() => {
      expect(screen.getByTestId("regime-convention-announce")).toBeTruthy();
    });
  });

  it("shows the convention status block when a convention IS in progress", async () => {
    mockFetch(() =>
      jsonResponse({
        ...leaderPayload,
        convention: {
          phase: "announced",
          announcedAtTurn: 480,
          draftDeadlineTurn: 528,
          legacyReservation: 20,
          electionDelayTurns: 24,
        },
        conventionInProgress: true,
      })
    );
    render(<RegimeHealthTab countryCode="CN" />);
    await waitFor(() => {
      const block = screen.getByTestId("regime-convention-status");
      expect(block.textContent).toMatch(/announced/);
    });
    expect(screen.queryByTestId("regime-convention-announce")).toBeNull();
  });

  it("flags the half-cost discount when pendingReformDiscount matches currentTurn", async () => {
    mockFetch(() =>
      jsonResponse({
        ...leaderPayload,
        pendingReformDiscount: { turn: 500, multiplier: 0.5 },
      })
    );
    render(<RegimeHealthTab countryCode="CN" />);
    await waitFor(() => {
      expect(screen.getByTestId("regime-discount-flag")).toBeTruthy();
    });
  });

  it("clicking a reform action toggles its expandable detail panel", async () => {
    mockFetch(() => jsonResponse(leaderPayload));
    render(<RegimeHealthTab countryCode="CN" />);
    await waitFor(() => {
      expect(screen.getByTestId("regime-reform-toggle-reduceVoteMultipliers")).toBeTruthy();
    });
    // Detail panel hidden by default
    expect(screen.queryByTestId("regime-reform-detail-reduceVoteMultipliers")).toBeNull();
    // Click to expand
    screen.getByTestId("regime-reform-toggle-reduceVoteMultipliers").click();
    await waitFor(() => {
      expect(screen.getByTestId("regime-reform-detail-reduceVoteMultipliers")).toBeTruthy();
    });
    // Expanded panel shows the cost / gain / boost / cooldown structured rows
    const detail = screen.getByTestId("regime-reform-detail-reduceVoteMultipliers");
    expect(detail.textContent).toMatch(/Intra-party cost/);
    expect(detail.textContent).toMatch(/Popular gain/);
    expect(detail.textContent).toMatch(/Cooldown/);
    expect(detail.textContent).toMatch(/240 turns/);
  });

  it("renders SVG sparklines + projection delta labels when projection data is present", async () => {
    mockFetch(() =>
      jsonResponse({
        ...leaderPayload,
        history: {
          popularLegitimacy: [
            { turn: 498, previous: 60, next: 58, delta: -2, reason: "drift" },
            { turn: 499, previous: 58, next: 56, delta: -2, reason: "drift" },
            { turn: 500, previous: 56, next: 55.5, delta: -0.5, reason: "drift" },
          ],
          partyConfidence: [{ turn: 500, previous: 62, next: 60, delta: -2, reason: "drift" }],
        },
        projection: {
          popularLegitimacy: Array.from({ length: 48 }, (_, i) => 55.5 - i * 0.5),
          partyConfidence: Array.from({ length: 48 }, (_, i) => 60 - i * 0.3),
        },
      })
    );
    render(<RegimeHealthTab countryCode="CN" />);
    await waitFor(() => {
      expect(screen.getByTestId("regime-popular-spark")).toBeTruthy();
    });
    expect(screen.getByTestId("regime-confidence-spark")).toBeTruthy();
    // Delta label points downward — projection ends below current value
    const popLabel = screen.getByTestId("regime-popular-projection-label");
    expect(popLabel.textContent).toMatch(/↓/);
  });

  it("scalar card renders without a sparkline when no history and no projection", async () => {
    mockFetch(() =>
      jsonResponse({
        ...leaderPayload,
        history: { popularLegitimacy: [], partyConfidence: [] },
        projection: null,
      })
    );
    render(<RegimeHealthTab countryCode="CN" />);
    await waitFor(() => {
      expect(screen.getByTestId("regime-popular")).toBeTruthy();
    });
    // No sparkline element when there's no series data
    expect(screen.queryByTestId("regime-popular-spark")).toBeNull();
  });

  it("Stage-2 selectiveConcession: shows 'no banned parties' empty state when none exist", async () => {
    mockFetch(() =>
      jsonResponse({
        ...leaderPayload,
        bannedParties: [],
        activeDecision: {
          id: "65f000000000000000000003",
          kind: "stage2.respondToUnrest",
          offeredAtTurn: 480,
          expiresAtTurn: 528,
          payload: {},
          options: [
            { id: "openDialogue", label: "Open dialogue", description: "..." },
            { id: "selectiveConcession", label: "Selective concession", description: "..." },
            { id: "martialLaw", label: "Martial law", description: "..." },
            { id: "ignore", label: "Ignore", description: "..." },
          ],
        },
      })
    );
    render(<RegimeHealthTab countryCode="CN" />);
    await waitFor(() => {
      expect(screen.getByTestId("regime-option-selectiveConcession")).toBeTruthy();
    });
    expect(screen.getByTestId("regime-selective-concession-empty").textContent).toMatch(
      /No banned parties to legalize/
    );
    // No picker dropdown rendered in this case.
    expect(screen.queryByTestId("regime-selective-concession-picker")).toBeNull();
  });

  it("Stage-2 selectiveConcession: renders picker + disabled confirm until a party is picked", async () => {
    mockFetch(() =>
      jsonResponse({
        ...leaderPayload,
        bannedParties: [
          { sequentialId: 5, name: "Democratic Faction of the CCP", abbreviation: "DFCCP" },
          { sequentialId: 9, name: "Workers Alliance" },
        ],
        activeDecision: {
          id: "65f000000000000000000004",
          kind: "stage2.respondToUnrest",
          offeredAtTurn: 480,
          expiresAtTurn: 528,
          payload: {},
          options: [
            { id: "selectiveConcession", label: "Selective concession", description: "..." },
            { id: "ignore", label: "Ignore", description: "..." },
          ],
        },
      })
    );
    render(<RegimeHealthTab countryCode="CN" />);
    await waitFor(() => {
      expect(screen.getByTestId("regime-selective-concession-picker")).toBeTruthy();
    });
    const picker = screen.getByTestId("regime-selective-concession-picker") as HTMLSelectElement;
    const confirm = screen.getByTestId("regime-selective-concession-confirm") as HTMLButtonElement;
    // Picker has the two banned parties plus the "Pick…" placeholder.
    expect(picker.options.length).toBe(3);
    expect(picker.options[1].textContent).toMatch(/Democratic Faction of the CCP/);
    // Confirm disabled until a party is picked.
    expect(confirm.disabled).toBe(true);
  });
});
