/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MilitaryBudgetTab } from "./MilitaryBudgetTab";
import { MilitaryOperationsTab } from "./MilitaryOperationsTab";
import type { MilitaryUnitView, ForceSummaryView } from "../../useCabinetOffice";

afterEach(cleanup);

function unit(p: Partial<MilitaryUnitView>): MilitaryUnitView {
  return {
    _id: "u1",
    countryId: "US",
    branchId: "army",
    domain: "ground",
    name: "1st Vanguard Tank",
    type: "Armored Division",
    icon: "tank",
    posture: "standard",
    techTier: 1,
    personnel: 15000,
    readiness: 70,
    basePower: 92,
    upkeepBase: 180,
    vet: 1,
    xp: 0,
    equipment: { firepower: 1, protection: 1, support: 1 },
    drill: null,
    theaterId: "reserve",
    assignedGeneralId: null,
    createdTurn: 1,
    effectivePower: 84,
    effectiveUpkeep: 468,
    ...p,
  };
}

function summary(p: Partial<ForceSummaryView> = {}): ForceSummaryView {
  return {
    unitCount: 1,
    totalPower: 84,
    totalPersonnel: 15000,
    totalUpkeep: 468,
    avgReadiness: 70,
    forwardShare: 0,
    treasuryBalance: 0,
    gdp: 387_000_000_000,
    militaryPriceBaselineGdp: 387_000_000_000,
    appropriation: 11_610_000_000,
    appropriationAccrual: 241_875_000,
    appropriationUpkeep: 133_031_250,
    arrearsRatio: 0,
    hasBudget: true,
    tier: "standard",
    ...p,
  };
}

describe("MilitaryBudgetTab", () => {
  // Over budget is now a real-money statement: the force costs more per turn than the
  // enacted line accrues, so the pot is being drawn down.
  it("warns when the force costs more per turn than the line accrues", () => {
    render(
      <MilitaryBudgetTab
        countryId="US"
        units={[unit({})]}
        forceSummary={summary({
          appropriationAccrual: 100_000_000,
          appropriationUpkeep: 250_000_000,
        })}
        currencySymbol="$"
      />
    );
    expect(screen.getByText(/Overspend → budget-balance penalty/)).toBeTruthy();
  });

  it("shows the per-turn accrual, and no penalty, when the force is affordable", () => {
    render(
      <MilitaryBudgetTab
        countryId="US"
        units={[unit({})]}
        forceSummary={summary()}
        currencySymbol="$"
      />
    );
    expect(screen.queryByText(/Overspend/)).toBeNull();
    expect(screen.getByText(/Accrues/)).toBeTruthy();
  });

  it("shows the enacted annual line and the legislature path to change it", () => {
    render(
      <MilitaryBudgetTab
        countryId="RU"
        units={[unit({})]}
        forceSummary={summary()}
        currencySymbol="₽"
      />
    );
    expect(screen.getByText(/Propose a defence bill/)).toBeTruthy();
    expect(screen.getByText(/National budget/)).toBeTruthy();
    const propose = screen.getByText(/Propose a defence bill/).closest("a");
    expect(propose?.getAttribute("href")).toBe("/country/ru/legislature");
    expect(screen.getByText(/This tab does not set the line/)).toBeTruthy();
  });
});

describe("MilitaryOperationsTab", () => {
  it("shows posture counts and flags forward-deployed units by theater", () => {
    render(
      <MilitaryOperationsTab
        units={[
          unit({ _id: "a", theaterId: "afghan", posture: "forward" }),
          unit({ _id: "b", theaterId: "reserve" }),
        ]}
      />
    );
    expect(screen.getByText(/1 unit forward-deployed or on high alert/)).toBeTruthy();
    // Theaters are dynamic now — the badge labels the unit by its conflict id
    // ("afghan"); the display name is threaded in with the conflict board (sub-D).
    expect(screen.getByText(/afghan/)).toBeTruthy();
    // deployment is now directed from the Conflicts board, not this tab
    expect(screen.getByText(/directed from the Conflicts/)).toBeTruthy();
  });
});
