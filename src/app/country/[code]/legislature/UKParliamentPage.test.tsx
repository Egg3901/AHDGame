/**
 * @vitest-environment happy-dom
 *
 * Focused #860 tab-integration tests: the Vacancies tab on UKParliamentPage
 * mounts the real CommonsVacancyPanel (lazy: no vacancies fetch until the
 * tab opens) and unmounts it when leaving.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UKParliamentPage } from "./UKParliamentPage";

vi.mock("./useUKParliamentPageState", () => ({
  useUKParliamentPageState: () => ({
    government: null,
    activeAppointmentVotes: [],
    activeNoConfidenceVote: null,
    viewerMayAppoint: false,
    viewerMayProposeNoConfidence: false,
    noConfidenceCooldownTurns: 0,
    viewerIsCommonsMp: false,
    viewerVotes: [],
    viewerWhippedFrom: null,
    viewerIsSittingPM: false,
    snapElectionsAllowed: false,
    snapElectionsUsed: 0,
    snapElectionsRemaining: 0,
    snapCooldownTurnsRemaining: 0,
    syncGovernmentData: vi.fn(),
  }),
}));

vi.mock("./components/shared/useLegislatureData", () => ({
  useLegislatureData: () => ({
    members: null,
    bills: {
      bills: [],
      canPropose: false,
      adminOverride: false,
      total: 0,
      page: 1,
      limit: 20,
    },
    leaders: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("@/lib/observability/fetchJson", () => ({
  fetchJson: vi.fn().mockResolvedValue(null),
}));

function okJson(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as Response;
}

const VACANCY_PAYLOAD = {
  currentTurn: 500,
  vacancies: [
    {
      id: "vac1",
      state: "LON",
      constituency: null,
      seats: 1,
      reason: "resignation",
      status: "open",
      vacatedTurn: 490,
      electionId: null,
      scheduledTurn: null,
      priorCharacterName: "Gone MP",
      priorParty: "1",
    },
  ],
  petitions: [],
  elections: [],
  viewer: { officialId: null, state: null },
};

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (typeof url === "string" && url.startsWith("/api/uk/commons/vacancies")) {
      return okJson(VACANCY_PAYLOAD);
    }
    return okJson({});
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("UKParliamentPage vacancies tab", () => {
  it("lists a Vacancies tab but fetches nothing until it opens", async () => {
    const fetchSpy = mockFetch();
    render(<UKParliamentPage countryId="UK" />);

    expect(screen.getByRole("button", { name: "Vacancies" })).toBeTruthy();
    expect(screen.queryByText(/commons vacancies and recall/i)).toBeNull();
    expect(
      fetchSpy.mock.calls.some(
        ([url]) => typeof url === "string" && url.startsWith("/api/uk/commons/vacancies")
      )
    ).toBe(false);
  });

  it("mounts the vacancy panel on click and unmounts it when leaving", async () => {
    mockFetch();
    render(<UKParliamentPage countryId="UK" />);

    fireEvent.click(screen.getByRole("button", { name: "Vacancies" }));
    expect(await screen.findByText(/formerly gone mp/i)).toBeTruthy();
    expect(screen.getByText(/no by-election scheduled yet/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Bills" }));
    expect(screen.queryByText(/formerly gone mp/i)).toBeNull();
  });
});
