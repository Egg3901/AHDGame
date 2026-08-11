/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HubCards, type HubCampaign } from "./HubCards";

const campaigns = [
  {
    regionId: "NIR",
    regionName: "Northern Ireland",
    kind: "reunification" as const,
    status: "campaigning" as const,
    yesShare: 57,
    pollHistory: [],
    positionCounts: { for: 0, against: 0, undeclared: 0 },
    closeInTurns: 24,
  },
];

describe("HubCards", () => {
  it("renders a linked card per campaign with the tug-of-war and no bloc footer", () => {
    render(<HubCards countryId="UK" campaigns={campaigns} />);
    const link = screen.getByRole("link", { name: /Northern Ireland/i });
    expect(link.getAttribute("href")).toBe("/country/uk/referendums/nir");
    expect(screen.getByText(/57%/)).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByText(/Vote in 24 turns/i)).toBeTruthy();
    expect(screen.queryByText(/bloc/i)).toBeNull();
  });
});

const rising: HubCampaign = {
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

describe("HubCards momentum", () => {
  it("renders an up arrow for a rising campaign", () => {
    render(<HubCards countryId="UK" campaigns={[rising]} />);
    expect(screen.getByText(/▲/)).toBeTruthy();
  });

  it("falls back to the neutral dash when history is too short", () => {
    render(<HubCards countryId="UK" campaigns={[{ ...rising, pollHistory: [] }]} />);
    expect(screen.queryByText(/▲/)).toBeNull();
  });

  it("renders the bloc footer counts", () => {
    render(
      <HubCards
        countryId="UK"
        campaigns={[{ ...rising, positionCounts: { for: 3, against: 2, undeclared: 1 } }]}
      />
    );
    expect(screen.getByText(/3 For/i)).toBeTruthy();
    expect(screen.getByText(/2 Against/i)).toBeTruthy();
  });
});
