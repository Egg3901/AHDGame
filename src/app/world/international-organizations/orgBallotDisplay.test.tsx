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
    hasPolicyVote: true,
  },
  {
    countryId: "UK",
    countryName: "United Kingdom",
    status: "member",
    joinedTurn: 0,
    hasVote: true,
    hasPolicyVote: true,
  },
  {
    countryId: "FR",
    countryName: "France",
    status: "member",
    joinedTurn: 0,
    hasVote: true,
    hasPolicyVote: true,
  },
  {
    countryId: "PL",
    countryName: "Poland",
    status: "member",
    joinedTurn: 0,
    hasVote: false,
    hasPolicyVote: false,
  },
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

describe("a member seated only on majority ballots", () => {
  /**
   * Poland run by an NPP government: `hasPolicyVote` without `hasVote`. The
   * resolver seats exactly this member on a majority ballot and keeps it off a
   * unanimity one, so the two panels below must disagree about it — and each must
   * agree with the resolver.
   *
   * Ticket #1257: they did not. Every panel read `hasVote` while the resolver had
   * started seating NPP governments on every ballot, so a Warsaw Pact admission
   * the tab called one vote short of unanimous was five short, and two accepted
   * applications expired without anyone seeing the real bar.
   */
  const withNppPoland = (extra: Partial<OrgSummary>) =>
    orgWith({
      ...extra,
      members: MEMBERS.map((m) =>
        m.countryId === "PL" ? { ...m, hasPolicyVote: true } : m
      ) as OrgSummary["members"],
    });

  it("counts toward a chair election, which carries on a majority", () => {
    render(
      <LeadershipPanel
        org={withNppPoland({
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
        } as Partial<OrgSummary>)}
        {...props}
      />
    );

    // Four on the roll now, so the bar is three rather than two.
    expect(screen.getByText(/3 of 4 needed/)).toBeTruthy();
  });

  it("does NOT count toward an admission, which needs every voter", () => {
    render(
      <MembershipPanel
        org={withNppPoland({
          pendingMembershipProposals: [
            {
              _id: "p1",
              proposingCountryId: "DE",
              closesOnTurn: 213,
              votes: [{ countryId: "US", vote: "yes" }],
            },
          ],
        } as Partial<OrgSummary>)}
        {...props}
      />
    );

    // Still three. Adding a member that may not vote in time to a ballot where
    // silence is a veto does not give the bloc a say, it hands one distracted
    // member a permanent block.
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

describe("duplicate vote rows", () => {
  it("membership counts a country's latest row only", () => {
    render(
      <MembershipPanel
        org={orgWith({
          pendingMembershipProposals: [
            {
              _id: "p1",
              proposingCountryId: "DE",
              closesOnTurn: 213,
              votes: [
                { countryId: "US", vote: "yes" },
                { countryId: "UK", vote: "yes" },
                { countryId: "US", vote: "no" },
              ],
            },
          ],
        })}
        {...props}
      />
    );

    // The United States ends on "no", so one yes and one no, never two yeses.
    expect(screen.getByText(/1 \/ 3 yes \(1 no\)/)).toBeTruthy();
  });

  it("a trade agreement counts a party's latest row only", () => {
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
              parties: ["US", "UK"],
              votes: [
                { countryId: "US", vote: "yes" },
                { countryId: "UK", vote: "yes" },
                { countryId: "US", vote: "no" },
              ],
            },
          ],
        })}
        {...props}
      />
    );

    expect(screen.getByText(/1 \/ 2 parties yes/)).toBeTruthy();
  });
});

describe("the viewer's own vote", () => {
  it("highlights a trade agreement voter's latest choice, not their first", () => {
    // myVote drives which button reads as selected. Reading it off the raw list
    // shows the player the vote they changed away from.
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
              parties: ["US", "UK"],
              votes: [
                { countryId: "US", vote: "yes" },
                { countryId: "US", vote: "no" },
              ],
            },
          ],
        })}
        {...props}
      />
    );

    // "destructive" is the selected styling for No.
    expect(screen.getByRole("button", { name: "Vote No" }).className).toContain("bg-error");
  });
});

describe("an organization where nobody holds a vote", () => {
  const silentOrg = (extra: Record<string, unknown>) =>
    orgWith({
      members: [
        {
          countryId: "PL",
          countryName: "Poland",
          status: "member",
          joinedTurn: 0,
          hasVote: false,
          hasPolicyVote: false,
        },
      ],
      ...extra,
    });

  it("says so on a chair election rather than advertising a bar of zero", () => {
    render(
      <LeadershipPanel
        org={silentOrg({
          pendingLeadershipElections: [
            {
              _id: "e1",
              candidateCharacterName: "A Candidate",
              candidateCountryId: "US",
              nominatedByCharacterName: "A Nominator",
              closesOnTurn: 213,
              votes: [],
            },
          ],
        })}
        {...props}
      />
    );

    expect(screen.getByText(/no members hold a vote/)).toBeTruthy();
  });

  it("says so on an admission rather than advertising a bar of zero", () => {
    render(
      <MembershipPanel
        org={silentOrg({
          pendingMembershipProposals: [
            { _id: "p1", proposingCountryId: "DE", closesOnTurn: 213, votes: [] },
          ],
        })}
        {...props}
      />
    );

    expect(screen.getByText(/no members hold a vote/)).toBeTruthy();
  });
});
