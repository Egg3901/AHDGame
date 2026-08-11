/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PosturePanel } from "./PosturePanel";
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
    category: "security",
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
  identity: resolveOrgIdentity("NATO", false, "NATO", "security"),
  derived: { members: [], worldEconomySharePct: 50, notionalBudgetMillions: 0, yourInfluence: 0 },
  fund: { balanceLocal: 0, duesRateAnnual: 0.00006, currencyCode: "USD", currencyCountryId: "US" },
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

describe("PosturePanel", () => {
  it("shows the current posture and opens the propose form", () => {
    render(
      <PosturePanel
        org={baseOrg}
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );
    expect(screen.getByText("Alert posture")).toBeTruthy();
    fireEvent.click(screen.getByText("Propose posture change"));
    expect(screen.getByText(/Propose an alert posture/i)).toBeTruthy();
  });

  it("renders a pending posture vote with its target", () => {
    const org = {
      ...baseOrg,
      pendingLegislation: [
        {
          _id: "leg1",
          type: "set_posture",
          postureValue: "article5",
          title: "NATO Alert Posture: Article 5",
          votes: [],
          closesOnTurn: 210,
          proposedByCharacterName: "Amb. Smith",
        },
      ],
    } as unknown as OrgSummary;
    render(
      <PosturePanel
        org={org}
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );
    expect(screen.getByText("Move to Article 5")).toBeTruthy();
  });
});
