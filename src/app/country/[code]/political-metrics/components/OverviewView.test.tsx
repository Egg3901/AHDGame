/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OverviewView } from "./OverviewView";
import type { PMCategory, PMRegistryData } from "./registryTypes";

afterEach(cleanup);

const CADENCE = 24;

/**
 * One category of one metric, carrying `history` entries oldest-first. The
 * overall score is the mean of category means, so a single-metric single-category
 * payload makes the arithmetic legible.
 */
function makeData(history: number[], overall: number): PMRegistryData {
  const category = {
    id: "economy",
    displayName: "Economy & Labor",
    score: overall,
    status: "Stable",
    metrics: [
      {
        id: "economy.workerSecurity",
        lean: -5,
        leanLabel: "Strong Left",
        displayName: "Worker Security",
        description: "",
        pos: [],
        neg: [],
        indicators: [],
        value: overall,
        status: "Stable",
        legislation: null,
        history: history.map((value, i) => ({ turn: (i + 1) * CADENCE, value })),
        modifiers: {
          laws: [],
          regionalLaws: [],
          residual: 0,
          cabinet: 0,
          labour: 0,
          cabinetBySource: [],
          cabinetAtCap: false,
          cabinetCap: 8,
          driftHalfLifeTurns: 34,
          target: overall,
          direction: "flat" as const,
        },
        evidence: [],
        regions: [],
      },
    ],
  } as unknown as PMCategory;

  return {
    countryId: "US",
    countryDisplayName: "United States",
    year: 1963,
    turn: 575,
    historyCadenceTurns: CADENCE,
    overall,
    overallStatus: "Stable",
    categories: [category],
  };
}

function renderOverview(data: PMRegistryData) {
  render(
    <OverviewView
      data={data}
      onOpenCategory={vi.fn()}
      onOpenMetric={vi.fn()}
      showGovernanceStyle={false}
    />
  );
}

describe("OverviewView movement tiles", () => {
  it("labels the short tile by the real snapshot cadence, not 'last turn'", () => {
    // Snapshots land every 24 turns, so "since last turn" was never a question
    // this series could answer.
    renderOverview(makeData([], 68));
    expect(screen.getByText(`Δ last ${CADENCE} turns`)).toBeTruthy();
  });

  it("shows the empty state until a snapshot exists", () => {
    renderOverview(makeData([], 68));
    expect(screen.getAllByText("series begins this campaign").length).toBe(2);
  });

  it("computes the short delta against the most recent snapshot", () => {
    renderOverview(makeData([60], 68));
    expect(screen.getByText("+8")).toBeTruthy();
    expect(screen.getByText("from 60")).toBeTruthy();
  });

  it("computes the yearly delta against the snapshot two cadences back", () => {
    // 48 turns per year / 24 per snapshot = 2 snapshots back.
    renderOverview(makeData([50, 60], 68));
    expect(screen.getByText("+18")).toBeTruthy(); // vs 50, a year ago
    expect(screen.getByText("+8")).toBeTruthy(); // vs 60, last snapshot
  });

  it("still reports the short delta while the year is out of reach", () => {
    renderOverview(makeData([60], 68));
    expect(screen.getByText("+8")).toBeTruthy();
    // Only one snapshot exists, so the yearly tile has nothing to compare.
    expect(screen.getAllByText("series begins this campaign").length).toBe(1);
  });

  it("signs a fall negative", () => {
    renderOverview(makeData([70], 68));
    expect(screen.getByText("-2")).toBeTruthy();
  });
});
