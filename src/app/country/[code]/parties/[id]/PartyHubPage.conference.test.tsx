/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PartyHubPage } from "./PartyHubPage";

let query = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(query),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/country/uk/parties/2",
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    username: "member-one",
    isAdmin: false,
    hasCharacter: true,
    character: { id: "char-1", party: "2", homeState: "LON", countryId: "UK" },
    ...overrides,
  };
}

function makeParty(overrides: Record<string, unknown> = {}) {
  return {
    id: "2",
    name: "Conservative Party",
    abbreviation: "CON",
    color: "#0087DC",
    economicPosition: 2,
    socialPosition: 2,
    chair: null,
    viceChair: null,
    treasurer: null,
    campaigners: [],
    committeeIds: [],
    treasury: 0,
    nationalTaxRate: 0,
    expectedHourlyIncome: 0,
    gotvBudgetPercent: 0,
    gotvEstimatedSpend: 0,
    gotvTargetCategory: null,
    gotvTargetGroup: null,
    suppressionBudgetPercent: 0,
    suppressionEstimatedSpend: 0,
    suppressionTargetCategory: null,
    suppressionTargetGroup: null,
    registrationBudgetPercent: 0,
    registrationEstimatedSpend: 0,
    transferReserveAmount: 0,
    memberSupportReserveAmount: 0,
    nppRecruitmentReserveAmount: 0,
    treasuryPreset: "balanced",
    totalReserveTarget: 0,
    discretionaryTreasury: 0,
    netHourlyTreasuryChange: 0,
    turnsUntilZero: null,
    turnsUntilReserveFloor: null,
    turnsToReachReserveFloor: null,
    politicalStrength: 0,
    effectivePsCap: 100,
    nppActionPoints: 0,
    nppActionPointCap: 0,
    nppActionPointRegen: 0,
    psInvestmentBudget: 0,
    totalBonusActions: 0,
    memberCount: 1,
    isDefault: true,
    countryId: "UK",
    members: [{ id: "char-1", name: "Member One", homeState: "LON", currentOffice: null }],
    ...overrides,
  };
}

function makeConferenceState() {
  return {
    conferenceId: "UK:2:1",
    year: 1,
    status: "scheduled",
    partyName: "Conservative Party",
    isNpp: false,
    opensAtTurn: 100,
    votingClosesTurn: 120,
    turnsUntilOpen: 5,
    turnsUntilClose: 25,
    proposal: null,
    motions: [],
    platform: null,
    ratified: false,
    outcome: null,
    payoff: { due: false, appliedTurn: null },
    catalog: [],
    capabilities: {
      isPartyMember: true,
      isCommitteeMember: false,
      isLeader: false,
      canPropose: false,
      canVote: true,
    },
    history: [],
  };
}

function stubHub(opts: {
  user?: unknown;
  party?: unknown;
  conference?: unknown;
  stateParty?: unknown;
}) {
  const handler = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    if (u === "/api/auth/me") return { ok: true, json: async () => ({ user: opts.user }) };
    if (u === "/api/country/uk/parties/2" && (init.method ?? "GET") === "GET") {
      return { ok: true, json: async () => opts.party };
    }
    if (u === "/api/country/us/parties/2" && (init.method ?? "GET") === "GET") {
      return { ok: true, json: async () => opts.party };
    }
    if (u === "/api/country/uk/parties/2/conference") {
      return { ok: true, json: async () => opts.conference };
    }
    if (u.includes("/region/") && u.endsWith("/party/2")) {
      return { ok: true, json: async () => ({ stateParty: opts.stateParty }) };
    }
    if (u.endsWith("/election")) {
      return { ok: true, json: async () => ({ isCandidate: {} }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", handler);
  return handler;
}

afterEach(() => {
  // Unmount effects before restoring fetch so delayed work stays isolated.
  cleanup();
  query = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PartyHubPage conference tab (issue #862)", () => {
  it("shows the Conference tab on UK national hubs and opens the panel on click", async () => {
    stubHub({ user: makeUser(), party: makeParty(), conference: makeConferenceState() });
    render(<PartyHubPage scope={{ kind: "national", countryCode: "uk", partyId: "2" }} />);

    const tab = await screen.findByRole("button", { name: "Conference" });
    expect(tab).toBeTruthy();
    // The leadership tab (#861) and the core tabs are untouched.
    expect(screen.getByRole("button", { name: "Leadership" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Overview" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Elections" })).toBeTruthy();

    fireEvent.click(tab);
    expect(await screen.findByText(/Conservative Party conference 1: Scheduled/)).toBeTruthy();
  });

  it("deep-links ?tab=conference on UK national hubs", async () => {
    query = "tab=conference";
    stubHub({ user: makeUser(), party: makeParty(), conference: makeConferenceState() });
    render(<PartyHubPage scope={{ kind: "national", countryCode: "uk", partyId: "2" }} />);

    expect(await screen.findByText(/Conservative Party conference 1: Scheduled/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Conference" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
  });

  it("hides the Conference and Leadership tabs on US national hubs without altering core tabs", async () => {
    stubHub({
      user: makeUser({ character: { id: "char-1", party: "2", homeState: "CA", countryId: "US" } }),
      party: makeParty({ countryId: "US", name: "American Party" }),
    });
    render(<PartyHubPage scope={{ kind: "national", countryCode: "us", partyId: "2" }} />);

    // Observe the complete expected tab state in one retryable assertion
    // rather than treating a single tab as readiness for all the others (#2190).
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Overview" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Conference" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Leadership" })).toBeNull();
      expect(screen.getByRole("button", { name: "Elections" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Treasury" })).toBeTruthy();
    });
  });

  it("hides the Conference tab from viewers outside the UK party", async () => {
    stubHub({
      user: makeUser({
        character: { id: "char-9", party: "9", homeState: "LON", countryId: "UK" },
      }),
      party: makeParty(),
    });
    render(<PartyHubPage scope={{ kind: "national", countryCode: "uk", partyId: "2" }} />);

    expect(await screen.findByRole("button", { name: "Overview" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Conference" })).toBeNull());
  });

  it("shows no Conference tab on UK regional (state-scope) hubs", async () => {
    stubHub({
      user: makeUser(),
      stateParty: {
        _id: "sp-1",
        stateId: "LON",
        stateName: "London",
        countryId: "UK",
        politicalLean: 0,
        statePopulation: 1000,
        partyId: "2",
        partyName: "Conservative Party",
        partyColor: "#0087DC",
        partyAbbreviation: "CON",
        isDefault: true,
        organization: 0,
        treasury: 0,
        stateTaxRate: 0,
        nationalTaxRate: 0,
        expectedHourlyIncome: 0,
        gotvBudgetPercent: 0,
        gotvEstimatedSpend: 0,
        gotvTargetCategory: null,
        gotvTargetGroup: null,
        suppressionBudgetPercent: 0,
        suppressionEstimatedSpend: 0,
        suppressionTargetCategory: null,
        suppressionTargetGroup: null,
        orgBuildingPercent: 0,
        orgBuildingEstimatedSpend: 0,
        psInvestmentBudget: 0,
        hasPresence: true,
        transferReserveAmount: 0,
        memberCount: 1,
        politicalStrength: 0,
        chair: null,
        viceChair: null,
        nationalChairId: null,
        nationalViceChairId: null,
        members: [{ id: "char-1", name: "Member One", homeState: "LON", currentOffice: null }],
      },
    });
    render(
      <PartyHubPage
        scope={{ kind: "state", countryCode: "uk", partyId: "2", stateId: "LON", regionId: "LON" }}
      />
    );

    expect(await screen.findByRole("button", { name: "Overview" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Conference" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Leadership" })).toBeNull();
  });

  it("ignores ?tab=conference for non-UK parties", async () => {
    query = "tab=conference";
    stubHub({
      user: makeUser({ character: { id: "char-1", party: "2", homeState: "CA", countryId: "US" } }),
      party: makeParty({ countryId: "US", name: "American Party" }),
    });
    render(<PartyHubPage scope={{ kind: "national", countryCode: "us", partyId: "2" }} />);

    expect(await screen.findByRole("button", { name: "Overview" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Conference" })).toBeNull();
    expect(screen.queryByText(/conference 1:/)).toBeNull();
  });
});
