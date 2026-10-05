/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FundTradePanel } from "./FundTradePanel";

afterEach(cleanup);

const DDM_PER_ANCHOR = 4.76;

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    // Home-preference DD viewer: ₳ → Marks. Matches ticket #1072 (buy M376 vs
    // redeem showing a dollar face amount with the wrong currency).
    formatFull: (n: number) => `M${Math.round(n * DDM_PER_ANCHOR)}`,
    formatPrice: (n: number) => `M${(n * DDM_PER_ANCHOR).toFixed(2)}`,
    forexEnabled: true,
    forexRates: { USD: 1, DDM: DDM_PER_ANCHOR },
    ratesLoading: false,
    toInternalFrom: (n: number) => n,
  }),
}));

describe("FundTradePanel currency display (ticket #1072)", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ character: null }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("quotes subscribe cost and redeem payout in the same display currency", () => {
    render(
      <FundTradePanel
        fundId="global_sector_defense"
        quotedNav={79}
        anchorCurrencyCode="USD"
        status="active"
        myUnits={1}
        myLegacyUnits={0}
        onSuccess={() => {}}
      />
    );

    expect(screen.getByText("Estimated cost").nextElementSibling?.textContent).toBe("M376");
    expect(screen.queryByText("$79.00")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Redeem" }));

    expect(screen.getByText("Quoted payout").nextElementSibling?.textContent).toBe("M376");
    expect(screen.queryByText("$79.00")).toBeNull();
  });

  it("quotes the subscribe cost in the same face currency as the spendable balance", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        character: {
          currencyBalances: { personal: { USD: 500 } },
          homeCurrency: "USD",
          autoConvertEnabled: true,
        },
      }),
    }) as unknown as typeof fetch;
    render(
      <FundTradePanel
        fundId="global_sector_defense"
        quotedNav={79}
        anchorCurrencyCode="USD"
        status="active"
        myUnits={0}
        myLegacyUnits={0}
        onSuccess={() => {}}
      />
    );

    const spendable = await screen.findByText("Spendable in USD");
    expect(spendable.nextElementSibling?.textContent).toBe("$500.00");
    expect(screen.getByText("Estimated cost").nextElementSibling?.textContent).toBe("$79.00");
    expect(screen.getByText("After purchase").nextElementSibling?.textContent).toBe("$421.00");
  });

  it.each(["subscribe", "redeem"] as const)(
    "retries an acknowledged-lost %s once, then permits a new intentional command",
    async (mode) => {
      let committed = 0;
      let loseResponse = true;
      const receipts = new Set<string>();
      const requestIds: unknown[] = [];
      const onSuccess = vi.fn();
      global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return {
            ok: true,
            json: async () => ({ character: { cashOnHand: 10_000 } }),
          };
        }
        const body = JSON.parse(String(init.body)) as { operationId?: string };
        requestIds.push(body.operationId);
        if (!body.operationId || !receipts.has(body.operationId)) committed++;
        if (body.operationId) receipts.add(body.operationId);
        if (loseResponse) {
          loseResponse = false;
          throw new TypeError("response lost after server committed");
        }
        return { ok: true, json: async () => ({ status: "paid" }) };
      }) as unknown as typeof fetch;
      render(
        <FundTradePanel
          fundId="test"
          quotedNav={10}
          anchorCurrencyCode="USD"
          status="active"
          myUnits={20}
          myLegacyUnits={0}
          defaultMode={mode}
          onSuccess={onSuccess}
        />
      );
      const submit = () =>
        screen
          .getAllByRole("button", {
            name: mode === "subscribe" ? "Subscribe" : "Redeem units",
          })
          .at(-1)!;
      await waitFor(() => expect(submit().hasAttribute("disabled")).toBe(false));
      fireEvent.click(submit());
      await screen.findByText("Network error");
      expect(screen.getByRole("spinbutton").hasAttribute("disabled")).toBe(true);
      expect(screen.getByRole("status").textContent).toContain(
        "Cash or units may already have moved"
      );
      fireEvent.click(submit());
      await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
      expect(committed).toBe(1);
      expect(typeof requestIds[0]).toBe("string");
      expect(requestIds[1]).toBe(requestIds[0]);
      fireEvent.click(submit());
      await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(2));
      expect(committed).toBe(2);
      expect(requestIds[2]).not.toBe(requestIds[0]);
    }
  );
});
