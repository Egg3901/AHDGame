/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AidPanel } from "./AidPanel";
import { resolveOrgIdentity } from "@/lib/constants/orgIdentity";
import type { OrgSummary, OrgViewerInfo } from "../orgTypes";

const formatAmount = vi.fn((anchor: number) => `¥${Math.round(anchor)}`);
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount }),
}));

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
  fund: { balanceLocal: 0, duesRateAnnual: 0.00006, currencyCode: "EUR", currencyCountryId: "DE" },
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

describe("AidPanel", () => {
  it("a member can open the aid form with recipient/amount (fund-funded)", () => {
    render(
      <AidPanel
        org={org}
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );
    expect(screen.getByText("Aid packages")).toBeTruthy();
    fireEvent.click(screen.getByText("Table aid package"));
    expect(screen.getByText("Recipient")).toBeTruthy();
    // Amount label is in the fund's (founding) currency now (interpolated → match on textContent).
    expect(
      screen.getByText((_, el) => el?.tagName === "LABEL" && el.textContent === "Amount (EUR)")
    ).toBeTruthy();
    expect(screen.getByPlaceholderText("1000000")).toBeTruthy();
    expect(screen.getByText(/pooled treasury/i)).toBeTruthy();
  });
});

describe("AidPanel and the display-currency preference", () => {
  it("converts a package's size but leaves the input in the fund's currency", () => {
    // The two halves of the same panel, deliberately different: a tabled amount
    // is a record and reads in the viewer's money, while the field posts
    // straight into the fund and must be in the fund's — its label says so.
    const withPackage = {
      ...org,
      fund: { ...org.fund, usdToFundRate: 2 },
      pendingLegislation: [
        {
          _id: "l1",
          type: "aid_package",
          aidRecipientCountryId: "IE",
          aidAmount: 1_000_000,
          proposedByCountryId: "DE",
          votes: [],
          closesOnTurn: 210,
        },
      ],
    } as unknown as OrgSummary;

    render(
      <AidPanel
        org={withPackage}
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );
    expect(formatAmount).toHaveBeenCalledWith(2_000_000, "EUR");
    fireEvent.click(screen.getByText("Table aid package"));
    expect(screen.getByLabelText(/Amount \(EUR\)/i)).toBeTruthy();
  });
});
