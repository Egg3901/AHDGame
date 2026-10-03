/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MetricDetailView } from "./MetricDetailView";
import type { PMCategory, PMMetric, PMRegistryData } from "./registryTypes";

afterEach(cleanup);

const CADENCE = 24;

function metric(
  slug: string,
  displayName: string,
  value: number,
  overrides: Record<string, unknown> = {}
): PMMetric {
  return {
    id: `economy.${slug}`,
    lean: -5,
    leanLabel: "Strong Left",
    displayName,
    description: "How secure workers are.",
    pos: ["Collective bargaining protections"],
    neg: ["Manufacturing layoffs"],
    indicators: ["Union density"],
    value,
    status: "Strained",
    legislation: null,
    history: [],
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
      target: value,
      direction: "flat",
    },
    evidence: [],
    regions: [],
    ...overrides,
  } as unknown as PMMetric;
}

function setup(subject: PMMetric) {
  const sibling = metric("competition", "Market Competition", 61);
  const category = {
    id: "economy",
    displayName: "Economy & Labor",
    score: 50,
    status: "Strained",
    metrics: [subject, sibling],
  } as unknown as PMCategory;
  const data: PMRegistryData = {
    scope: "national",
    countryId: "US",
    countryDisplayName: "United States",
    year: 1963,
    turn: 575,
    historyCadenceTurns: CADENCE,
    overall: 55,
    overallStatus: "Stable",
    categories: [category],
  };
  const handlers = { onBackToCategory: vi.fn(), onOpenMetric: vi.fn() };
  render(<MetricDetailView data={data} category={category} metric={subject} {...handlers} />);
  return handlers;
}

/** The value printed under one of the header's labelled facts. */
function fact(label: string): string {
  return screen.getByText(label).nextElementSibling!.textContent ?? "";
}

describe("MetricDetailView", () => {
  it("heads the view with the metric, its context below it, its score and status", () => {
    setup(metric("workerSecurity", "Worker Security", 47));
    expect(screen.getByRole("heading", { level: 2, name: "Worker Security" })).toBeTruthy();
    expect(screen.getByText("Economy & Labor · United States")).toBeTruthy();
    const header = screen.getByRole("heading", { level: 2 }).closest("header")!;
    expect(within(header).getByText("47")).toBeTruthy();
    expect(within(header).getByText("Strained").className).toContain("text-warning");
  });

  it("states lean, change, update and scale as labelled facts", () => {
    setup(metric("workerSecurity", "Worker Security", 47));
    expect(fact("Lean")).toBe("Strong left");
    expect(fact(`Change over the last ${CADENCE} turns`)).toBe("Not enough history yet");
    expect(fact("Updated")).toBe("Turn 575");
    expect(fact("Scale")).toBe("0 to 100, objective");
    expect(screen.getByText(/association, not a quality judgment/)).toBeTruthy();
  });

  it("measures the change against the metric's last snapshot", () => {
    setup(
      metric("workerSecurity", "Worker Security", 47, {
        history: [
          { turn: 24, value: 44 },
          { turn: 48, value: 49.5 },
        ],
      })
    );
    expect(fact(`Change over the last ${CADENCE} turns`)).toBe("-2.5 from 50");
    // Two snapshots are enough for the chart.
    expect(document.querySelector("polyline")).toBeTruthy();
  });

  it("explains an empty chart instead of drawing an empty box", () => {
    setup(metric("workerSecurity", "Worker Security", 47));
    expect(screen.getByText(/The chart starts once two snapshots exist/)).toBeTruthy();
  });

  it("keeps drivers, indicators and the underlying statistics", () => {
    setup(
      metric("workerSecurity", "Worker Security", 47, {
        evidence: [
          {
            id: "unemploymentRate",
            label: "Unemployment",
            value: 5.2,
            trend: 0.4,
            format: { suffix: "%" },
            scope: "national",
          },
        ],
      })
    );
    expect(screen.getByRole("heading", { name: "Positive contributors" })).toBeTruthy();
    expect(screen.getByText("Collective bargaining protections")).toBeTruthy();
    expect(screen.getByText("Manufacturing layoffs")).toBeTruthy();
    expect(screen.getByText("Union density")).toBeTruthy();
    expect(screen.getByText("5.2%")).toBeTruthy();
    // A rising rate is not good or bad by direction alone, so the arrow is neutral.
    expect(screen.getByText("▲ 0.4").className).toContain("text-muted");
    // The national marker is for region views only.
    expect(screen.queryByText("(national)")).toBeNull();
  });

  it("opens a related metric and goes back to the category", () => {
    const { onOpenMetric, onBackToCategory } = setup(
      metric("workerSecurity", "Worker Security", 47)
    );
    fireEvent.click(screen.getByRole("button", { name: "Market Competition" }));
    expect(onOpenMetric).toHaveBeenCalledWith("economy.competition");
    fireEvent.click(screen.getByRole("button", { name: "← Economy & Labor" }));
    expect(onBackToCategory).toHaveBeenCalled();
  });
});
