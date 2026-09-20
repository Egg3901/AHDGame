/** @vitest-environment happy-dom */
/**
 * Presidential races must keep a way back into their own history.
 *
 * The Blend rebuild gave the presidential primary, general and results screens
 * early returns of their own. Each one bypasses the legacy layout at the bottom
 * of `ElectionDetailClient`, which is the only place `<ElectionNavigation>` was
 * ever rendered, so Previous/Next silently vanished from every presidential
 * page. The elections list serves `status: upcoming,active` only, so with the
 * buttons gone a concluded cycle had no route in at all.
 *
 * The second test here pins the companion defect. A Previous/Next link carries
 * the seat-id form (`/elections/US-president?cycle=3`), so the route param on a
 * historical page is `US-president`, not an ObjectId. The results endpoint
 * rejects a non-ObjectId id with a 400, which dropped every past race back to
 * the plain summary view. The fetch has to key off the resolved `election.id`.
 */
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { ElectionDetail } from "./ElectionDetailTypes";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("cycle=3"),
}));
vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/hooks/useGameEvents", () => ({ useGameTurnStatus: () => null }));

// The subject is the navigation, so every heavy block on the page renders
// nothing. `ElectionNavigation` is deliberately NOT mocked — the assertions
// are about its real output.
// Each carries a testid so an assertion can pin the nav to the SAME render as
// the Blend screen. Without that the concluded case is a race: the page paints
// the legacy layout (which has always had the nav) while the results payload is
// still in flight, so a bare `findByText` can resolve against the wrong paint
// and pass whether or not the fix is present.
vi.mock("../blend/GeneralBlendView", () => ({
  GeneralBlendView: () => <div data-testid="blend-general" />,
}));
vi.mock("../blend/PrimaryBlendView", () => ({
  PrimaryBlendView: () => <div data-testid="blend-primary" />,
}));
vi.mock("../blend/ResultsBlendView", () => ({
  ResultsBlendView: () => <div data-testid="blend-results" />,
}));
vi.mock("./GeneralPhaseView", () => ({ GeneralPhaseView: () => null }));
vi.mock("./ElectionScheduleCard", () => ({ ElectionScheduleCard: () => null }));
vi.mock("./ElectionHeader", () => ({ ElectionHeader: () => null }));
vi.mock("./AdminSection", () => ({ AdminSection: () => null }));
vi.mock("./CampaignsListPanel", () => ({ CampaignsListPanel: () => null }));
vi.mock("./CampaignManagerTab", () => ({ CampaignManagerTab: () => null }));
vi.mock("./PrimaryMapPills", () => ({ PrimaryMapPills: () => null }));
vi.mock("./PresidentialMapWithStateDetail", () => ({
  PresidentialMapWithStateDetail: () => null,
}));
vi.mock("@/app/political-operations/components/StateOrganizationTab", () => ({
  StateOrganizationTab: () => null,
}));

import { ElectionDetailClient } from "./ElectionDetailClient";

const ELECTION_OID = "69b5b04bdf051bb43fc957b7";

function election(over: Partial<ElectionDetail> = {}): ElectionDetail {
  return {
    id: ELECTION_OID,
    electionType: "president",
    countryId: "US",
    state: "US",
    status: "resolved",
    inPrimary: false,
    inGeneral: false,
    isEnded: true,
    isUpcoming: false,
    allCandidates: [],
    byParty: [],
    myCharId: "ch1",
    generalVotes: null,
    prevElectionId: "US-president?cycle=2",
    nextElectionId: "US-president?cycle=4",
    ...over,
  } as unknown as ElectionDetail;
}

/**
 * The race the stubbed detail endpoint should echo back. A poll that answered
 * with the default concluded race would flip the primary and general cases out
 * of the screen under test.
 */
let currentElection: ElectionDetail = election();
let resultsElectionId = ELECTION_OID;

/** The route param is the seat-id form a Previous/Next link produces. */
function renderPage(over: Partial<ElectionDetail> = {}) {
  currentElection = election(over);
  return render(<ElectionDetailClient id="US-president" initialElection={currentElection} />);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resultsElectionId = ELECTION_OID;
  // URL-aware on purpose. The page hits three endpoints with three different
  // shapes, and a single blanket stub hands the detail endpoint a results-
  // shaped body, so `election.allCandidates` comes back undefined and the
  // component throws on the next poll. That crash is a stub artefact, not a
  // product defect, and it silently masked what these tests are here to check.
  fetchMock = vi.fn(async (url: string) => {
    const href = String(url);
    if (href.includes("/results")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          election: { id: resultsElectionId, electionType: "president", status: "resolved" },
          candidates: [],
          units: [],
          national: null,
          summary: { totalVotes: 0, unitsReporting: 0, totalUnits: 0, unitsCalled: 0 },
        }),
      };
    }
    if (href.includes("/wire")) {
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
    // The detail endpoint, whose body the client remaps onto `allCandidates`.
    return {
      ok: true,
      status: 200,
      json: async () => ({ election: { ...currentElection, candidates: [] } }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("Previous/Next on the presidential screens", () => {
  it("renders both buttons on the concluded results screen", async () => {
    const { findByTestId, getByText } = renderPage();
    // Wait for the Blend screen itself, then assert the nav is in that render.
    await findByTestId("blend-results");
    expect(getByText("Previous")).toBeTruthy();
    expect(getByText("Next")).toBeTruthy();
  });

  it("renders both buttons on the general screen", async () => {
    const { findByTestId, getByText } = renderPage({
      isEnded: false,
      inGeneral: true,
      status: "active",
    });
    await findByTestId("blend-general");
    expect(getByText("Previous")).toBeTruthy();
    expect(getByText("Next")).toBeTruthy();
  });

  it("renders both buttons on the primary screen", async () => {
    const { findByTestId, getByText } = renderPage({
      isEnded: false,
      inPrimary: true,
      status: "active",
    });
    await findByTestId("blend-primary");
    expect(getByText("Previous")).toBeTruthy();
    expect(getByText("Next")).toBeTruthy();
  });

  it("points Previous at the prior cycle from the concluded screen", async () => {
    const { findByTestId, getByText } = renderPage();
    await findByTestId("blend-results");
    expect(getByText("Previous").closest("a")?.getAttribute("href")).toBe(
      "/elections/US-president?cycle=2"
    );
  });
});

describe("loading a historical race's results", () => {
  it("fetches results by the resolved election id, not the seat-id route param", async () => {
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain(`/api/elections/${ELECTION_OID}/results`);
    expect(urls).not.toContain("/api/elections/US-president/results");
  });

  it("does not render a stale results payload for a different race", async () => {
    resultsElectionId = "69b5b04bdf051bb43fc957b8";
    const { queryByTestId } = renderPage();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/results"))).toBe(true)
    );
    expect(queryByTestId("blend-results")).toBeNull();
  });
});
