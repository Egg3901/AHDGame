/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SanctionsPanel } from "./SanctionsPanel";
import { resolveOrgIdentity } from "@/lib/constants/orgIdentity";
import type { OrgSummary, OrgViewerInfo } from "../orgTypes";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const org = {
  id: "EU",
  def: {
    id: "EU",
    name: "European Union",
    shortName: "EU",
    description: "",
    logoPath: null,
    foundingMembers: ["DE", "IE"],
    leadership: { title: "President", termTurns: 96 },
    charter: "",
    category: "economic",
  },
  members: [
    { countryId: "DE", countryName: "Germany", flagEmoji: "🇩🇪", status: "founding", joinedTurn: 0 },
    { countryId: "IE", countryName: "Ireland", flagEmoji: "🇮🇪", status: "founding", joinedTurn: 0 },
  ],
  pendingMembershipProposals: [],
  pendingLegislation: [],
  activeLegislation: [],
  pendingWithdrawalMeasures: [],
  leadership: null,
  pendingLeadershipElections: [],
  identity: resolveOrgIdentity("EU", false, "European Union", "economic"),
  derived: { members: [], worldEconomySharePct: 50, notionalBudgetMillions: 0, yourInfluence: 0 },
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

/** The EU with a voting roll of DE + IE + FR, plus one silent client state. */
const orgWithPendingSanctions = {
  ...(org as unknown as Record<string, unknown>),
  members: [
    { countryId: "DE", countryName: "Germany", status: "founding", joinedTurn: 0, hasVote: true },
    { countryId: "IE", countryName: "Ireland", status: "founding", joinedTurn: 0, hasVote: true },
    { countryId: "FR", countryName: "France", status: "member", joinedTurn: 0, hasVote: true },
    { countryId: "PL", countryName: "Poland", status: "member", joinedTurn: 0, hasVote: false },
  ],
  pendingLegislation: [
    {
      _id: "s1",
      type: "sanctions",
      title: "Embargo on oil",
      proposedByCharacterName: "A Minister",
      closesOnTurn: 213,
      parties: [],
      votes: [{ countryId: "DE", vote: "yes" }],
    },
  ],
} as unknown as OrgSummary;

describe("SanctionsPanel", () => {
  it("a member can open the table-sanctions form", () => {
    render(
      <SanctionsPanel
        org={org}
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );
    expect(screen.getByText("Sanctions")).toBeTruthy();
    const btn = screen.getByText("Table sanctions");
    fireEvent.click(btn);
    expect(screen.getByText("Target country")).toBeTruthy();
    expect(screen.getByText("Commodity")).toBeTruthy();
  });
  it("refuses the vote buttons to a member that holds no ballot", () => {
    // The route enforces isVotingMember, so offering an enabled button to a
    // member without a vote promises something the server will refuse.
    render(
      <SanctionsPanel
        org={
          {
            ...(orgWithPendingSanctions as unknown as Record<string, unknown>),
            members: [
              {
                countryId: "DE",
                countryName: "Germany",
                status: "founding",
                joinedTurn: 0,
                hasVote: false,
              },
              {
                countryId: "IE",
                countryName: "Ireland",
                status: "founding",
                joinedTurn: 0,
                hasVote: true,
              },
            ],
          } as unknown as OrgSummary
        }
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );
    // The viewer is Germany's foreign minister, and Germany holds no ballot.
    expect(screen.getByRole("button", { name: "Vote Yes" }).hasAttribute("disabled")).toBe(true);
  });

  it("folds a country's duplicate vote rows down to its latest one", () => {
    // Rows predating the upsert write path leave a country on the ballot twice.
    // The resolver folds them to the latest; a panel that counted both would
    // show a tally the resolver will never agree with.
    render(
      <SanctionsPanel
        org={
          {
            ...(orgWithPendingSanctions as unknown as Record<string, unknown>),
            pendingLegislation: [
              {
                _id: "s1",
                type: "sanctions",
                title: "Embargo on oil",
                proposedByCharacterName: "A Minister",
                closesOnTurn: 213,
                parties: [],
                votes: [
                  { countryId: "DE", vote: "yes" },
                  { countryId: "IE", vote: "yes" },
                  { countryId: "DE", vote: "no" },
                ],
              },
            ],
          } as unknown as OrgSummary
        }
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );
    // Germany's latest word is "no", so only Ireland is in favour.
    expect(screen.getByText(/1 \/ 3 members in favour, 2 needed/)).toBeTruthy();
  });

  it("says so plainly when no member of the organization holds a vote", () => {
    // votesNeeded returns 0 for an empty roll, so a naive render advertises
    // "0 needed" while ballotPasses refuses the resolution outright.
    render(
      <SanctionsPanel
        org={
          {
            ...(orgWithPendingSanctions as unknown as Record<string, unknown>),
            members: [
              {
                countryId: "PL",
                countryName: "Poland",
                status: "member",
                joinedTurn: 0,
                hasVote: false,
              },
            ],
          } as unknown as OrgSummary
        }
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );
    expect(screen.getByText(/no members hold a vote/)).toBeTruthy();
    expect(screen.queryByText(/0 needed/)).toBeNull();
  });

  it("shows the majority a resolution must clear, measured against the voting roll", () => {
    // Three members hold a ballot and Poland does not, so the bar is two of
    // three. Counting Poland would advertise a threshold the resolver never
    // applies.
    render(
      <SanctionsPanel
        org={orgWithPendingSanctions}
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );
    expect(screen.getByText(/1 \/ 3 members in favour, 2 needed/)).toBeTruthy();
  });
});
