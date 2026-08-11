/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResultsTable } from "./ResultsTable";
import type { ResultsCandidate, ResultsUnit } from "@/lib/elections/liveResults/types";

afterEach(() => {
  vi.restoreAllMocks();
});

const candidates = new Map<string, ResultsCandidate>([
  [
    "alice",
    {
      id: "alice",
      name: "Alice Alpha",
      party: "1",
      partyName: "Unity",
      partyColor: "#3B82F6",
      isNPP: false,
      totalVotes: 0,
      voteSharePct: 0,
    },
  ],
]);

function unit(overrides: Partial<ResultsUnit> & { id: string; name: string }): ResultsUnit {
  return {
    weight: 10,
    totalVotes: 1000,
    reportingPct: 90,
    called: false,
    leaderId: "alice",
    tied: false,
    leaderMargin: 100,
    leaderMarginPct: 10,
    candidates: [],
    ...overrides,
  };
}

describe("ResultsTable", () => {
  it("shows the empty state with no units", () => {
    render(
      <ResultsTable units={[]} candidatesById={candidates} unitLabel="State" title="All states" />
    );
    expect(screen.getByText("No results reported yet.")).toBeTruthy();
  });

  it("defaults to closest-margin sort with silent units last", () => {
    render(
      <ResultsTable
        units={[
          unit({ id: "CA", name: "California", leaderMarginPct: 25 }),
          unit({ id: "PA", name: "Pennsylvania", leaderMarginPct: 1.2 }),
          unit({ id: "WY", name: "Wyoming", totalVotes: 0, leaderMarginPct: 0 }),
        ]}
        candidatesById={candidates}
        unitLabel="State"
        title="All states"
      />
    );
    const rows = screen.getAllByRole("row").slice(1); // skip header
    const names = rows.map((r) => r.querySelector("td")?.textContent);
    expect(names).toEqual(["Pennsylvania", "California", "Wyoming"]);
  });

  it("re-sorts alphabetically when the name header is clicked", () => {
    render(
      <ResultsTable
        units={[
          unit({ id: "PA", name: "Pennsylvania", leaderMarginPct: 1.2 }),
          unit({ id: "CA", name: "California", leaderMarginPct: 25 }),
        ]}
        candidatesById={candidates}
        unitLabel="State"
        title="All states"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /State/ }));
    const rows = screen.getAllByRole("row").slice(1);
    const names = rows.map((r) => r.querySelector("td")?.textContent);
    expect(names).toEqual(["California", "Pennsylvania"]);
  });

  it("labels called, too-close, and tied races", () => {
    render(
      <ResultsTable
        units={[
          unit({ id: "CA", name: "California", called: true, calledFor: "alice" }),
          unit({ id: "PA", name: "Pennsylvania", called: false }),
          unit({ id: "GA", name: "Georgia", tied: true, leaderMarginPct: 0 }),
        ]}
        candidatesById={candidates}
        unitLabel="State"
        title="All states"
      />
    );
    expect(screen.getByText("Called")).toBeTruthy();
    expect(screen.getByText("Too close")).toBeTruthy();
    expect(screen.getByText("Tied")).toBeTruthy();
  });
});
