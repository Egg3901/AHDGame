/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HubBriefing } from "./HubBriefing";
import type { HubCampaign } from "./HubCards";

describe("HubBriefing", () => {
  it("renders a dense row with standing + a flat (inert) trend", () => {
    const { container } = render(
      <HubBriefing
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
    expect(screen.getByRole("link", { name: /Northern Ireland/i })).toBeTruthy();
    expect(screen.getByText(/57/)).toBeTruthy();
    // Empty history: a baseline line, no data path drawn.
    expect(container.querySelector("svg line")).toBeTruthy();
    expect(container.querySelector('[data-ref="spark-line"]')).toBeNull();
  });

  it("draws the trend polyline and an up-arrow momentum when history accrues", () => {
    const c: HubCampaign = {
      regionId: "NIR",
      regionName: "Northern Ireland",
      kind: "reunification",
      status: "campaigning",
      yesShare: 56,
      closeInTurns: 12,
      pollHistory: [
        { turn: 1, yesShare: 50 },
        { turn: 2, yesShare: 53 },
        { turn: 3, yesShare: 56 },
      ],
      positionCounts: { for: 0, against: 0, undeclared: 0 },
    };
    const { container, getByText } = render(<HubBriefing countryId="UK" campaigns={[c]} />);
    expect(container.querySelector('[data-ref="spark-line"]')).toBeTruthy();
    expect(getByText(/▲/)).toBeTruthy();
  });
});
