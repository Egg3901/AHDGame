/** @vitest-environment happy-dom */
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { GlobalResolutionsFeed } from "./GlobalResolutionsFeed";
import type { OrgSummary } from "../orgTypes";

afterEach(() => cleanup());

const orgs = [
  {
    id: "EU",
    def: { name: "European Union", shortName: "EU" },
    pendingLegislation: [
      { _id: "p1", type: "sanctions", title: "Sanctions: Brazil", closesOnTurn: 210 },
    ],
    activeLegislation: [],
  },
] as unknown as OrgSummary[];

describe("GlobalResolutionsFeed", () => {
  it("renders a pending resolution row linking to the org", () => {
    render(<GlobalResolutionsFeed orgs={orgs} currentTurn={200} />);
    expect(screen.getByText("Sanctions: Brazil")).toBeTruthy();
    expect(screen.getByText(/Voting · 10t left/)).toBeTruthy();
    expect(screen.getByText("Sanctions: Brazil").closest("a")?.getAttribute("href")).toBe(
      "/world/international-organizations/eu"
    );
  });

  it("shows an empty state when there are no resolutions", () => {
    render(<GlobalResolutionsFeed orgs={[]} currentTurn={200} />);
    expect(screen.getByText("No resolutions across organizations.")).toBeTruthy();
  });

  it("paginates to 10 rows per page", () => {
    const big = [
      {
        id: "EU",
        def: { name: "European Union", shortName: "EU" },
        pendingLegislation: Array.from({ length: 14 }, (_, i) => ({
          _id: `p${i}`,
          type: "directive",
          title: `Resolution ${i}`,
          closesOnTurn: 300 + i, // ascending close → stable order p0..p13
        })),
        activeLegislation: [],
      },
    ] as unknown as OrgSummary[];

    render(<GlobalResolutionsFeed orgs={big} currentTurn={200} />);
    // Page 1: first 10 (Resolution 0..9), not 10..13.
    expect(screen.getByText("Resolution 0")).toBeTruthy();
    expect(screen.getByText("Resolution 9")).toBeTruthy();
    expect(screen.queryByText("Resolution 10")).toBeNull();
    expect(screen.getByText(/Page 1 \/ 2/)).toBeTruthy();

    fireEvent.click(screen.getByText("Next"));
    // Page 2: the remaining 4.
    expect(screen.getByText("Resolution 10")).toBeTruthy();
    expect(screen.getByText("Resolution 13")).toBeTruthy();
    expect(screen.queryByText("Resolution 0")).toBeNull();
    expect(screen.getByText(/Page 2 \/ 2/)).toBeTruthy();
  });
});
