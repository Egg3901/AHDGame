/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { OverviewView } from "./OverviewView";
import type { PMCategory, PMMetric, PMRegistryData } from "./registryTypes";

afterEach(cleanup);

const CADENCE = 24;
const EMPTY = "Not enough history yet";

const MODIFIERS = {
  laws: [],
  regionalLaws: [],
  residual: 0,
  cabinet: 0,
  labour: 0,
  cabinetBySource: [],
  cabinetAtCap: false,
  cabinetCap: 8,
  driftHalfLifeTurns: 34,
  target: 50,
  direction: "flat" as const,
};

function metric(id: string, displayName: string, value: number, history: number[] = []): PMMetric {
  return {
    id,
    lean: -5,
    leanLabel: "Strong Left",
    displayName,
    description: "",
    pos: [],
    neg: [],
    indicators: [],
    value,
    status: "Stable",
    legislation: null,
    history: history.map((v, i) => ({ turn: (i + 1) * CADENCE, value: v })),
    modifiers: { ...MODIFIERS, target: value },
    evidence: [],
    regions: [],
  } as unknown as PMMetric;
}

function category(
  id: string,
  displayName: string,
  score: number,
  status: string,
  metrics: PMMetric[]
): PMCategory {
  return { id, displayName, score, status, metrics } as unknown as PMCategory;
}

function registry(categories: PMCategory[], overall: number): PMRegistryData {
  return {
    scope: "national" as const,
    countryId: "US",
    countryDisplayName: "United States",
    year: 1963,
    turn: 575,
    historyCadenceTurns: CADENCE,
    overall,
    overallStatus: "Stable",
    categories,
  };
}

/**
 * One category of one metric, carrying `history` entries oldest-first. The
 * overall score is the mean of category means, so a single-metric single-category
 * payload makes the arithmetic legible.
 */
function makeData(history: number[], overall: number): PMRegistryData {
  return registry(
    [
      category("economy", "Economy & Labor", overall, "Stable", [
        metric("economy.workerSecurity", "Worker Security", overall, history),
      ]),
    ],
    overall
  );
}

function renderOverview(
  data: PMRegistryData,
  handlers: { onOpenCategory?: () => void; onOpenMetric?: () => void } = {}
) {
  render(
    <OverviewView
      data={data}
      onOpenCategory={handlers.onOpenCategory ?? vi.fn()}
      onOpenMetric={handlers.onOpenMetric ?? vi.fn()}
      showGovernanceStyle={false}
    />
  );
}

describe("OverviewView summary", () => {
  it("labels the short change by the real snapshot cadence, not 'last turn'", () => {
    // Snapshots land every 24 turns, so "since last turn" was never a question
    // this series could answer.
    renderOverview(makeData([], 68));
    expect(screen.getByText(`Change over the last ${CADENCE} turns`)).toBeTruthy();
    expect(screen.getByText("Change over the past year")).toBeTruthy();
  });

  it("shows the empty state until a snapshot exists", () => {
    renderOverview(makeData([], 68));
    expect(screen.getAllByText(EMPTY).length).toBe(2);
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
    // Only one snapshot exists, so the yearly figure has nothing to compare.
    expect(screen.getAllByText(EMPTY).length).toBe(1);
  });

  it("signs a fall negative", () => {
    renderOverview(makeData([70], 68));
    expect(screen.getByText("-2")).toBeTruthy();
  });

  it("colours a gain green and a fall red", () => {
    renderOverview(makeData([60], 68));
    expect(screen.getByText("+8").className).toContain("text-success");
    cleanup();
    renderOverview(makeData([70], 68));
    expect(screen.getByText("-2").className).toContain("text-error");
  });

  it("counts critical metrics and names the strongest and weakest category", () => {
    renderOverview(
      registry(
        [
          category("economy", "Economy & Labor", 74, "Strong", [
            metric("economy.workerSecurity", "Worker Security", 90),
            metric("economy.stability", "Stability", 58),
          ]),
          category("health", "Health & Social Protection", 30, "Weak", [
            metric("health.universalCare", "Universal Care", 20),
            metric("health.outcomes", "Outcomes", 40),
          ]),
        ],
        52
      )
    );
    const summary = screen.getByLabelText("Summary");
    // One metric (Universal Care, 20) is below 25.
    const critical = within(summary).getByText("Critical metrics").parentElement!;
    expect(critical.textContent).toContain("1");
    expect(within(critical).getByText("1").className).toContain("text-error");
    expect(within(summary).getByText("Strongest category").parentElement!.textContent).toContain(
      "Economy & Labor"
    );
    expect(within(summary).getByText("Weakest category").parentElement!.textContent).toContain(
      "Health & Social Protection"
    );
  });
});

describe("OverviewView categories table", () => {
  const data = registry(
    [
      category("economy", "Economy & Labor", 63, "Stable", [
        metric("economy.workerSecurity", "Worker Security", 80),
        metric("economy.stability", "Inflation and Macroeconomic Stability", 46),
      ]),
      category("order", "Public Order & Justice", 45, "Strained", [
        metric("order.safety", "Crime Rates and Public Safety", 52),
        metric("order.courts", "Court Capacity", 38),
      ]),
      category("defense", "Defense & Foreign Affairs", 21, "Critical", [
        metric("defense.security", "National Security", 30),
        metric("defense.projection", "Power Projection", 12),
      ]),
    ],
    43
  );

  it("is one table with a row per category and the five named columns", () => {
    renderOverview(data);
    const table = screen.getByRole("table", { name: "Categories" });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual([
      "Category",
      "Score",
      "Status",
      "Strongest metric",
      "Weakest metric",
      "Open",
    ]);
    // Header row plus one row per category.
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByRole("rowheader", { name: /Economy & Labor/ })).toBeTruthy();
  });

  it("colours only the bad statuses: amber for strained, red for critical", () => {
    renderOverview(data);
    const table = screen.getByRole("table", { name: "Categories" });
    const statusCell = (word: string) =>
      within(table)
        .getAllByText(word)
        .find((el) => el.tagName === "TD")!;
    expect(statusCell("Stable").className).toContain("text-foreground");
    expect(statusCell("Strained").className).toContain("text-warning");
    expect(statusCell("Critical").className).toContain("text-error");
  });

  it("keeps the score figure neutral whatever the status", () => {
    renderOverview(data);
    const table = screen.getByRole("table", { name: "Categories" });
    expect(within(table).getByText("21").className).toContain("text-foreground");
  });

  it("opens a category from its Open control", () => {
    const onOpenCategory = vi.fn();
    renderOverview(data, { onOpenCategory });
    fireEvent.click(screen.getByRole("button", { name: "Open Public Order & Justice" }));
    expect(onOpenCategory).toHaveBeenCalledTimes(1);
    expect(onOpenCategory).toHaveBeenCalledWith("order");
  });

  it("opens a category from anywhere on its row", () => {
    const onOpenCategory = vi.fn();
    renderOverview(data, { onOpenCategory });
    fireEvent.click(screen.getByRole("rowheader", { name: /Defense & Foreign Affairs/ }));
    expect(onOpenCategory).toHaveBeenCalledWith("defense");
  });

  it("opens the strongest or weakest metric directly, without opening the category", () => {
    const onOpenCategory = vi.fn();
    const onOpenMetric = vi.fn();
    renderOverview(data, { onOpenCategory, onOpenMetric });
    // The phone layout folds the same control under the category name, so the
    // markup holds it twice; either copy must do the same thing.
    const weakest = screen.getAllByRole("button", { name: "Power Projection" });
    expect(weakest.length).toBeGreaterThan(0);
    fireEvent.click(weakest[0]);
    expect(onOpenMetric).toHaveBeenCalledWith("defense", "defense.projection");
    expect(onOpenCategory).not.toHaveBeenCalled();
  });

  it("names the strongest and weakest metric in each row with their scores", () => {
    renderOverview(data);
    const row = screen.getByRole("rowheader", { name: /Economy & Labor/ }).closest("tr")!;
    expect(row.textContent).toContain("Worker Security");
    expect(row.textContent).toContain("80");
    expect(row.textContent).toContain("Inflation and Macroeconomic Stability");
    expect(row.textContent).toContain("46");
  });
});
