/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    scope: "national" as const,
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

function renderOverview(
  data: PMRegistryData,
  handlers: { onOpenCategory?: () => void; onOpenMetric?: () => void } = {}
) {
  return render(
    <OverviewView
      data={data}
      onOpenCategory={handlers.onOpenCategory ?? vi.fn()}
      onOpenMetric={handlers.onOpenMetric ?? vi.fn()}
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

  it("prints n/a, not a dash, while a tile has nothing to compare", () => {
    renderOverview(makeData([], 68));
    expect(screen.getAllByText("n/a")).toHaveLength(2);
  });
});

describe("OverviewView category cards", () => {
  it("opens a category from its card by click or keyboard", () => {
    const onOpenCategory = vi.fn();
    renderOverview(makeData([], 68), { onOpenCategory });
    const card = screen.getByRole("button", { name: /Economy & Labor, score 68, Stable/ });
    fireEvent.click(card);
    expect(onOpenCategory).toHaveBeenLastCalledWith("economy");
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onOpenCategory).toHaveBeenCalledTimes(2);
  });

  it("opens a metric from its mini bar without opening the category", () => {
    const onOpenCategory = vi.fn();
    const onOpenMetric = vi.fn();
    renderOverview(makeData([], 68), { onOpenCategory, onOpenMetric });
    fireEvent.click(screen.getByRole("button", { name: /^Worker Security, score 68/ }));
    expect(onOpenMetric).toHaveBeenCalledWith("economy", "economy.workerSecurity");
    expect(onOpenCategory).not.toHaveBeenCalled();
  });

  it("keeps the toned score and status pill on each card", () => {
    renderOverview(makeData([], 68));
    const card = screen.getByRole("button", { name: /Economy & Labor, score 68/ });
    const score = Array.from(card.querySelectorAll("span")).find((el) => el.textContent === "68");
    expect(score?.className).toContain("text-success-muted");
    expect(
      Array.from(card.querySelectorAll("span")).some((el) => el.textContent === "Stable")
    ).toBe(true);
  });

  it("sets nothing under 12px", () => {
    const { container } = renderOverview(makeData([60], 68));
    expect(container.innerHTML).not.toMatch(/text-body-xs|text-\[(?:[0-9]|1[01])px\]/);
  });
});
