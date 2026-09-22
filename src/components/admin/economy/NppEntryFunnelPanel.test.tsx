/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NppEntryFunnelPanel } from "./NppEntryFunnelPanel";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(funnelBody: unknown, vitalBody: unknown, vitalStatus = 200) {
  global.fetch = vi.fn((url: string) => {
    if (url.includes("/api/admin/economy/npp-entry-funnel")) {
      const status = funnelBody == null ? 404 : 200;
      return Promise.resolve(
        new Response(funnelBody == null ? "{}" : JSON.stringify(funnelBody), {
          status,
          headers: { "content-type": "application/json" },
        })
      );
    }
    if (url.includes("/api/admin/economy/vital-signs")) {
      return Promise.resolve(
        new Response(vitalBody == null ? "{}" : JSON.stringify(vitalBody), {
          status: vitalBody == null ? 404 : vitalStatus,
          headers: { "content-type": "application/json" },
        })
      );
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  }) as unknown as typeof fetch;
}

const funnel = {
  funnel: {
    _id: "current",
    schemaVersion: 1,
    turn: 440,
    generatedAt: "2026-08-28T00:00:00.000Z",
    corporationsObserved: 3,
    entered: 1,
    rejected: 2,
    reasonCounts: { entered: 1, founding_cost: 1, cash_floor: 1 },
    diagnostics: [],
  },
};

function vital(marketFormation: Record<string, unknown>) {
  return { snapshot: { turn: 440, marketFormation } };
}

describe("NppEntryFunnelPanel", () => {
  it("renders one primary reason per candidate and the coverage aggregates", async () => {
    mockFetch(
      funnel,
      vital({
        cellsObserved: 10,
        activeCells: 6,
        emptyCells: 4,
        emptyShare: 0.4,
        facilityReadyEmptyCells: 3,
        facilityReadyEmptyShare: 0.75,
        classificationCounts: { unserved: 2, entry_gap: 1, import_served: 1 },
        entryFunnel: {},
        coverageByState: [],
        coverageByCountry: [],
      })
    );

    render(<NppEntryFunnelPanel />);

    await waitFor(() => expect(screen.getByText(/Turn 440:/)).toBeTruthy());
    expect(screen.getByText("founding_cost")).toBeTruthy();
    expect(screen.getByText(/4 of 10 cells empty/)).toBeTruthy();
    expect(screen.getByText("entry_gap")).toBeTruthy();
  });

  it("stays servable on a pre-coverage snapshot and on a missing funnel", async () => {
    mockFetch(
      null,
      vital({
        cellsObserved: 10,
        emptyCells: 4,
        classificationCounts: { unserved: 4 },
        entryFunnel: {},
        basis: "legacy",
      })
    );

    render(<NppEntryFunnelPanel />);

    await waitFor(() => expect(screen.getByText(/No funnel snapshot yet/)).toBeTruthy());
    expect(
      screen.getByText(/Per-state coverage starts with snapshots written by this build/)
    ).toBeTruthy();
  });
});
