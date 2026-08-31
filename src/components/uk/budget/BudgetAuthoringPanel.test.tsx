/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetAuthoringPanel } from "./BudgetAuthoringPanel";

const BASE = {
  fiscalYear: 1961,
  isChancellor: true,
  isActingChancellor: false,
  canAuthor: true,
  chancellorVacant: false,
  taxLevers: [
    {
      id: "uk.tax.incomeTax",
      label: "Income Tax and Surtax Act",
      taxType: "incomeTax",
      minRate: 0,
      maxRate: 60,
      step: 1,
      currentRate: 45,
    },
  ],
  programLevers: [
    {
      id: "uk.defense.armedForces.primary",
      label: "Armed Forces and National Service Act",
      category: "defense",
      currentLevel: 3,
      levels: [
        { level: 0, label: "Skeleton Forces", description: "Token establishment." },
        { level: 1, label: "Regular Forces", description: "Professional forces." },
        { level: 2, label: "Strong Standing Forces", description: "Strong establishment." },
        { level: 3, label: "National Service", description: "Conscript establishment." },
        { level: 4, label: "Mobilized", description: "War footing." },
      ],
    },
  ],
  currentFiscal: { revenue: 7_550, spending: 8_120, gdp: 19_950, debtPrincipal: 30_010 },
  budget: null,
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("BudgetAuthoringPanel", () => {
  it("hydrates live statutory settings and enables tabling only after a real change", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => BASE }));
    render(<BudgetAuthoringPanel countryCode="uk" />);

    await waitFor(() => expect(screen.getByText("Income Tax and Surtax Act")).toBeTruthy());
    expect(screen.getByDisplayValue("45")).toBeTruthy();
    expect(screen.getByDisplayValue("National Service")).toBeTruthy();
    const table = screen.getByText("Table Budget") as HTMLButtonElement;
    expect(table.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Armed Forces and National Service Act"), {
      target: { value: "1" },
    });
    expect(table.disabled).toBe(false);
  });

  it("previews the fiscal result before the Commons vote", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => BASE })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          current: { revenue: 7_550, spending: 8_120, balance: -570 },
          projected: { revenue: 8_150, spending: 7_620, balance: 530 },
          categoryDeltas: { defense: -500 },
          phaseInTurns: 10,
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<BudgetAuthoringPanel countryCode="uk" />);
    await waitFor(() => screen.getByText("Income Tax and Surtax Act"));
    fireEvent.change(screen.getByLabelText("Income Tax and Surtax Act"), {
      target: { value: "55" },
    });
    fireEvent.click(screen.getByText("Preview Budget"));

    await waitFor(() => expect(screen.getByText(/Projected surplus/)).toBeTruthy());
    expect(screen.getByText("defense spending")).toBeTruthy();
    expect(screen.getByText("-£500.0")).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/country/uk/budget",
      expect.objectContaining({ method: "POST" })
    );

    fireEvent.change(screen.getByLabelText("Income Tax and Surtax Act"), {
      target: { value: "54" },
    });
    expect(screen.queryByText(/Projected surplus/)).toBeNull();
  });

  it("lets the Prime Minister act while the Chancellorship is vacant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...BASE,
          isChancellor: false,
          isActingChancellor: true,
          chancellorVacant: true,
        }),
      })
    );
    render(<BudgetAuthoringPanel countryCode="uk" />);
    await waitFor(() => expect(screen.getByText(/acting Chancellor authority/)).toBeTruthy());
    expect(screen.getByText("Save draft")).toBeTruthy();
  });

  it("shows a read-only note when the viewer has no fiscal authority", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...BASE, isChancellor: false, canAuthor: false }),
      })
    );
    render(<BudgetAuthoringPanel countryCode="uk" />);
    await waitFor(() => expect(screen.getByText(/Only the Chancellor/)).toBeTruthy());
  });

  it("renders a tabled Budget read-only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...BASE,
          budget: {
            status: "tabled",
            taxRates: { "uk.tax.incomeTax": 50 },
            programLevels: { "uk.defense.armedForces.primary": 1 },
          },
        }),
      })
    );
    render(<BudgetAuthoringPanel countryCode="uk" />);
    await waitFor(() => expect(screen.getByText(/tabled before the Commons/)).toBeTruthy());
    expect(screen.queryByText("Save draft")).toBeNull();
  });
});
