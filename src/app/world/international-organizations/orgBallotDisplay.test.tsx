/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MembershipPanel } from "./MembershipPanel";
import { LeadershipPanel } from "./LeadershipPanel";
import { LegislationPanel } from "./LegislationPanel";
import { resolveOrgIdentity } from "@/lib/constants/orgIdentity";
import type { OrgSummary, OrgViewerInfo } from "./orgTypes";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [] }) })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * A bloc whose roll is US + UK + FR, with Poland a member that holds no ballot.
 * Every panel below must measure its tally against the three, never the four.
 */
const MEMBERS = [
  {
    countryId: "US",
    countryName: "United States",
    status: "founding",
    joinedTurn: 0,
    hasVote: true,
  },
  {
    countryId: "UK",
    countryName: "United Kingdom",
    status: "member",
    joinedTurn: 0,
    hasVote: true,
  },
  { countryId: "FR", countryName: "France", status: "member", joinedTurn: 0, hasVote: true },
  { countryId: "PL", countryName: "Poland", status: "member", joinedTurn: 0, hasVote: false },
];

const base = {
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
  members: MEMBERS,
  pendingMembershipProposals: [],
  pendingLegislation: [],
  activeLegislation: [],
  pendingWithdrawalMeasures: [],
  leadership: null,
  pendingLeadershipElections: [],
  identity: resolveOrgIdentity("NATO", false, "NATO", "bloc"),
  derived: { members: [], worldEconomySharePct: 50, notionalBudgetMillions: 0, yourInfluence: 0 },
  fund: { balanceLocal: 0, duesRateAnnual: 0.00006, currencyCode: "USD", currencyCountryId: "US" },
  posture: "standard",
  defensePctByCountry: {},
};

const orgWith = (extra: Record<string, unknown>) =>
  ({ ...base, ...extra }) as unknown as OrgSummary;

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

const props = { viewer, currentTurn: 200, votingWindowTurns: 24, onChange: () => {} };

describe("membership application tally", () => {
  it("measures unanimity against the voting roll less the applicant", () => {
    // DE applies, so the roll that must consent is US + UK + FR. Poland holds no
    // ballot and must not inflate the bar.
    render(
      <MembershipPanel
        org={orgWith({
          pendingMembershipProposals: [
            {
              _id: "p1",
              proposingCountryId: "DE",
              closesOnTurn: 213,
              votes: [{ countryId: "US", vote: "yes" }],
            },
          ],
        })}
        {...props}
      />
    );

    expect(screen.getByText(/1 \/ 3 yes/)).toBeTruthy();
    expect(screen.queryByText(/\/ 4 yes/)).toBeNull();
  });
});

describe("leadership election tally", () => {
  it("shows the majority of the voting roll a nominee must reach", () => {
    render(
      <LeadershipPanel
        org={orgWith({
          pendingLeadershipElections: [
            {
              _id: "e1",
              candidateCharacterName: "A Candidate",
              candidateCountryId: "US",
              nominatedByCharacterName: "A Nominator",
              closesOnTurn: 213,
              votes: [{ countryId: "US", vote: "yes" }],
            },
          ],
        })}
        {...props}
      />
    );

    expect(screen.getByText(/2 of 3 needed/)).toBeTruthy();
  });
});

describe("free trade agreement tally", () => {
  it("counts only the parties that actually hold a ballot", () => {
    // Poland is named as a party and is bound by the agreement, but it cannot
    // vote, so the resolver never waits on it. Neither should the panel.
    render(
      <LegislationPanel
        org={orgWith({
          pendingLegislation: [
            {
              _id: "f1",
              type: "free_trade_agreement",
              title: "Atlantic Trade Pact",
              proposedByCharacterName: "A Minister",
              closesOnTurn: 213,
              parties: ["US", "UK", "PL"],
              votes: [{ countryId: "US", vote: "yes" }],
            },
          ],
        })}
        {...props}
      />
    );

    expect(screen.getByText(/1 \/ 2 parties yes/)).toBeTruthy();
    expect(screen.queryByText(/\/ 3 parties yes/)).toBeNull();
  });
});
