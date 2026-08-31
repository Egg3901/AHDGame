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
import CeoBudgetSubtab from "./CeoBudgetSubtab";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (n: number) => `$${Math.round(n)}`,
    toInternalFrom: (n: number) => n,
  }),
}));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
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
  operatingCosts: 0,
  operatingIncome: 0,
  federalTax: 0,
  stateTax: 0,
  federalTaxByCountry: {},
  bondInterestCost: 0,
  bondCouponIncome: 0,
} as Record<string, unknown>;

function renderBudgetTab(
  overrides: {
    corporation?: Record<string, unknown>;
    financials?: Record<string, unknown>;
    onSaveSettings?: () => void;
  } = {}
) {
  const corporation = { ...baseCorporation, ...(overrides.corporation ?? {}) } as never;
  const financials = { ...baseFinancials, ...(overrides.financials ?? {}) } as never;

  // Stateful harness: the real parent re-renders with the new edit strings when
  // the setters fire, and the cap/save logic reads those props.
  function Harness() {
    const [marketing, setMarketing] = useState("0");
    const [logistics, setLogistics] = useState("0");
    const [rd, setRd] = useState("0");
    return (
      <CeoBudgetSubtab
        corpId="c1"
        corporation={corporation}
        financials={financials}
        sectorCount={0}
        myCashOnHand={0}
        editMarketingBudget={marketing}
        setEditMarketingBudget={setMarketing}
        editLogisticsBudget={logistics}
        setEditLogisticsBudget={setLogistics}
        editRdBudget={rd}
        setEditRdBudget={setRd}
        editCeoSalary={0}
        setEditCeoSalary={vi.fn()}
        editShareBuybackMode="instant"
        setEditShareBuybackMode={vi.fn()}
        editEscrowFundingPerTurn="0"
        setEditEscrowFundingPerTurn={vi.fn()}
        currentTurn={514}
        onRefresh={vi.fn()}
        saving={false}
        onSaveSettings={overrides.onSaveSettings ?? vi.fn()}
        editDividendRate={0}
        setEditDividendRate={vi.fn()}
        dividendSaving={false}
        dividendError=""
        dividendSuccess=""
        onSaveDividend={vi.fn()}
      />
    );
  }
  render(<Harness />);
}

/** Budget text inputs in fixed JSX order: marketing, logistics, R&D, CEO salary. */
function budgetInputs(): HTMLInputElement[] {
  return screen.getAllByPlaceholderText("0") as HTMLInputElement[];
}

function logisticsInput(): HTMLInputElement {
  return budgetInputs()[1];
}

describe("CeoBudgetSubtab — zero-revenue overhead rule (ticket #1237)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables Save Budgets when a zero-revenue corp has a positive budget", () => {
    renderBudgetTab({ financials: { totalRevenue: 0 } });
    const input = logisticsInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "5000" } });
    fireEvent.blur(input);
    const save = screen.getByText("Save Budgets").closest("button") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("keeps Save Budgets enabled for a zero-revenue corp with all-zero budgets", () => {
    renderBudgetTab({ financials: { totalRevenue: 0 } });
    const save = screen.getByText("Save Budgets").closest("button") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it("keeps Save Budgets enabled for a positive-budget reduction on a zero-revenue corp", () => {
    // Leftover budgets from when the corp had revenue: lowering them must stay
    // possible (the server allows non-worsening saves).
    renderBudgetTab({
      corporation: { logisticsBudget: 5_000 },
      financials: { totalRevenue: 0 },
    });
    const input = logisticsInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.blur(input);
    const save = screen.getByText("Save Budgets").closest("button") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it("allows positive budgets within the 150% ceiling when revenue exists", () => {
    // Turn view: 500/turn = 12,000/day against a 10,000/day revenue ceiling (15,000).
    renderBudgetTab({ financials: { totalRevenue: 10_000 } });
    const input = logisticsInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "500" } });
    fireEvent.blur(input);
    const save = screen.getByText("Save Budgets").closest("button") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it("clamps a 279-digit typed budget instead of emitting a 1e+278 float", () => {
    renderBudgetTab({ financials: { totalRevenue: 0 } });
    const input = logisticsInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2".padEnd(279, "7") } });
    fireEvent.blur(input);
    // After commit the input re-displays the daily rate scaled back to the
    // period view. The regression was Number("2".padEnd(279,"7")) becoming a
    // 1e+278 float; the clamp keeps the committed figure in integer territory.
    expect(input.value).toMatch(/^\d+$/);
    expect(input.value).not.toMatch(/e\+/i);
    expect(Number(input.value)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER + 1);
  });
});
