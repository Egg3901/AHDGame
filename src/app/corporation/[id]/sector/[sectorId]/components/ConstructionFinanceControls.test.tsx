/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConstructionFinanceControls from "./ConstructionFinanceControls";
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency: string) => `${currency} ${amount}`,
  }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("construction finance consent", () => {
  it.each(["awaiting_approval", "funding"] as const)(
    "shows %s without fetching another lender quote",
    (status) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const onWithdraw = vi.fn();
      const onChange = vi.fn();
      render(
        <ConstructionFinanceControls
          view={{
            corporationId: "corp",
            currency: "USD",
            localPerAnchor: 1,
            pendingRequest: { claimId: "original", status },
          }}
          totalAnchor={100}
          constructionAnchor={100}
          cashAnchor={100}
          onChange={onChange}
          onWithdraw={onWithdraw}
        />
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(screen.queryByLabelText(/Finance this build/)).toBeNull();
      if (status === "awaiting_approval") {
        fireEvent.click(screen.getByRole("button", { name: "Withdraw construction request" }));
        expect(onWithdraw).toHaveBeenCalledWith("original");
      } else expect(screen.queryByRole("button")).toBeNull();
      expect(onChange).toHaveBeenCalledWith(null);
    }
  );
  it("requires reviewed whole-site consent and sufficient native contribution, preserving one request on retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            enabled: true,
            currency: "USD",
            lenders: [{ id: "bank-1", name: "Lender", ratePercent: 5, approvalRequired: true }],
          }),
          { status: 200 }
        )
      )
    );
    const onChange = vi.fn();
    render(
      <ConstructionFinanceControls
        view={{ corporationId: "corp", currency: "USD", localPerAnchor: 2 }}
        totalAnchor={50_000}
        constructionAnchor={50_000}
        cashAnchor={15_000}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByLabelText(/Finance this build/));
    await screen.findByRole("option", { name: /Lender/ });
    expect(onChange.mock.lastCall?.[0].request).toBeNull();
    expect(screen.getByText(/Your cash contribution/).textContent).toContain("USD 25750");
    fireEvent.click(screen.getByLabelText(/I pledge this sector/));
    await waitFor(() =>
      expect(onChange.mock.lastCall?.[0].request).toMatchObject({
        principal: 75_000,
        maximumCostLocal: 100_000,
        maximumRatePercent: 5,
        pledgeConsent: true,
      })
    );
    const key = onChange.mock.lastCall?.[0].request.requestId;
    expect(key).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Term \(turns\)/), { target: { value: "4.5" } });
    expect(onChange.mock.lastCall?.[0].request).toBeNull();
    fireEvent.change(screen.getByLabelText(/Term \(turns\)/), { target: { value: "48" } });
    fireEvent.click(screen.getByLabelText(/I pledge this sector/));
    expect(onChange.mock.lastCall?.[0].request.requestId).not.toBe(key);
    fireEvent.change(screen.getByLabelText(/Principal \(/), { target: { value: "10000" } });
    expect(onChange.mock.lastCall?.[0].affordable).toBe(false);
    expect(onChange.mock.lastCall?.[0].request).toBeNull();
  });
});
