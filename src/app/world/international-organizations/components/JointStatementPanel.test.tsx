/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { JointStatementPanel } from "./JointStatementPanel";
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

describe("JointStatementPanel", () => {
  it("opens the form with subject + stance pickers", () => {
    render(
      <JointStatementPanel
        org={baseOrg}
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );
    expect(screen.getByText("Joint statements")).toBeTruthy();
    fireEvent.click(screen.getByText("Table statement"));
    expect(screen.getByText(/Subject country/i)).toBeTruthy();
    expect(screen.getByText("Endorse (+ approval)")).toBeTruthy();
    expect(screen.getByText("Condemn (− approval)")).toBeTruthy();
  });

  it("shows an active condemnation with its subject and lift countdown", () => {
    const org = {
      ...baseOrg,
      activeLegislation: [
        {
          _id: "leg1",
          type: "joint_statement",
          jointStatementSubjectCountryId: "BR",
          jointStatementStance: "condemn",
          jointStatementExpiresOnTurn: 220,
          title: "UN Condemnation of Brazil",
          votes: [],
          closesOnTurn: 200,
          proposedByCharacterName: "Amb. Smith",
        },
      ],
    } as unknown as OrgSummary;
    render(
      <JointStatementPanel
        org={org}
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );
    expect(screen.getByText(/Condemnation of Brazil/i)).toBeTruthy();
    expect(screen.getByText(/Lifts in 20 turns/i)).toBeTruthy();
  });
});
