/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { BudgetAuthoringPanel } from "./BudgetAuthoringPanel";

const BASE = {
  fiscalYear: 1953,
  isChancellor: true,
  taxLevers: [
    { id: "uk.tax.incomeTax", label: "Income Tax and Surtax Act" },
    { id: "uk.tax.salesTax", label: "Purchase and Consumption Levies Act" },
  ],
  spendingCategories: ["defense", "education", "healthcare"],
  budget: null,
};

function stubGet(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("BudgetAuthoringPanel", () => {
  it("renders levers and categories for the Chancellor", async () => {
    stubGet(BASE);
    render(<BudgetAuthoringPanel countryCode="uk" />);
    await waitFor(() => expect(screen.getByText("Income Tax and Surtax Act")).toBeTruthy());
    expect(screen.getByText("healthcare")).toBeTruthy();
    expect(screen.getByText("Budget 1953")).toBeTruthy();
  });

  it("disables Table until spending sums to 100", async () => {
    stubGet(BASE);
    render(<BudgetAuthoringPanel countryCode="uk" />);
    await waitFor(() => screen.getByText("healthcare"));
    const table = screen.getByText("Table Budget") as HTMLButtonElement;
    expect(table.disabled).toBe(true); // 0/100

    const inputs = screen.getAllByRole("spinbutton");
    // last three are the spending inputs (after 2 tax levers)
    const spend = inputs.slice(2);
    fireEvent.change(spend[0], { target: { value: "40" } });
    fireEvent.change(spend[1], { target: { value: "30" } });
    fireEvent.change(spend[2], { target: { value: "30" } });
    await waitFor(() => expect(screen.getByText("100 / 100")).toBeTruthy());
    expect((screen.getByText("Table Budget") as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a read-only note to a non-Chancellor", async () => {
    stubGet({ ...BASE, isChancellor: false });
    render(<BudgetAuthoringPanel countryCode="uk" />);
    await waitFor(() =>
      expect(screen.getByText(/Only the Chancellor of the Exchequer/)).toBeTruthy()
    );
  });

  it("renders a tabled budget read-only", async () => {
    stubGet({
      ...BASE,
      budget: {
        status: "tabled",
        taxRates: { "uk.tax.incomeTax": 25 },
        spendingAllocations: { healthcare: 100 },
      },
    });
    render(<BudgetAuthoringPanel countryCode="uk" />);
    await waitFor(() =>
      expect(screen.getByText(/has been tabled before the Commons/)).toBeTruthy()
    );
    expect(screen.queryByText("Save draft")).toBeNull();
  });
});
