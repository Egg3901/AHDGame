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
import { beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("@/components/elections/general/ParticipationLedgerCard", () => ({
  ParticipationLedgerCard: ({ data }: { data?: unknown }) =>
    data ? <div data-testid="participation-ledger" /> : null,
}));
vi.mock("@/components/elections/general/NationalMoodGauge", () => ({
  NationalMoodGauge: () => <div data-testid="mood" />,
}));
vi.mock("@/components/elections/general/DemocraticHealthGauge", () => ({
  DemocraticHealthGauge: () => <div data-testid="democratic-health" />,
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

beforeEach(() => {
  // happy-dom resolves a relative fetch against http://localhost:3000, so an
  // unstubbed one in a component test does not fail — it reaches whatever dev
  // server happens to be running and quietly talks to it. The suite is only
  // hermetic if nothing here opens a socket.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

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

  it("leaves the electoral map to the blend screen's own map", () => {
    renderView(true);
    expect(screen.queryByTestId("electoral-map")).toBeNull();
  });

  it("offers every view as a tab", () => {
    renderView(true);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Campaign presence",
      "Trends",
      "State drivers",
      "Factor ledger",
    ]);
  });

  it("renders just the tab strip when asked for the detail alone", () => {
    const { container } = render(
      <GeneralPhaseView
        election={election()}
        electionId="e1"
        localInPrimary={false}
        localIsEnded={false}
        amInRace={false}
        onSuccess={() => {}}
        tabbedDetail
        detailOnly
      />
    );
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toContain("Factor ledger");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toContain("Campaign presence");
    // Nothing of the tally panel or banners rides along.
    expect(container.querySelector(".space-y-4")).toBeNull();
  });

  it("shows only the tabs that have data during the primary", () => {
    const data = election();
    data.generalVotes = null;
    const { rerender } = render(
      <GeneralPhaseView
        election={data}
        electionId="e1"
        localInPrimary
        localIsEnded={false}
        amInRace={false}
        onSuccess={() => {}}
        tabbedDetail
        detailOnly
      />
    );
    // Presence has no dependency on the tally; the rest would be empty, so the
    // lone pane has no tab strip at all.
    expect(screen.getByTestId("presence")).toBeTruthy();
    expect(screen.queryByTestId("ledger")).toBeNull();
    expect(screen.queryByTestId("trends")).toBeNull();
    expect(screen.queryByTestId("drivers")).toBeNull();

    const withData = {
      ...data,
      factorLedger: { byCandidateNational: [] },
    } as unknown as ElectionDetail;
    rerender(
      <GeneralPhaseView
        election={withData}
        electionId="e1"
        localInPrimary
        localIsEnded={false}
        amInRace={false}
        onSuccess={() => {}}
        tabbedDetail
        detailOnly
      />
    );
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Campaign presence",
      "Factor ledger",
    ]);
  });

  it("adds a turnout tab only when a Method 4 receipt exists", () => {
    const data = election();
    data.generalVotes!.turnSnapshots = [
      {
        turn: 10,
        recordedAt: new Date().toISOString(),
        cumulativeVotes: {},
        sharesPct: {},
        participation: {
          calibrationId: "US-v1",
          baseline: 60,
          salience: 1,
          competitiveness: 2,
          access: -1,
          contact: 3,
          saturation: -0.5,
          resolvedTurnout: 64.5,
          economicSalience: 1,
          socialSalience: 1,
          competitivenessScore: 0.8,
        },
      },
    ];
    render(
      <GeneralPhaseView
        election={data}
        electionId="e1"
        localInPrimary={false}
        localIsEnded={false}
        amInRace={false}
        onSuccess={() => {}}
        tabbedDetail
      />
    );
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toContain("Turnout");
    expect(screen.getAllByTestId("participation-ledger")).toHaveLength(1);
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
