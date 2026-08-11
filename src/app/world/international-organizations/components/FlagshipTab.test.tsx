/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FlagshipTab } from "./FlagshipTab";
import { resolveOrgIdentity } from "@/lib/constants/orgIdentity";
import type { OrganizationCategory } from "@/lib/constants/orgCategory";
import type { OrgSummary } from "../orgTypes";

afterEach(() => cleanup());

function makeOrg(
  id: string,
  isCustom: boolean,
  category: OrganizationCategory,
  foundingMembers: string[]
): OrgSummary {
  return {
    id,
    def: {
      id,
      name: id,
      shortName: id,
      description: "",
      logoPath: null,
      foundingMembers,
      leadership: { title: "Leader", termTurns: 96 },
      charter: "",
      category,
      isCustom,
    },
    members: foundingMembers.map((countryId) => ({
      countryId,
      countryName: countryId,
      flagEmoji: "🏳️",
      status: "founding",
      joinedTurn: 0,
    })),
    pendingMembershipProposals: [],
    pendingLegislation: [],
    activeLegislation: [],
    pendingWithdrawalMeasures: [],
    leadership: null,
    pendingLeadershipElections: [],
    identity: resolveOrgIdentity(id, isCustom, id, category),
    derived: { members: [], worldEconomySharePct: 40, notionalBudgetMillions: 0, yourInfluence: 0 },
    posture: "standard",
    defensePctByCountry: {},
    fund: {
      balanceLocal: 0,
      duesRateAnnual: 0.00006,
      currencyCode: "USD",
      currencyCountryId: "US",
    },
  } as unknown as OrgSummary;
}

describe("FlagshipTab (category-driven)", () => {
  it("always shows the category's charter powers with human labels", () => {
    render(<FlagshipTab org={makeOrg("UN", false, "political", ["US"])} />);
    expect(screen.getByText("Charter powers")).toBeTruthy();
    // Labels, not raw enum keys (regression: fund_agency rendered raw).
    expect(screen.getByText("Agency funding")).toBeTruthy();
    expect(screen.queryByText("fund_agency")).toBeNull();
  });

  it("political → permanent council", () => {
    render(<FlagshipTab org={makeOrg("UN", false, "political", ["US", "UK"])} />);
    expect(screen.getByText("Permanent council")).toBeTruthy();
  });

  it("political → funded agencies in the agency-funding section", () => {
    const org = {
      ...makeOrg("UN", false, "political", ["US", "UK"]),
      fund: {
        balanceLocal: 80_000_000,
        duesRateAnnual: 0.00006,
        currencyCode: "USD",
        currencyCountryId: "US",
      },
      activeLegislation: [
        {
          _id: "ag1",
          type: "fund_agency",
          agencyKey: "humanitarian_relief",
          agencyExpiresOnTurn: 280,
        },
      ],
    } as unknown as OrgSummary;
    render(<FlagshipTab org={org} currentTurn={250} />);
    expect(screen.getByText("Funded agencies")).toBeTruthy();
    expect(screen.getByText("Humanitarian Relief Agency")).toBeTruthy();
    expect(screen.getByText(/Lapses in 30 turns/i)).toBeTruthy();
  });

  it("security → defense-spending pledge", () => {
    render(<FlagshipTab org={makeOrg("NATO", false, "security", ["US"])} />);
    expect(screen.getByText("Defense-spending pledge")).toBeTruthy();
  });

  it("security → shows current posture + per-member defense% met/below", () => {
    const org = {
      ...makeOrg("NATO", false, "security", ["US", "DE"]),
      posture: "heightened",
      defensePctByCountry: { US: 3.4, DE: 1.4 },
    } as unknown as OrgSummary;
    render(<FlagshipTab org={org} />);
    // Posture surfaced (tile + section both render the label; allow multiple).
    expect(screen.getAllByText("Heightened").length).toBeGreaterThan(0);
    expect(screen.getByText("3.4%")).toBeTruthy();
    expect(screen.getByText("1.4%")).toBeTruthy();
    expect(screen.getByText("Met")).toBeTruthy(); // US ≥ 2%
    expect(screen.getByText("Below")).toBeTruthy(); // DE < 2%
  });

  it("economic → directives in force + free-trade agreements", () => {
    const org = {
      ...makeOrg("EU", false, "economic", ["DE", "IE"]),
      activeLegislation: [
        {
          _id: "d1",
          type: "directive",
          directiveKey: "green_transition",
          directiveExpiresOnTurn: 300,
        },
        { _id: "f1", type: "free_trade_agreement", title: "EU FTA: DE, IE", parties: ["DE", "IE"] },
      ],
    } as unknown as OrgSummary;
    render(<FlagshipTab org={org} currentTurn={250} />);
    expect(screen.getByText("Directives in force")).toBeTruthy();
    expect(screen.getByText("Green Transition Directive")).toBeTruthy();
    expect(screen.getByText(/Lifts in 50 turns/i)).toBeTruthy();
    expect(screen.getByText("EU FTA: DE, IE")).toBeTruthy();
  });

  it("development → financed projects portfolio", () => {
    const org = {
      ...makeOrg("andes-dev", true, "development", ["BR", "US"]),
      fund: {
        balanceLocal: 12_000_000,
        duesRateAnnual: 0.00006,
        currencyCode: "USD",
        currencyCountryId: "US",
      },
      activeLegislation: [
        { _id: "a1", type: "aid_package", aidRecipientCountryId: "BR", aidAmount: 5_000_000 },
      ],
    } as unknown as OrgSummary;
    render(<FlagshipTab org={org} />);
    expect(screen.getByText("Financed projects")).toBeTruthy();
    expect(screen.getByText("$12.0M")).toBeTruthy(); // formatFundAmount(12M, USD)
    expect(screen.getByText("Brazil")).toBeTruthy();
    expect(screen.getByText("$5.0M")).toBeTruthy(); // formatFundAmount(5M, USD)
  });
});
