/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PresidentialCandidateTable } from "./PresidentialCandidateTable";
import type { CandidateDetail } from "./ElectionDetailTypes";

// The info icon fetches its contributor breakdown on click; the table
// test only cares that the icon is present beside the figure.
vi.mock("./CsInfoIcon", () => ({
  CsInfoIcon: ({ campaignId }: { campaignId: string | null | undefined }) =>
    campaignId ? <span data-testid="cs-info" /> : null,
}));

function candidate(over: Partial<CandidateDetail> = {}): CandidateDetail {
  return {
    id: "ec1",
    characterId: "ch1",
    characterName: "Sean Oppenheimer",
    party: "1",
    partyName: "Democratic Party",
    partyColor: "#3b82f6",
    partyEcon: 0,
    partySocial: 0,
    isNPP: false,
    nppId: null,
    economicPosition: 0,
    socialPosition: 0,
    favorability: 50,
    politicalInfluence: 0,
    nationalInfluence: 0,
    primaryScore: 0,
    sharePct: 48.2,
    enteredAt: new Date().toISOString(),
    endorsements: [],
    isYou: false,
    campaignId: "camp1",
    campaignStrength: 5920,
    ...over,
  } as CandidateDetail;
}

function renderTable(over: Partial<Parameters<typeof PresidentialCandidateTable>[0]> = {}) {
  return render(
    <PresidentialCandidateTable
      sorted={[candidate()]}
      colorMap={new Map()}
      tally={{ totalVotes: { ec1: 1000 }, turnSnapshots: [] }}
      grandTotal={1000}
      totalVotesCast={1000}
      isEnded={false}
      electoralVotes={{ ec1: 210 }}
      canEndorse={false}
      endorsedCandidateId={null}
      endorsing={false}
      onEndorse={() => {}}
      canSupport
      supporting={false}
      onSupport={() => {}}
      showCampaignStrength
      {...over}
    />
  );
}

describe("campaign strength on a narrow screen", () => {
  it("prints the figure outside the lg-only column", () => {
    // The CS column is `hidden lg:table-cell`, so on a phone the number
    // and its contributors tooltip disappeared while the Support button
    // stayed: you could fund a campaign without being shown what you
    // were funding. The figure therefore also rides under the name, in
    // an element that is NOT inside the desktop-only cell.
    renderTable();
    const figures = screen.getAllByText("5.9k");
    expect(figures.length).toBe(2);

    const mobile = figures.find((el) => el.closest(".lg\\:hidden") != null);
    expect(mobile).toBeDefined();
    // And the desktop copy is still the one in the lg-only column.
    const desktop = figures.find((el) => el.closest("td.lg\\:table-cell") != null);
    expect(desktop).toBeDefined();
  });

  it("shows neither copy for a candidate with no campaign", () => {
    renderTable({ sorted: [candidate({ campaignId: null, campaignStrength: null })] });
    expect(screen.queryByText("5.9k")).toBeNull();
    expect(screen.queryAllByTestId("cs-info")).toHaveLength(0);
  });

  it("shows no campaign strength at all when the race does not use it", () => {
    // Down-ballot races: only the presidential engine reads the stat.
    renderTable({ showCampaignStrength: false });
    expect(screen.queryByText("5.9k")).toBeNull();
  });

  it("prefers a contribution made on this page over the payload figure", () => {
    renderTable({ campaignStrengthOverrides: { camp1: 9100 } });
    const figures = screen.getAllByText("9.1k");
    expect(figures.length).toBe(2);
  });
});
