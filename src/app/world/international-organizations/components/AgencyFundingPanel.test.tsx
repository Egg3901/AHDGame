/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AgencyFundingPanel } from "./AgencyFundingPanel";
import { resolveOrgIdentity } from "@/lib/constants/orgIdentity";
import type { OrgSummary, OrgViewerInfo } from "../orgTypes";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const baseOrg = {
  id: "UN",
  def: {
    id: "UN",
    name: "United Nations",
    shortName: "UN",
    description: "",
    logoPath: null,
    foundingMembers: ["US"],
    leadership: { title: "Secretary-General", termTurns: 96 },
    charter: "",
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
  ],
  pendingMembershipProposals: [],
  pendingLegislation: [],
  activeLegislation: [],
  pendingWithdrawalMeasures: [],
  leadership: null,
  pendingLeadershipElections: [],
  identity: resolveOrgIdentity("UN", false, "United Nations", "political"),
  derived: { members: [], worldEconomySharePct: 50, notionalBudgetMillions: 0, yourInfluence: 0 },
  fund: {
    balanceLocal: 90_000_000,
    duesRateAnnual: 0.00006,
    currencyCode: "USD",
    currencyCountryId: "US",
  },
  posture: "standard",
  defensePctByCountry: {},
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

describe("AgencyFundingPanel", () => {
  it("opens the form and lists catalog agencies", () => {
    render(
      <AgencyFundingPanel
        org={baseOrg}
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );
    expect(screen.getByText("Agency funding")).toBeTruthy();
    fireEvent.click(screen.getByText("Fund an agency"));
    expect(screen.getByText(/Humanitarian Relief Agency/)).toBeTruthy();
  });

  it("shows a funded agency with a lapse countdown", () => {
    const org = {
      ...baseOrg,
      activeLegislation: [
        {
          _id: "ag1",
          type: "fund_agency",
          agencyKey: "climate_fund",
          agencyExpiresOnTurn: 240,
          title: "UN Agency Funding: Climate Fund",
          votes: [],
          closesOnTurn: 200,
          proposedByCharacterName: "Amb. Smith",
        },
      ],
    } as unknown as OrgSummary;
    render(
      <AgencyFundingPanel
        org={org}
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );
    expect(screen.getByText("Climate Fund")).toBeTruthy();
    expect(screen.getByText(/Lapses in 40 turns/i)).toBeTruthy();
  });
});
