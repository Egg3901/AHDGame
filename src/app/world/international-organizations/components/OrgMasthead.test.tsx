/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { OrgMasthead } from "./OrgMasthead";
import { BUILTIN_ORG_IDENTITY } from "@/lib/constants/orgIdentity";
import type { OrgSummary, OrgViewerInfo } from "../orgTypes";

vi.mock("next/navigation", () => ({
  usePathname: () => "/world/international-organizations/un/overview",
}));

// A viewer whose display preference is a currency the fund is NOT held in, so a
// figure that respects the preference is distinguishable from one that ignores
// it. `formatAmount` takes ANCHOR units, which is what the conversion under test
// has to produce.
const formatAmount = vi.fn((anchor: number) => `¥${Math.round(anchor)}`);
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount }),
}));

afterEach(() => cleanup());

const org = {
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
    { countryId: "IE", countryName: "Ireland", flagEmoji: "🇮🇪", status: "active", joinedTurn: 5 },
  ],
  pendingMembershipProposals: [],
  pendingLegislation: [],
  activeLegislation: [],
  pendingWithdrawalMeasures: [],
  leadership: null,
  pendingLeadershipElections: [],
  identity: BUILTIN_ORG_IDENTITY.UN,
  derived: {
    members: [
      { countryId: "US", contributionPct: 0.98, influenceIndex: 100 },
      { countryId: "IE", contributionPct: 0.02, influenceIndex: 2 },
    ],
    worldEconomySharePct: 51,
    notionalBudgetMillions: 137750,
    yourInfluence: 0,
  },
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
  foreignMinisterOf: "US",
  foreignMinisterCountryName: "United States",
  headOfGovernmentOf: null,
  headOfGovernmentCountryName: null,
  diplomaticActionsRemaining: 3,
  diplomaticActionsPerTurn: 4,
  diplomaticActionsCountryId: "US",
} as unknown as OrgViewerInfo;

describe("OrgMasthead", () => {
  it("renders the org name, action chip, and the flagship sub-tab label", () => {
    render(<OrgMasthead org={org} viewer={viewer} />);
    expect(screen.getByText("United Nations")).toBeTruthy();
    expect(screen.getByText(/3 \/ 4 diplomatic actions left/)).toBeTruthy();
    expect(screen.getByText("Assembly")).toBeTruthy();
  });

  it("shows the org-fund dues in both money and percent when no tribute is levied", () => {
    // The UN takes no tribute, so the tile keeps its single-line form rather
    // than carrying a permanent zero.
    render(<OrgMasthead org={org} viewer={viewer} />);
    expect(screen.getByText(/\$5B\/yr dues · 0\.006%/)).toBeTruthy();
  });

  it("shows tribute beside dues for a bloc that levies it", () => {
    // An armed bloc earns far more from the members without a vote than from
    // the ones who set the rate — NATO's tribute is roughly fourteen times its
    // dues in 1953 — so a tile showing only dues hides most of the income.
    const levying = {
      ...org,
      fund: { ...org.fund, annualTributeLocal: 70_000_000_000, tributeRateAnnual: 0.005 },
    } as typeof org;
    render(<OrgMasthead org={levying} viewer={viewer} />);
    expect(screen.getByText(/\$5B\/yr dues · \$70B\/yr tribute/)).toBeTruthy();
  });

  it("renders sub-tabs as links to the org's routes", () => {
    render(<OrgMasthead org={org} viewer={viewer} />);
    expect(screen.getByText("Overview").closest("a")?.getAttribute("href")).toBe(
      "/world/international-organizations/un/overview"
    );
    expect(screen.getByText("Assembly").closest("a")?.getAttribute("href")).toBe(
      "/world/international-organizations/un/flagship"
    );
  });

  it("hides the Influence tab when bloc alignment is switched off", () => {
    // Fail-closed: a world with the gate off must show no trace of the feature,
    // not a tab that explains it is unavailable.
    render(<OrgMasthead org={org} viewer={viewer} />);
    expect(screen.queryByText("Influence")).toBeNull();
  });

  it("offers the Influence tab once bloc alignment is switched on", () => {
    render(<OrgMasthead org={org} viewer={viewer} alignmentEnabled />);
    expect(screen.getByText("Influence")).toBeTruthy();
  });
});

describe("OrgMasthead fund income and the display-currency preference", () => {
  const rated = (over: Record<string, unknown> = {}) =>
    ({
      ...org,
      // Anchor per fund unit, resolved server-side for the era. 2.0 makes the
      // conversion visible: a 5bn-USD dues line must reach formatAmount as 10bn
      // anchor, not as 5bn.
      fund: { ...org.fund, usdToFundRate: 2, ...over },
    }) as typeof org;

  it("converts the income lines into the viewer's currency", () => {
    render(<OrgMasthead org={rated()} viewer={viewer} />);
    expect(formatAmount).toHaveBeenCalledWith(10_000_000_000, "USD");
    expect(screen.getByText(/¥10000000000\/yr dues/)).toBeTruthy();
  });

  it("leaves the BALANCE in the fund's own currency", () => {
    // An account, not a view of your wallet: you cannot spend yen out of a
    // dollar fund, and the commit input has to be in the units the API takes.
    render(<OrgMasthead org={rated()} viewer={viewer} />);
    expect(screen.getByText("$3B")).toBeTruthy();
    expect(formatAmount).not.toHaveBeenCalledWith(6_800_000_000, "USD");
  });

  it("falls back to the fund's currency when no era rate came down", () => {
    // Older cached payloads carry no `usdToFundRate`. Guessing one from
    // COUNTRY_CONFIGS would price a 1953 world at 1979 rates, so the fund's own
    // currency stands in instead.
    render(<OrgMasthead org={org} viewer={viewer} />);
    expect(screen.getByText(/\$5B\/yr dues/)).toBeTruthy();
  });
});
