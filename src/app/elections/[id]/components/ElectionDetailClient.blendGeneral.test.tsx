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
vi.mock("@/hooks/useGameEvents", () => ({
  useGameTurnStatus: () => null,
  useGameEvents: () => undefined,
}));

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
vi.mock("./CampaignsListPanel", () => ({
  CampaignsListPanel: () => <div data-testid="campaigns-list" />,
}));
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
  it("renders the stage and none of the old page below it", () => {
    // The old "Also on this race" block repeated the stage: a second map, the
    // trends, the schedule. The stage carries the race now.
    const { getByTestId, queryByTestId } = renderPage();
    expect(getByTestId("hero")).toBeTruthy();
    expect(queryByTestId("general-phase")).toBeNull();
    expect(queryByTestId("schedule")).toBeNull();
    expect(generalPhaseProps).toHaveLength(0);
  });

  it("drops the Your Campaign card, which the campaigns list already covers", () => {
    // It repeated the funds, actions and levels shown against your own row in
    // that list, behind a second link to the same page.
    const { queryByTestId } = renderPage();
    expect(queryByTestId("campaign-manager")).toBeNull();
  });

  it("leaves campaign operations to the hero's tickets table", () => {
    // They were a separate list at the foot of this block, restating the
    // tickets above it. They are columns of that table now.
    const { queryByTestId } = renderPage();
    expect(queryByTestId("campaigns-list")).toBeNull();
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
