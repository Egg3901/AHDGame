/**
 * @vitest-environment happy-dom
 *
 * Ticket #1237: the CEO budget panel used Number() on typed budget drafts, so a
 * long digit string silently became a 1e+278 float, and the overhead cap was
 * Infinity for a zero-revenue corp, so nothing in the UI stopped committing it.
 * The server now rejects positive overhead at zero revenue; the panel must
 * surface the same rule and never emit scientific-notation budget garbage.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import CeoBudgetPanel, { parseDisplayDigits } from "./CeoBudgetPanel";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (n: number) => `$${Math.round(n)}`,
    toInternalFrom: (n: number) => n,
  }),
}));

const baseCorporation = {
  _id: "c1",
  countryId: "US",
  liquidCurrencyCode: "USD",
  marketingBudget: 0,
  logisticsBudget: 0,
  rdBudget: 0,
  ceoSalary: 0,
  marketingStrength: 0,
  logisticsStrength: 0,
  rdScore: 0,
  secondaryType: null,
  type: "retail",
  isPrivate: true,
  dividendRate: 0,
  countryOwnerId: null,
} as Record<string, unknown>;

const baseFinancials = {
  totalRevenue: 0,
  maintenanceCosts: 0,
  laborCosts: 0,
  growthCosts: 0,
  marketingCosts: 0,
  logisticsCosts: 0,
  rdCosts: 0,
  ceoSalaryCost: 0,
  pensionContributionCost: 0,
  pensionTopUpCost: 0,
  pensionSchemesInDeficit: 0,
  regulatoryBurden: 0,
  operatingCosts: 0,
  operatingIncome: 0,
  federalTax: 0,
  stateTax: 0,
  federalTaxByCountry: {},
  bondInterestCost: 0,
  bondCouponIncome: 0,
  governmentBondSubsidy: 0,
  imfFacilityPaymentDaily: 0,
  imfFacilityReceiptsDaily: 0,
  dividendIncomeReceived: 0,
  income: 0,
} as Record<string, unknown>;

function renderBudget(
  overrides: {
    corporation?: Record<string, unknown>;
    financials?: Record<string, unknown>;
    onSaveSettings?: () => void;
  } = {}
) {
  const corporation = { ...baseCorporation, ...(overrides.corporation ?? {}) } as never;
  const financials = { ...baseFinancials, ...(overrides.financials ?? {}) } as never;
  const stored = { ...baseCorporation, ...(overrides.corporation ?? {}) };

  // Stateful harness: the real parent re-renders with the new edit strings when
  // the setters fire, and the cap/save logic reads those props.
  function Harness() {
    const [marketing, setMarketing] = useState(String(stored.marketingBudget));
    const [logistics, setLogistics] = useState(String(stored.logisticsBudget));
    const [rd, setRd] = useState(String(stored.rdBudget));
    const [salary, setSalary] = useState(Number(stored.ceoSalary));
    return (
      <CeoBudgetPanel
        corporation={corporation}
        financials={financials}
        sectorCount={0}
        editMarketingBudget={marketing}
        setEditMarketingBudget={setMarketing}
        editLogisticsBudget={logistics}
        setEditLogisticsBudget={setLogistics}
        editRdBudget={rd}
        setEditRdBudget={setRd}
        editCeoSalary={salary}
        setEditCeoSalary={setSalary}
        saving={false}
        onSaveSettings={overrides.onSaveSettings ?? vi.fn()}
      />
    );
  }
  render(<Harness />);
}

function logisticsInput(): HTMLInputElement {
  return screen.getByLabelText("Logistics budget /turn") as HTMLInputElement;
}

function typeInto(input: HTMLInputElement, value: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

function saveButton(): HTMLButtonElement {
  return screen.getByText("Save budgets").closest("button") as HTMLButtonElement;
}

describe("CeoBudgetPanel: zero-revenue overhead rule (ticket #1237)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables Save when a zero-revenue corp has a positive budget", () => {
    renderBudget({ financials: { totalRevenue: 0 } });
    typeInto(logisticsInput(), "5000");
    expect(saveButton().disabled).toBe(true);
  });

  it("keeps Save enabled for a zero-revenue corp with all-zero budgets", () => {
    renderBudget({ financials: { totalRevenue: 0 } });
    expect(saveButton().disabled).toBe(false);
  });

  it("keeps Save enabled when a zero-revenue corp lowers a leftover budget", () => {
    // Leftover budgets from when the corp had revenue: lowering them must stay
    // possible (the server allows non-worsening saves).
    renderBudget({
      corporation: { logisticsBudget: 5_000 },
      financials: { totalRevenue: 0 },
    });
    typeInto(logisticsInput(), "1");
    expect(saveButton().disabled).toBe(false);
  });

  it("allows positive budgets within the 150% ceiling when revenue exists", () => {
    // Turn view: 500/turn = 12,000/day against a 10,000/day revenue ceiling (15,000).
    renderBudget({ financials: { totalRevenue: 10_000 } });
    typeInto(logisticsInput(), "500");
    expect(saveButton().disabled).toBe(false);
  });

  it("clamps a 279-digit typed budget instead of emitting a 1e+278 float", () => {
    renderBudget({ financials: { totalRevenue: 0 } });
    const input = logisticsInput();
    typeInto(input, "2".padEnd(279, "7"));
    // After commit the input re-displays the daily rate scaled back to the
    // period view. The regression was Number("2".padEnd(279,"7")) becoming a
    // 1e+278 float; the clamp keeps the committed figure in integer territory.
    expect(input.value).toMatch(/^\d+$/);
    expect(input.value).not.toMatch(/e\+/i);
    expect(Number(input.value)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER + 1);
  });
});

describe("CeoBudgetPanel: editing in place", () => {
  it("shows the operating-income change of an unsaved edit, and Reset drops it", () => {
    renderBudget({ financials: { totalRevenue: 100_000 } });
    expect(screen.queryByText("Change from edits")).toBeNull();
    typeInto(logisticsInput(), "100");
    expect(screen.getByText("Change from edits")).toBeTruthy();
    // 100/turn is 2,400/day of new overhead, shown back per turn.
    expect(screen.getByText("-$100")).toBeTruthy();
    fireEvent.click(screen.getByText("Reset"));
    expect(screen.queryByText("Change from edits")).toBeNull();
    expect(logisticsInput().value).toBe("0");
  });

  it("commits pending drafts before saving", () => {
    const onSaveSettings = vi.fn();
    renderBudget({ financials: { totalRevenue: 100_000 }, onSaveSettings });
    const input = logisticsInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "250" } });
    fireEvent.click(screen.getByText("Save budgets"));
    expect(onSaveSettings).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("250");
  });
});

describe("parseDisplayDigits", () => {
  it("strips non-digits and clamps to the safe integer range", () => {
    expect(parseDisplayDigits("1,234")).toBe(1234);
    expect(parseDisplayDigits("")).toBe(0);
    expect(parseDisplayDigits("9".repeat(40))).toBe(Number.MAX_SAFE_INTEGER);
  });
});
