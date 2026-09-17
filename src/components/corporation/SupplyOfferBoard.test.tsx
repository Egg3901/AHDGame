// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/../messages/en/corporations.json";
import { SupplyOfferBoard } from "./SupplyOfferBoard";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("hands a selected public offer to negotiation without accepting a contract", async () => {
  const listing = {
    id: "other:0",
    corporationId: "other",
    corporationName: "Other Co",
    slot: 0,
    own: false,
    side: "sell",
    commodity: "energy",
    volumeCap: 123,
    pricePremium: 0.05,
    expiresAtTurn: 200,
  };
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ listings: [listing], ownListings: [], hasMore: false }),
  });
  vi.stubGlobal("fetch", fetcher);
  const respond = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SupplyOfferBoard corpId="self" onRespond={respond} />
    </NextIntlClientProvider>
  );
  await waitFor(() => expect(screen.getByText("Review and negotiate")).toBeTruthy());
  fireEvent.click(screen.getByText("Review and negotiate"));
  expect(respond).toHaveBeenCalledWith(listing);
  expect(fetcher.mock.calls.every((call) => call[1]?.method !== "POST")).toBe(true);
});
it("publishes an offer in an unused slot and exposes failures", async () => {
  const fetcher = vi.fn().mockImplementation(async (_url, options) =>
    options?.method === "POST"
      ? { ok: false, json: async () => ({ error: "Offer rejected" }) }
      : {
          ok: true,
          json: async () => ({
            listings: [],
            ownListings: [{ id: "self:0", slot: 0, side: "sell", commodity: "energy" }],
            hasMore: false,
          }),
        }
  );
  vi.stubGlobal("fetch", fetcher);
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SupplyOfferBoard corpId="self" onRespond={vi.fn()} />
    </NextIntlClientProvider>
  );
  await waitFor(() => expect(screen.queryByText("Loading offers...")).toBeNull());
  fireEvent.click(screen.getByText("Post an offer"));
  fireEvent.change(screen.getByLabelText(/Quantity per turn/), { target: { value: "50" } });
  fireEvent.click(screen.getByText("Publish offer"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Offer rejected"));
  const call = fetcher.mock.calls.find((call) => call[1]?.method === "POST");
  expect(JSON.parse(call![1].body)).toMatchObject({ action: "publish", slot: 1, volumeCap: 50 });
});
