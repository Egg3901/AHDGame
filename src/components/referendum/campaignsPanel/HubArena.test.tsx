/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HubArena } from "./HubArena";

describe("HubArena", () => {
  it("renders a split bar with both shares, linked", () => {
    render(
      <HubArena
        countryId="UK"
        campaigns={[
          {
            regionId: "NIR",
            regionName: "Northern Ireland",
            kind: "reunification",
            status: "campaigning",
            yesShare: 57,
            pollHistory: [],
            positionCounts: { for: 0, against: 0, undeclared: 0 },
            closeInTurns: 24,
          },
        ]}
      />
    );
    expect(screen.getByRole("link", { name: /Northern Ireland/i }).getAttribute("href")).toBe(
      "/country/uk/referendums/nir"
    );
    expect(screen.getByText("57%")).toBeTruthy();
    expect(screen.getByText("43%")).toBeTruthy();
  });
});
