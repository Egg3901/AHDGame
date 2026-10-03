/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CategoryDetailView } from "./CategoryDetailView";
import type { PMCategory, PMMetric, PMRegistryData } from "./registryTypes";

afterEach(cleanup);

const CADENCE = 24;

function metric(
  slug: string,
  lean: number,
  leanLabel: string,
  displayName: string,
  value: number,
  status: string,
  history: number[] = []
): PMMetric {
  return {
    id: `economy.${slug}`,
    lean,
    leanLabel,
    displayName,
    description: `${displayName} description.`,
    pos: ["Collective bargaining protections"],
    neg: ["Manufacturing layoffs"],
    indicators: [],
    value,
    status,
    legislation: null,
    history: history.map((v, i) => ({ turn: (i + 1) * CADENCE, value: v })),
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
  } as unknown as PMMetric;
}

function setup(options: { history?: [number[], number[]]; scope?: "national" | "region" } = {}) {
  const [leftHistory, rightHistory] = options.history ?? [[], []];
  const category = {
    id: "economy",
    displayName: "Economy & Labor",
    score: 50,
    status: "Strained",
    metrics: [
      metric("workerSecurity", -5, "Strong Left", "Worker Security", 70, "Strong", leftHistory),
      metric("competition", 5, "Strong Right", "Market Competition", 30, "Weak", rightHistory),
    ],
  } as unknown as PMCategory;
  const data: PMRegistryData = {
    scope: options.scope ?? "national",
    countryId: "US",
    countryDisplayName: "United States",
    year: 1963,
    turn: 575,
    historyCadenceTurns: CADENCE,
    overall: 55,
    overallStatus: "Stable",
    categories: [category],
  };
  const handlers = { onBack: vi.fn(), onOpenMetric: vi.fn(), onCompareCategory: vi.fn() };
  render(<CategoryDetailView data={data} category={category} {...handlers} />);
  return handlers;
}

describe("CategoryDetailView", () => {
  it("heads the view with the category, its score and its status word", () => {
    setup();
    expect(screen.getByRole("heading", { level: 2, name: "Economy & Labor" })).toBeTruthy();
    expect(screen.getByText("United States · seven metrics spanning the ideological range"));
    expect(screen.getByText("50")).toBeTruthy();
    // The header's status word, not a metric row's.
    const header = screen.getByRole("heading", { level: 2 }).closest("header")!;
    expect(within(header).getByText("Strained").className).toContain("text-warning");
  });

  it("says plainly when the category has no history to measure a change from", () => {
    setup();
    expect(screen.getByText(/Change over the last 24 turns: not enough history yet/)).toBeTruthy();
  });

  it("measures the change against the category's last snapshot", () => {
    // Mean of the two metrics at the last snapshot is (66 + 30) / 2 = 48, and
    // the category now scores 50.
    setup({ history: [[66], [30]] });
    const line = screen.getByText(/Change over the last 24 turns/);
    expect(line.textContent).toContain("+2 from 48");
    expect(within(line).getByText("+2").className).toContain("text-success");
  });

  it("lists the metrics in a table with lean, score and a status word", () => {
    setup();
    const table = screen.getByRole("table", { name: "Metrics" });
    const rows = within(table).getAllByRole("row");
    // Header plus two metrics, in lean order by default.
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toContain("Worker Security");
    expect(rows[1].textContent).toContain("Strong left");
    expect(rows[2].textContent).toContain("Market Competition");
    const weak = within(rows[2])
      .getAllByText("Weak")
      .find((el) => el.tagName === "TD")!;
    expect(weak.className).toContain("text-warning");
    const strong = within(rows[1])
      .getAllByText("Strong")
      .find((el) => el.tagName === "TD")!;
    expect(strong.className).toContain("text-foreground");
  });

  it("keeps the top driver and drag for each metric", () => {
    setup();
    expect(screen.getAllByText("Positive: Collective bargaining protections")).toHaveLength(2);
    expect(screen.getAllByText("Negative: Manufacturing layoffs")).toHaveLength(2);
  });

  it("re-sorts and says how the list is ordered", () => {
    setup();
    expect(screen.getByText("Ordered by political association, left to right.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Sort by/), { target: { value: "alpha" } });
    expect(screen.getByText("Ordered by name.")).toBeTruthy();
    const rows = within(screen.getByRole("table", { name: "Metrics" })).getAllByRole("row");
    expect(rows[1].textContent).toContain("Market Competition");
  });

  it("opens a metric from its name and from its row", () => {
    const { onOpenMetric } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Market Competition" }));
    expect(onOpenMetric).toHaveBeenCalledTimes(1);
    expect(onOpenMetric).toHaveBeenLastCalledWith("economy.competition");
    fireEvent.click(screen.getByRole("rowheader", { name: /Worker Security/ }));
    expect(onOpenMetric).toHaveBeenLastCalledWith("economy.workerSecurity");
  });

  it("keeps the ideological range as neutral bars that open each metric", () => {
    const { onOpenMetric } = setup();
    const bar = screen.getByRole("button", { name: /Worker Security: score 70, Strong/ });
    expect(bar.innerHTML).not.toMatch(/bg-(success|warning|error|gold)/);
    fireEvent.click(bar);
    expect(onOpenMetric).toHaveBeenCalledWith("economy.workerSecurity");
  });

  it("goes back and compares from its controls, named for the scope", () => {
    const { onBack, onCompareCategory } = setup();
    fireEvent.click(screen.getByRole("button", { name: "← Overview" }));
    expect(onBack).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Compare this category across countries" }));
    expect(onCompareCategory).toHaveBeenCalled();
    cleanup();
    setup({ scope: "region" });
    expect(
      screen.getByRole("button", { name: "Compare this category with other regions" })
    ).toBeTruthy();
  });

  it("states the empty modifiers and legislation plainly", () => {
    setup();
    expect(
      screen.getByText("No active laws, policies, or events are currently moving this category.")
    ).toBeTruthy();
    expect(screen.getByText("None linked yet.")).toBeTruthy();
  });
});
