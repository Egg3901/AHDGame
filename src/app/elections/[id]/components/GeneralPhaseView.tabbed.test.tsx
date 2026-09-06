/** @vitest-environment happy-dom */
/**
 * Each detail view appears once.
 *
 * Folding the map, the trends chart, the state drivers and the factor ledger
 * into tabs means each one moved from a stack down the page into a pane. A
 * move that suppresses the original in one place and not another leaves the
 * page rendering it twice, which is what happened to the trends chart: the
 * pane was added and the panel was never told to stop drawing its own.
 *
 * The page-level test cannot see this — it mocks this component away — so the
 * count belongs here, where both copies are in scope.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ElectionDetail } from "./ElectionDetailTypes";

vi.mock("./PresidentialMapWithStateDetail", () => ({
  PresidentialMapWithStateDetail: () => <div data-testid="electoral-map" />,
}));
vi.mock("@/app/political-operations/components/StateOrganizationTab", () => ({
  StateOrganizationTab: () => <div data-testid="presence" />,
}));
vi.mock("./ElectionDetailCharts", () => ({
  GeneralVoteCharts: () => <div data-testid="trends" />,
}));
vi.mock("./GeneralElectionShellClient", () => ({
  GeneralElectionShellClient: () => <div data-testid="drivers" />,
}));
vi.mock("@/components/elections/general/FactorLedgerCard", () => ({
  FactorLedgerCard: () => <div data-testid="ledger" />,
}));
vi.mock("@/components/elections/general/NationalMoodGauge", () => ({
  NationalMoodGauge: () => <div data-testid="mood" />,
}));
vi.mock("./RunningMateSelector", () => ({
  RunningMateSelector: () => <div data-testid="running-mate" />,
}));
vi.mock("./GeneralElectionPanel", () => ({
  // Stands in for the tally panel, which draws its own copy of the charts
  // unless it is told not to.
  GeneralElectionPanel: (props: { showTrends?: boolean }) => (
    <div data-testid="panel">
      {props.showTrends !== false ? <div data-testid="trends" /> : null}
    </div>
  ),
  GeneralElectionNoTallyPanel: () => <div data-testid="no-tally-panel" />,
}));

import { GeneralPhaseView } from "./GeneralPhaseView";

function election(): ElectionDetail {
  return {
    id: "e1",
    electionType: "president",
    countryId: "US",
    state: null,
    inPrimary: false,
    isEnded: false,
    isUpcoming: false,
    electionYear: 1957,
    allCandidates: [],
    byParty: [],
    myCharId: "ch1",
    partyDisplayById: {},
    regByState: {},
    generalVotes: {
      totalVotes: {},
      candidateNames: { c1: "First Ticket" },
      candidateColors: {},
      candidateParties: {},
      turnSnapshots: [],
      evByTurn: [],
      stateVoteData: {},
      evByState: { CA: 54 },
    },
  } as unknown as ElectionDetail;
}

function renderView(tabbed: boolean) {
  return render(
    <GeneralPhaseView
      election={election()}
      electionId="e1"
      localInPrimary={false}
      localIsEnded={false}
      amInRace={false}
      onSuccess={() => {}}
      tabbedDetail={tabbed}
    />
  );
}

describe("folding the detail views into tabs", () => {
  it("draws the trends chart once, not once per home it has had", () => {
    renderView(true);
    expect(screen.getAllByTestId("trends")).toHaveLength(1);
  });

  it("draws the factor ledger once", () => {
    renderView(true);
    expect(screen.getAllByTestId("ledger")).toHaveLength(1);
  });

  it("draws the state drivers once", () => {
    renderView(true);
    expect(screen.getAllByTestId("drivers")).toHaveLength(1);
  });

  it("draws the electoral map once", () => {
    renderView(true);
    expect(screen.getAllByTestId("electoral-map")).toHaveLength(1);
  });

  it("offers every view as a tab", () => {
    renderView(true);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Electoral",
      "Campaign presence",
      "Trends",
      "State drivers",
      "Factor ledger",
    ]);
  });

  it("leaves naming a running mate to the campaign page", () => {
    // The campaign page carries the same control against the same route, and
    // this one sat between two analysis views that have nothing to do with
    // managing a ticket.
    renderView(true);
    expect(screen.queryByTestId("running-mate")).toBeNull();
  });

  it("leaves the stacked layout alone when it is not asked to fold", () => {
    // Down-ballot races and every other caller keep the page they had.
    renderView(false);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getAllByTestId("trends")).toHaveLength(1);
    expect(screen.getAllByTestId("ledger")).toHaveLength(1);
  });
});
