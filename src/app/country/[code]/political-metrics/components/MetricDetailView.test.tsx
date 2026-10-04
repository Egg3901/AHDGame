/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
      target: 99,
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
  const view = render(
    <MetricDetailView data={data} category={category} metric={subject} {...handlers} />
  );
  return { ...handlers, container: view.container };
}

const evidenceRow = (id: string, label: string, trend: number | null, value = 5.2) => ({
  id,
  label,
  value,
  trend,
  format: { suffix: "%" },
  scope: "national" as const,
});

/** The trend arrow printed after an underlying statistic's value. */
function trendArrow(text: string): HTMLElement {
  return screen.getByText(text);
}

describe("MetricDetailView", () => {
  it("heads the view with the metric, its toned score, status pill and lean chip", () => {
    setup(metric("workerSecurity", "Worker Security", 47));
    expect(screen.getByRole("heading", { level: 2, name: "Worker Security" })).toBeTruthy();
    expect(screen.getByText("Economy & Labor · United States")).toBeTruthy();
    expect(screen.getByText("47").className).toContain("text-warning");
    expect(screen.getAllByText("Strained").length).toBeGreaterThan(0);
    expect(screen.getByText("Strong Left")).toBeTruthy();
    expect(screen.getByText("0 to 100 objective")).toBeTruthy();
  });

  it("keeps the empty trend copy until the metric has a snapshot", () => {
    setup(metric("workerSecurity", "Worker Security", 47));
    expect(screen.getAllByText("series begins this campaign").length).toBeGreaterThan(0);
  });

  it("measures the trend against the metric's last snapshot", () => {
    const { container } = setup(
      metric("workerSecurity", "Worker Security", 47, {
        history: [
          { turn: 24, value: 44 },
          { turn: 48, value: 49.5 },
        ],
      })
    );
    const delta = screen.getByText("-2.5");
    expect(delta.className).toContain("text-error");
    expect(delta.parentElement!.textContent).toContain("-2.5 from 50 over 24 turns");
    // Two snapshots are enough for the chart.
    expect(container.querySelector("polyline")).toBeTruthy();
  });

  it("colours a statistic's trend by whether the move is good", () => {
    setup(
      metric("workerSecurity", "Worker Security", 47, {
        evidence: [
          evidenceRow("unemploymentRate", "Unemployment", 0.4),
          evidenceRow("medianIncome", "Median income", 0.6, 41000),
          evidenceRow("povertyRate", "Poverty", -0.3, 12),
        ],
      })
    );
    // Rising unemployment is bad news, whatever the arrow points at.
    expect(trendArrow("▲ 0.4").className).toContain("text-error");
    expect(trendArrow("▲ 0.6").className).toContain("text-success");
    // Falling poverty is good news.
    expect(trendArrow("▼ 0.3").className).toContain("text-success");
  });

  it("keeps the old reading where a statistic's polarity is not known", () => {
    setup(
      metric("workerSecurity", "Worker Security", 47, {
        evidence: [
          evidenceRow("notInTheCatalog", "Unlisted rise", 0.2),
          evidenceRow("alsoNotListed", "Unlisted fall", -0.7),
        ],
      })
    );
    expect(trendArrow("▲ 0.2").className).toContain("text-success");
    expect(trendArrow("▼ 0.7").className).toContain("text-error");
  });

  it("keeps drivers, indicators and the underlying statistics", () => {
    setup(
      metric("workerSecurity", "Worker Security", 47, {
        evidence: [evidenceRow("unemploymentRate", "Unemployment", null)],
      })
    );
    expect(screen.getByText("Positive contributors")).toBeTruthy();
    expect(screen.getByText("Collective bargaining protections")).toBeTruthy();
    expect(screen.getByText("Manufacturing layoffs")).toBeTruthy();
    expect(screen.getByText("Union density")).toBeTruthy();
    expect(screen.getByText("5.2%")).toBeTruthy();
    // The national marker is for region views only.
    expect(screen.queryByText("national")).toBeNull();
  });

  it("opens a related metric and goes back to the category", () => {
    const { onOpenMetric, onBackToCategory } = setup(
      metric("workerSecurity", "Worker Security", 47)
    );
    fireEvent.click(screen.getByRole("button", { name: /Market Competition/ }));
    expect(onOpenMetric).toHaveBeenCalledWith("economy.competition");
    fireEvent.click(screen.getByRole("button", { name: "← Economy & Labor" }));
    expect(onBackToCategory).toHaveBeenCalled();
  });

  it("sets nothing under 12px", () => {
    const { container } = setup(
      metric("workerSecurity", "Worker Security", 47, {
        evidence: [evidenceRow("unemploymentRate", "Unemployment", 0.4)],
      })
    );
    expect(container.innerHTML).not.toMatch(/text-body-xs|text-\[(?:[0-9]|1[01])px\]/);
  });
});
