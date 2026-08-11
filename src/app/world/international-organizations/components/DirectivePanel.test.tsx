/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DirectivePanel } from "./DirectivePanel";
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
  id: "EU",
  def: {
    id: "EU",
    name: "European Union",
    shortName: "EU",
    description: "",
    logoPath: null,
    foundingMembers: ["DE"],
    leadership: { title: "President", termTurns: 96 },
    charter: "",
    category: "economic",
  },
  members: [
    { countryId: "DE", countryName: "Germany", flagEmoji: "🇩🇪", status: "founding", joinedTurn: 0 },
  ],
  pendingMembershipProposals: [],
  pendingLegislation: [],
  activeLegislation: [],
  pendingWithdrawalMeasures: [],
  leadership: null,
  pendingLeadershipElections: [],
  identity: resolveOrgIdentity("EU", false, "European Union", "economic"),
  derived: { members: [], worldEconomySharePct: 50, notionalBudgetMillions: 0, yourInfluence: 0 },
  fund: { balanceLocal: 0, duesRateAnnual: 0.00006, currencyCode: "USD", currencyCountryId: "US" },
} as unknown as OrgSummary;

const viewer = {
  characterId: "c1",
  foreignMinisterOf: "DE",
  foreignMinisterCountryName: "Germany",
  headOfGovernmentOf: null,
  headOfGovernmentCountryName: null,
  diplomaticActionsRemaining: 3,
  diplomaticActionsPerTurn: 4,
  diplomaticActionsCountryId: "DE",
} as unknown as OrgViewerInfo;

describe("DirectivePanel", () => {
  it("opens the form and lists catalog directives", () => {
    render(
      <DirectivePanel
        org={baseOrg}
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );
    expect(screen.getByText("Directives")).toBeTruthy();
    fireEvent.click(screen.getByText("Table directive"));
    expect(screen.getByText("Productivity Compact")).toBeTruthy();
  });

  it("shows an active directive with its label and lift countdown", () => {
    const org = {
      ...baseOrg,
      activeLegislation: [
        {
          _id: "leg1",
          type: "directive",
          directiveKey: "green_transition",
          directiveExpiresOnTurn: 296,
          title: "EU Directive: Green Transition Directive",
          votes: [],
          closesOnTurn: 200,
          proposedByCharacterName: "Klaus",
        },
      ],
    } as unknown as OrgSummary;
    render(
      <DirectivePanel
        org={org}
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );
    expect(screen.getByText("Green Transition Directive")).toBeTruthy();
    expect(screen.getByText(/Lifts in 96 turns/i)).toBeTruthy();
  });
});
