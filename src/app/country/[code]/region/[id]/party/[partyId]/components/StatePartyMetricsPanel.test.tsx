/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatePartyMetricsPanel } from "./StatePartyMetricsPanel";
import type { StatePartyData } from "./types";

function baseParty(overrides: Partial<StatePartyData> = {}): StatePartyData {
  return {
    _id: "sp1",
    stateId: "CA",
    stateName: "California",
    countryId: "US",
    politicalLean: 0,
    statePopulation: 39_000_000,
    partyId: "1",
    partyName: "Republican Party",
    partyColor: "#c41e3a",
    partyAbbreviation: "GOP",
    isDefault: true,
    organization: 33.5,
    treasury: 0,
    stateTaxRate: 0,
    nationalTaxRate: 0,
    expectedHourlyIncome: 0,
    gotvBudgetPercent: 0,
    gotvEstimatedSpend: 0,
    gotvTargetCategory: null,
    gotvTargetGroup: null,
    suppressionBudgetPercent: 0,
    suppressionEstimatedSpend: 0,
    suppressionTargetCategory: null,
    suppressionTargetGroup: null,
    orgBuildingPercent: 0,
    orgBuildingEstimatedSpend: 0,
    psInvestmentBudget: 0,
    hasPresence: true,
    transferReserveAmount: 0,
    memberSupportReserveAmount: 0,
    nppRecruitmentReserveAmount: 0,
    treasuryPreset: "growth",
    totalReserveTarget: 0,
    discretionaryTreasury: 0,
    netHourlyTreasuryChange: 0,
    turnsUntilZero: null,
    turnsUntilReserveFloor: null,
    turnsToReachReserveFloor: null,
    economicPosition: 50,
    socialPosition: 50,
    politicalStrength: 7,
    chair: null,
    viceChair: null,
    treasurer: null,
    campaigner: null,
    nationalChairId: null,
    nationalViceChairId: null,
    nationalCampaignerIds: [],
    members: [],
    memberCount: 0,
    rivals: [],
    ...overrides,
  };
}

describe("StatePartyMetricsPanel", () => {
  it("explains Org effects with blurbs and tooltips instead of bare icon tiles", () => {
    render(<StatePartyMetricsPanel stateParty={baseParty()} />);

    expect(screen.getByText("Party Organization")).toBeTruthy();
    expect(screen.getByLabelText("About Party Organization")).toBeTruthy();
    expect(screen.getByText("What Org does here")).toBeTruthy();

    expect(screen.getByText("Vote Power")).toBeTruthy();
    expect(screen.getByText("0.67×")).toBeTruthy();
    expect(screen.getByText("General-election vote scalar")).toBeTruthy();
    expect(screen.getByLabelText("About Vote Power")).toBeTruthy();

    expect(screen.getByText("Pres. Primary")).toBeTruthy();
    expect(screen.getByText("8 pts")).toBeTruthy();
    expect(screen.getByText("Home-state primary scoring")).toBeTruthy();

    expect(screen.getByText("NPP Quality")).toBeTruthy();
    expect(screen.getByText("Mid")).toBeTruthy();
    expect(screen.getByText("Recruitment capacity from Org")).toBeTruthy();

    expect(screen.getByText("Influence")).toBeTruthy();
    expect(screen.getByText("Baseline")).toBeTruthy();
    expect(screen.getByText("State influence action edge")).toBeTruthy();
  });

  it("shows Influence bonus when Org is above 50%", () => {
    render(<StatePartyMetricsPanel stateParty={baseParty({ organization: 55 })} />);
    expect(screen.getByText("+6%")).toBeTruthy();
  });
});
