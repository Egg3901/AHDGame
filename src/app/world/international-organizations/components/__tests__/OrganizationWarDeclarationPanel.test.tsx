/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ObjectId } from "mongodb";
import type { OrgSummary, OrgViewerInfo } from "../../orgTypes";
import { OrganizationWarDeclarationPanel } from "../OrganizationWarDeclarationPanel";

vi.mock("@/lib/hooks/useEnabledCountryIds", () => ({
  useEnabledCountryIds: () => ["US", "UK", "FR", "CN"],
}));

vi.mock("@/contexts/RegisteredCountriesContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts/RegisteredCountriesContext")>();
  return {
    ...actual,
    useCountryDisplayName: () => (countryId: string) =>
      ({ US: "United States", UK: "United Kingdom", FR: "France", CN: "China" })[countryId] ??
      countryId,
  };
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const viewer = {
  characterId: "c1",
  foreignMinisterOf: "US",
  foreignMinisterCountryName: "United States",
  headOfGovernmentOf: null,
  headOfGovernmentCountryName: null,
} as OrgViewerInfo;

function makeOrg(withPending = false): OrgSummary {
  return {
    id: "NATO",
    def: {
      id: "NATO",
      name: "NATO",
      shortName: "NATO",
      description: "",
      logoPath: null,
      foundingMembers: ["US"],
      leadership: { title: "Secretary-General", termTurns: 96 },
      charter: "",
      category: "bloc",
    },
    members: [
      {
        countryId: "US",
        countryName: "United States",
        flagEmoji: "🇺🇸",
        status: "founding",
        joinedTurn: 0,
        hasVote: true,
        hasPolicyVote: true,
        isCountry: true,
      },
      {
        countryId: "UK",
        countryName: "United Kingdom",
        flagEmoji: "🇬🇧",
        status: "active",
        joinedTurn: 0,
        hasVote: true,
        hasPolicyVote: true,
        isCountry: true,
      },
      {
        countryId: "FR",
        countryName: "France",
        flagEmoji: "🇫🇷",
        status: "active",
        joinedTurn: 0,
        hasVote: false,
        hasPolicyVote: false,
        isCountry: true,
      },
    ],
    pendingMembershipProposals: [],
    pendingLegislation: withPending
      ? [
          {
            _id: new ObjectId("68df1c469a61cd10dd231101"),
            organizationId: "NATO",
            type: "declare_war",
            title: "Collective declaration against China",
            proposedByCharacterName: "Secretary",
            proposingCountryId: "US",
            proposedByCharacterId: new ObjectId("68df1c469a61cd10dd231102"),
            proposedAt: new Date("2026-01-01T00:00:00.000Z"),
            proposedOnTurn: 200,
            closesOnTurn: 224,
            parties: [],
            votes: [
              {
                countryId: "US",
                characterId: new ObjectId("68df1c469a61cd10dd231102"),
                characterName: "Secretary",
                vote: "yes",
                castAt: new Date("2026-01-01T00:00:00.000Z"),
                castOnTurn: 200,
              },
            ],
            status: "pending",
            warDeclarationTargetCountryId: "CN",
            warDeclarationGoal: "punitive",
          },
        ]
      : [],
    activeLegislation: [],
    pendingWithdrawalMeasures: [],
    leadership: null,
    pendingLeadershipElections: [],
    identity: {} as OrgSummary["identity"],
    derived: {} as OrgSummary["derived"],
    fund: {
      balanceLocal: 0,
      duesRateAnnual: 0,
      annualDuesLocal: 0,
      currencyCode: "USD",
      currencyCountryId: "US",
    },
    posture: "standard",
    defensePctByCountry: {},
  };
}

function renderPanel(org = makeOrg()) {
  return render(
    <OrganizationWarDeclarationPanel
      org={org}
      viewer={viewer}
      currentTurn={200}
      votingWindowTurns={24}
      onChange={() => {}}
    />
  );
}

describe("OrganizationWarDeclarationPanel", () => {
  it("offers only non-member targets and posts the selected declaration", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /propose declaration/i }));

    expect(screen.queryByRole("option", { name: "United States" })).toBeNull();
    expect(screen.queryByRole("option", { name: "United Kingdom" })).toBeNull();
    expect(screen.queryByRole("option", { name: "France" })).toBeNull();
    expect(screen.getByRole("option", { name: "China" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/target country/i), { target: { value: "CN" } });
    fireEvent.change(screen.getByLabelText(/war goal/i), { target: { value: "punitive" } });
    fireEvent.click(screen.getByRole("button", { name: /submit for a vote/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
      type: "declare_war",
      targetCountryId: "CN",
      warGoal: "punitive",
    });
  });

  it("counts only player ballots while explaining automatic NPP entry", () => {
    renderPanel(makeOrg(true));

    expect(screen.getByText(/1 \/ 2 player nations in favour/)).toBeTruthy();
    expect(screen.getByText(/unanimous player consent required/)).toBeTruthy();
    expect(screen.getByText(/NPP nations join automatically/)).toBeTruthy();
  });
});
