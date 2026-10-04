/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

function setup(
  options: { history?: [number[], number[]]; scope?: "national" | "region"; name?: string } = {}
) {
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
    countryDisplayName: options.name ?? "United States",
    year: 1963,
    turn: 575,
    historyCadenceTurns: CADENCE,
    overall: 55,
    overallStatus: "Stable",
    categories: [category],
  };
  const handlers = { onBack: vi.fn(), onOpenMetric: vi.fn(), onCompareCategory: vi.fn() };
  const view = render(<CategoryDetailView data={data} category={category} {...handlers} />);
  return { ...handlers, container: view.container };
}

/** The metric rows, in the order they render. */
function rowNames(): string[] {
  return screen
    .getAllByRole("button")
    .filter((el) => el.tagName === "DIV")
    .map((el) => el.textContent ?? "");
}

describe("CategoryDetailView", () => {
  it("heads the view with the category, its toned score and its status pill", () => {
    setup();
    expect(screen.getByRole("heading", { level: 2, name: "Economy & Labor" })).toBeTruthy();
    expect(screen.getByText("United States · seven metrics spanning the ideological range"));
    const score = screen.getByText("50");
    expect(score.className).toContain("text-warning");
    expect(screen.getAllByText("Strained").length).toBeGreaterThan(0);
  });

  it("keeps the empty movement copy until the category has a snapshot", () => {
    setup();
    expect(screen.getByText("Movement · last 24 turns")).toBeTruthy();
    expect(screen.getByText("series begins this campaign")).toBeTruthy();
  });

  it("measures the movement against the category's last snapshot", () => {
    // Mean of the two metrics at the last snapshot is (66 + 30) / 2 = 48, and
    // the category now scores 50.
    setup({ history: [[66], [30]] });
    const delta = screen.getByText("+2");
    expect(delta.className).toContain("text-success");
    expect(delta.parentElement!.textContent).toContain("+2 from 48");
    expect(screen.queryByText("series begins this campaign")).toBeNull();
  });

  it("names the order the metrics are in, and re-sorts", () => {
    setup();
    expect(screen.getByText("Metrics · ideological order, L → R")).toBeTruthy();
    expect(rowNames()[0]).toContain("Worker Security");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "alpha" } });
    expect(screen.getByText("Metrics · alphabetical")).toBeTruthy();
    expect(rowNames()[0]).toContain("Market Competition");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "score" } });
    expect(screen.getByText("Metrics · objective score, high to low")).toBeTruthy();
    expect(rowNames()[0]).toContain("Worker Security");
  });

  it("keeps the top driver and drag for each metric", () => {
    setup();
    expect(screen.getAllByText("Collective bargaining protections")).toHaveLength(2);
    expect(screen.getAllByText("Manufacturing layoffs")).toHaveLength(2);
  });

  it("opens a metric from its row, by click or by keyboard", () => {
    const { onOpenMetric } = setup();
    const rows = screen.getAllByRole("button").filter((el) => el.tagName === "DIV");
    fireEvent.click(rows[1]);
    expect(onOpenMetric).toHaveBeenLastCalledWith("economy.competition");
    fireEvent.keyDown(rows[0], { key: "Enter" });
    expect(onOpenMetric).toHaveBeenLastCalledWith("economy.workerSecurity");
  });

  it("opens a metric from its bar in the ideological range", () => {
    const { onOpenMetric } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^Market Competition, score 30/ }));
    expect(onOpenMetric).toHaveBeenCalledWith("economy.competition");
  });

  it("goes back and compares, with labels that match the scope", () => {
    const { onBack, onCompareCategory } = setup();
    fireEvent.click(screen.getByRole("button", { name: "← National overview" }));
    expect(onBack).toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Compare this category across countries →" })
    );
    expect(onCompareCategory).toHaveBeenCalled();
    cleanup();
    setup({ scope: "region", name: "Georgia" });
    expect(screen.getByRole("button", { name: "← Georgia overview" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Compare this category across regions →" })
    ).toBeTruthy();
  });

  it("states the empty modifiers and legislation plainly", () => {
    setup();
    expect(
      screen.getByText("No active laws, policies, or events are currently moving this category.")
    ).toBeTruthy();
    expect(screen.getByText("None linked yet.")).toBeTruthy();
  });

  it("sets nothing under 12px", () => {
    const { container } = setup();
    expect(container.innerHTML).not.toMatch(/text-body-xs|text-\[(?:[0-9]|1[01])px\]/);
  });
});
