/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DuesPanel } from "./DuesPanel";
import { resolveOrgIdentity } from "@/lib/constants/orgIdentity";
import type { OrgSummary, OrgViewerInfo } from "../orgTypes";

// Anchor-unit formatter, so a converted figure is distinguishable from one
// printed in the fund's own currency.
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
  fund: {
    balanceLocal: 3_400_000_000,
    duesRateAnnual: 0.00006,
    annualDuesLocal: 5_000_000_000,
    currencyCode: "USD",
    currencyCountryId: "US",
  },
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

describe("DuesPanel", () => {
  it("shows the fund + dues rate and opens the propose form", () => {
    render(
      <DuesPanel
        org={org}
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );
    expect(screen.getByText("Treasury & dues")).toBeTruthy();
    expect(screen.getByText(/\$5B\/yr/)).toBeTruthy();
    fireEvent.click(screen.getByText("Propose dues change"));
    expect(screen.getByText(/Annual dues/i)).toBeTruthy();
  });
});

describe("DuesPanel and the display-currency preference", () => {
  const rated = { ...org, fund: { ...org.fund, usdToFundRate: 2 } } as typeof org;
  const renderPanel = (o: typeof org) =>
    render(
      <DuesPanel
        org={o}
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );

  it("converts the annual assessment but not the balance", () => {
    // The assessment is a figure you read; the balance is the account itself,
    // and you cannot spend yen out of a dollar fund.
    renderPanel(rated);
    expect(formatAmount).toHaveBeenCalledWith(10_000_000_000, "USD");
    expect(screen.getByText(/¥10000000000\/yr/)).toBeTruthy();
    expect(formatAmount).not.toHaveBeenCalledWith(6_800_000_000, "USD");
  });

  it("says the assessment falls on VOTING members, not on the bloc", () => {
    // Dues are voters-only — the rest pay tribute at a rate they do not set —
    // so "across the bloc" described a charge nobody makes.
    renderPanel(rated);
    expect(screen.getByText(/across its VOTING members/)).toBeTruthy();
  });

  it("falls back to the fund's currency when no era rate came down", () => {
    renderPanel(org);
    expect(screen.getByText(/\$5B\/yr/)).toBeTruthy();
  });
});
