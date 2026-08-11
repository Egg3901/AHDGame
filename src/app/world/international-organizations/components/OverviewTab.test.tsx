/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { OverviewTab } from "./OverviewTab";
import { BUILTIN_ORG_IDENTITY } from "@/lib/constants/orgIdentity";
import type { OrgSummary, OrgViewerInfo } from "../orgTypes";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const org = {
  id: "UN",
  def: {
    id: "UN",
    name: "United Nations",
    shortName: "UN",
    description: "",
    logoPath: null,
    foundingMembers: ["US"],
    leadership: { title: "Secretary-General", termTurns: 96 },
    charter: "Pledge to maintain peace.",
    category: "political",
  },
  members: [
    {
      countryId: "US",
      countryName: "United States",
      flagEmoji: "🇺🇸",
      status: "founding",
      joinedTurn: 0,
    },
    { countryId: "IE", countryName: "Ireland", flagEmoji: "🇮🇪", status: "active", joinedTurn: 5 },
  ],
  pendingMembershipProposals: [],
  pendingLegislation: [],
  activeLegislation: [],
  pendingWithdrawalMeasures: [],
  leadership: null,
  pendingLeadershipElections: [],
  identity: BUILTIN_ORG_IDENTITY.UN,
  derived: {
    members: [
      { countryId: "US", contributionPct: 0.98, influenceIndex: 100 },
      { countryId: "IE", contributionPct: 0.02, influenceIndex: 2 },
    ],
    worldEconomySharePct: 51,
    notionalBudgetMillions: 137750,
    yourInfluence: 0,
  },
  fund: { balanceLocal: 0, duesRateAnnual: 0.00006, currencyCode: "USD", currencyCountryId: "US" },
} as unknown as OrgSummary;

const viewer = {
  characterId: "c1",
  foreignMinisterOf: "US",
  foreignMinisterCountryName: "United States",
  headOfGovernmentOf: null,
  headOfGovernmentCountryName: null,
  diplomaticActionsRemaining: 3,
  diplomaticActionsPerTurn: 4,
  diplomaticActionsCountryId: "US",
} as unknown as OrgViewerInfo;

describe("OverviewTab", () => {
  it("renders the delegation standing and the member table", () => {
    render(
      <OverviewTab
        org={org}
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );
    expect(screen.getByText(/Members & standing/)).toBeTruthy();
    expect(screen.getAllByText("United States").length).toBeGreaterThan(0);
    expect(screen.getByText(/Your delegation/)).toBeTruthy();
  });
});
