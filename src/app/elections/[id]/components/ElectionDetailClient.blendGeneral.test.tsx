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
vi.mock("@/app/political-operations/components/StateOrganizationTab", () => ({
  StateOrganizationTab: () => <div data-testid="presence-map" />,
}));
vi.mock("../blend/PrimaryBlendView", () => ({
  PrimaryBlendView: () => <div data-testid="primary-stage" />,
}));
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
  it("renders the stage and, below it, only the race detail tabs", () => {
    // The old "Also on this race" block repeated the stage: a second map, the
    // trends, the schedule. What the stage cannot hold (campaign presence,
    // trends, state drivers, turnout, the factor ledger) comes back as the
    // detail-only tab section, and nothing else of the old page does.
    const { getByTestId, queryByTestId } = renderPage();
    expect(getByTestId("hero")).toBeTruthy();
    expect(getByTestId("general-phase")).toBeTruthy();
    expect(queryByTestId("schedule")).toBeNull();
    expect(generalPhaseProps).toHaveLength(1);
    expect(generalPhaseProps[0].tabbedDetail).toBe(true);
    expect(generalPhaseProps[0].detailOnly).toBe(true);
  });

  it("puts only the race detail tabs under the primary stage", () => {
    // The primary used to mount the Campaign Presence builder below the stage,
    // which drew a second US map of its own, plus the campaigns list and a
    // Your Campaign card. The stage map carries presence, the field table
    // carries campaign operations and the rail carries your campaign. The
    // detail-only tab section (presence, factor ledger and so on) is all that
    // joins it, and hides any tab with no data yet.
    const { getByTestId, queryByTestId } = renderPage({ inPrimary: true });
    expect(getByTestId("primary-stage")).toBeTruthy();
    expect(queryByTestId("presence-map")).toBeNull();
    expect(getByTestId("general-phase")).toBeTruthy();
    expect(generalPhaseProps.at(-1)?.detailOnly).toBe(true);
  });

  it("keeps the presence builder on an upcoming race, where nothing else carries it", () => {
    const { getByTestId, queryByTestId } = renderPage({ isUpcoming: true });
    expect(queryByTestId("primary-stage")).toBeNull();
    expect(getByTestId("presence-map")).toBeTruthy();
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
