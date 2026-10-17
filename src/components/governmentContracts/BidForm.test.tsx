/** @vitest-environment happy-dom */
import { afterEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/corporations.json";
import { BidForm, type ContractAccess } from "./ContractForms";
import type { TenderView } from "@/lib/governmentContracts/types";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const tender = {
  _id: "t",
  countryId: "US",
  terms: {
    type: "extraction",
    stateId: "MN",
    resource: "iron",
    share: 0.1,
    minimumSigningFeeAnchor: 500,
  },
  bids: [{ corporationId: "a", amount: 1000, revision: 2, withdrawn: false }],
} as TenderView;
const access = {
  corporations: [
    {
      _id: "a",
      name: "Synthetic A",
      type: "extraction",
      countryId: "JP",
      currencyQuote: { code: "JPY", rate: 100 },
      sectors: [{ stateId: "MN" }],
    },
    {
      _id: "b",
      name: "Synthetic B",
      type: "extraction",
      countryId: "US",
      currencyQuote: { code: "USD", rate: 1.25 },
      sectors: [{ stateId: "MN" }],
    },
  ],
} as ContractAccess;
function show(a = access) {
  const fetcher = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetcher);
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BidForm countryId="US" tender={tender} access={a} onDone={() => {}} />
    </NextIntlClientProvider>
  );
  return fetcher;
}
it("changes denomination with corporation selection and posts the canonical bid, without reinterpreting the prior bid", async () => {
  const fetcher = show();
  const fee = screen.getByLabelText(
    /Signing fee your corporation offers to pay/
  ) as HTMLInputElement;
  expect(fee.value).toBe("100000");
  expect(fee.min).toBe("50000");
  expect(screen.getByText(/corporation pays the government/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Bidding corporation"), { target: { value: "b" } });
  const switched = screen.getByLabelText(
    /Signing fee your corporation offers to pay/
  ) as HTMLInputElement;
  expect(switched.value).toBe("");
  expect(switched.min).toBe("625");
  expect(switched.disabled).toBe(false);
  fireEvent.change(switched, { target: { value: "1250" } });
  fireEvent.submit(switched.closest("form")!);
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  expect(
    JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
  ).toMatchObject({ corporationId: "b", amount: 1000 });
});
it("blocks new bids when rates are unavailable while preserving canonical withdrawal", async () => {
  const fetcher = show({
    ...access,
    corporations: [{ ...access.corporations[0], currencyQuote: null }],
  });
  expect((screen.getByRole("button", { name: "Revise bid" }) as HTMLButtonElement).disabled).toBe(
    true
  );
  fireEvent.click(screen.getByRole("button", { name: "Withdraw bid" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  expect(
    JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
  ).toMatchObject({ amount: 1000, expectedRevision: 2, withdraw: true });
});
