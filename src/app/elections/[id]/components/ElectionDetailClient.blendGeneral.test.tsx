/** @vitest-environment happy-dom */
/**
 * What the Blend general page asks the blocks below it NOT to repeat.
 *
 * The hero at the top of that page already carries the electoral-college bar,
 * each ticket's numbers and the turns remaining. The legacy blocks underneath
 * print all three again, so the page showed the same standing twice — an
 * electoral-vote bar, a "Live Tally" table and a deadline box, each a second
 * copy of something a reader had just scrolled past.
 *
 * The prop defaults are `true`, so the guard that matters is at this call site
 * rather than in the components: a block that stops being told to omit its
 * copy starts printing it again, silently. These tests pin the instruction,
 * not the rendering.
 */
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { ElectionDetail } from "./ElectionDetailTypes";

const generalPhaseProps: Record<string, unknown>[] = [];
const scheduleProps: Record<string, unknown>[] = [];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/hooks/useGameEvents", () => ({ useGameTurnStatus: () => null }));

// The subject is which props these two receive, so they record and render
// nothing. Everything else on the page is stubbed to keep the tree cheap.
vi.mock("./GeneralPhaseView", () => ({
  GeneralPhaseView: (props: Record<string, unknown>) => {
    generalPhaseProps.push(props);
    return <div data-testid="general-phase" />;
  },
}));
vi.mock("./ElectionScheduleCard", () => ({
  ElectionScheduleCard: (props: Record<string, unknown>) => {
    scheduleProps.push(props);
    return <div data-testid="schedule" />;
  },
}));
vi.mock("../blend/GeneralBlendView", () => ({
  GeneralBlendView: () => <div data-testid="hero" />,
}));
vi.mock("./PresidentialMapWithStateDetail", () => ({
  PresidentialMapWithStateDetail: () => <div data-testid="electoral-map" />,
}));
vi.mock("./ElectionHeader", () => ({ ElectionHeader: () => null }));
vi.mock("./AdminSection", () => ({ AdminSection: () => null }));
vi.mock("./CampaignsListPanel", () => ({ CampaignsListPanel: () => null }));
vi.mock("./CampaignManagerTab", () => ({
  CampaignManagerTab: () => <div data-testid="campaign-manager" />,
}));
vi.mock("@/app/political-operations/components/StateOrganizationTab", () => ({
  StateOrganizationTab: () => null,
}));
vi.mock("../blend/PrimaryBlendView", () => ({ PrimaryBlendView: () => null }));
vi.mock("../blend/ResultsBlendView", () => ({ ResultsBlendView: () => null }));

import { ElectionDetailClient } from "./ElectionDetailClient";

function election(over: Partial<ElectionDetail> = {}): ElectionDetail {
  return {
    id: "e1",
    electionType: "president",
    countryId: "US",
    inPrimary: false,
    isEnded: false,
    isUpcoming: false,
    allCandidates: [],
    byParty: [],
    myCharId: "ch1",
    generalVotes: null,
    ...over,
  } as unknown as ElectionDetail;
}

function renderPage(over: Partial<ElectionDetail> = {}) {
  return render(<ElectionDetailClient id="e1" initialElection={election(over)} />);
}

beforeEach(() => {
  generalPhaseProps.length = 0;
  scheduleProps.length = 0;
  // The client polls the wire and the results route on mount. Nothing here
  // depends on either, and an unstubbed fetch reaches for a real socket.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

describe("the Blend general page does not print the same standing twice", () => {
  it("renders the hero and the blocks below it", () => {
    const { getByTestId } = renderPage();
    expect(getByTestId("hero")).toBeTruthy();
    expect(getByTestId("general-phase")).toBeTruthy();
    expect(getByTestId("schedule")).toBeTruthy();
  });

  it("tells the general phase view to leave out the college bar and the tally", () => {
    renderPage();
    expect(generalPhaseProps).toHaveLength(1);
    expect(generalPhaseProps[0].showCollegeSummary).toBe(false);
  });

  it("asks the general phase view to fold its detail views into tabs", () => {
    // The map, campaign presence, the trends chart, the state drivers and the
    // factor ledger used to run down the page one after another.
    renderPage();
    expect(generalPhaseProps[0].tabbedDetail).toBe(true);
  });

  it("drops the Your Campaign card, which the campaigns list already covers", () => {
    // It repeated the funds, actions and levels shown against your own row in
    // that list, behind a second link to the same page.
    const { queryByTestId } = renderPage();
    expect(queryByTestId("campaign-manager")).toBeNull();
  });

  it("tells the general phase view to leave out the national mood gauge", () => {
    // The rail states the same figure and now carries the same components, so
    // the card below repeated a number whose neighbouring bars were a
    // different quantity entirely.
    renderPage();
    expect(generalPhaseProps[0].showNationalMood).toBe(false);
  });

  it("tells the schedule card to leave out its deadline strip", () => {
    renderPage();
    expect(scheduleProps).toHaveLength(1);
    expect(scheduleProps[0].showStatusStrip).toBe(false);
  });

  it("leaves both blocks whole on a race with no Blend hero above them", () => {
    // A down-ballot general has no college and keeps the existing view, so
    // nothing has been said above and both blocks state it themselves. The
    // omissions must not leak into the pages that still need these blocks.
    renderPage({ electionType: "senate", state: "PA" } as Partial<ElectionDetail>);
    for (const props of generalPhaseProps) {
      expect(props.showCollegeSummary).not.toBe(false);
      expect(props.showNationalMood).not.toBe(false);
      expect(props.tabbedDetail).not.toBe(true);
    }
    for (const props of scheduleProps) {
      expect(props.showStatusStrip).not.toBe(false);
    }
  });
});
