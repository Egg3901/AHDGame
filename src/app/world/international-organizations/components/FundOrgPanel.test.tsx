/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FundOrgPanel } from "./FundOrgPanel";
import { resolveOrgIdentity } from "@/lib/constants/orgIdentity";
import type { OrgSummary, OrgViewerInfo } from "../orgTypes";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
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
  posture: "standard",
  defensePctByCountry: {},
} as unknown as OrgSummary;

const memberViewer = {
  foreignMinisterOf: "DE",
  headOfGovernmentOf: null,
} as unknown as OrgViewerInfo;

const nonMemberViewer = {
  foreignMinisterOf: "BR",
  headOfGovernmentOf: null,
} as unknown as OrgViewerInfo;

describe("FundOrgPanel", () => {
  it("lets a member open the form and posts the amount to the fund route", async () => {
    render(<FundOrgPanel org={baseOrg} viewer={memberViewer} onChange={() => {}} />);
    fireEvent.click(screen.getByText("Fund organization"));
    const input = screen.getByPlaceholderText("1000000") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2500000" } });
    fireEvent.click(screen.getByText("Send to the legislature"));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/country/DE/international-organizations/EU/fund",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ amountLocal: 2500000 }) })
    );
  });

  it("hides the fund action for a non-member", () => {
    render(<FundOrgPanel org={baseOrg} viewer={nonMemberViewer} onChange={() => {}} />);
    expect(screen.queryByText("Fund organization")).toBeNull();
  });
});
