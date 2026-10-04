/** @vitest-environment happy-dom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/en/corporations.json";
import { PropBookPanel } from "./PropBookPanel";

describe("forex fee cash preview", () => {
  it("quotes before buying and binds the accepted total cash cost", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          fee: 50,
          cost: 5050,
          proceeds: 4950,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, cost: 5050, fee: 50 }),
      });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <PropBookPanel
            corporationId="10"
            currency="USD"
            positions={[]}
            markValue={0}
            sovereignTreasuryMarkValue={0}
            cashReserves={1_000_000}
            totalLoans={0}
            borrowings={{}}
            propLeverage={null}
            forexFeesEnabled
            canMutate
            onChanged={vi.fn().mockResolvedValue(undefined)}
            showToast={vi.fn()}
          />
        </NextIntlClientProvider>
      );
      fireEvent.change(screen.getByLabelText("Investment asset type"), {
        target: { value: "forex" },
      });
      fireEvent.change(screen.getByLabelText("Investment position currency"), {
        target: { value: "GBP" },
      });
      fireEvent.change(screen.getByLabelText("Investment position units"), {
        target: { value: "10000" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Quote forex trade" }));
      await screen.findByRole("button", { name: "Buy quoted position" });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        asset: "forex",
        ref: "GBP",
        units: 10000,
        quoteOnly: true,
      });
      fireEvent.click(screen.getByRole("button", { name: "Buy quoted position" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
        asset: "forex",
        ref: "GBP",
        units: 10000,
        maxCost: 5050,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
