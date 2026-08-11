/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CohortBreakdown } from "./CohortBreakdown";

describe("CohortBreakdown", () => {
  it("renders a whole-electorate row and a lean bar per cohort", () => {
    render(
      <CohortBreakdown
        yesShare={49}
        labels={{ yes: "Reunify", no: "Stay in UK" }}
        rows={[
          { groupId: "a", name: "Urban progressives", share: 0.4, turnout: 65, yesLean: 72 },
          { groupId: "b", name: "Rural traditionalists", share: 0.6, turnout: 70, yesLean: 28 },
        ]}
      />
    );
    expect(screen.getByText(/Whole electorate/i)).toBeTruthy();
    expect(screen.getByText("Urban progressives")).toBeTruthy();
    expect(screen.getByText("Rural traditionalists")).toBeTruthy();
    expect(screen.getAllByText(/Reunify/).length).toBeGreaterThan(0);
  });

  it("shows the empty state with no cohorts", () => {
    render(<CohortBreakdown rows={[]} yesShare={50} />);
    expect(screen.getByText(/no cohort/i)).toBeTruthy();
  });

  it("makes bars tappable target links when targetHref is provided", () => {
    render(
      <CohortBreakdown
        yesShare={49}
        targetHref={(t) => `?target=${t}`}
        rows={[{ groupId: "a", name: "Urban progressives", share: 0.4, turnout: 65, yesLean: 72 }]}
      />
    );
    expect(screen.getByRole("link", { name: /Whole electorate/i }).getAttribute("href")).toBe(
      "?target=whole"
    );
    expect(screen.getByRole("link", { name: /Urban progressives/i }).getAttribute("href")).toBe(
      "?target=a"
    );
  });
});
