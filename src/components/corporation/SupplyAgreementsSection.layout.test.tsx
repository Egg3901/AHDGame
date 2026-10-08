/** @vitest-environment happy-dom */
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import SupplyAgreementsSection from "./SupplyAgreementsSection";
import messages from "../../../messages/en/corporations.json";

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("supply-listings")
          ? {
              listings: Array.from({ length: 20 }, (_, index) => ({
                id: `offer-${index}`,
                corporationId: `seller-${index}`,
                corporationName: `Supplier ${index}`,
                slot: 0,
                own: false,
                side: "sell",
                commodity: "energy",
                volumeCap: 100,
                pricePremium: 0,
                expiresAtTurn: 200,
              })),
              ownListings: [],
              hasMore: false,
            }
          : { agreements: [] },
    }))
  );
});

it("opens the proposal beside its button, above a populated supply board, and closes it", async () => {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SupplyAgreementsSection corpId="buyer" />
    </NextIntlClientProvider>
  );
  await screen.findByText("Supplier 19");
  const button = screen.getByRole("button", { name: "Propose agreement" });
  fireEvent.click(button);
  const form = document.getElementById("supply-proposal-buyer");
  expect(form).not.toBeNull();
  // A long offer board must not push the newly opened form below the viewport.
  expect(button.parentElement?.nextElementSibling).toBe(form);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(button.getAttribute("aria-controls")).toBe(form?.id);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(document.getElementById("supply-proposal-buyer")).toBeNull();
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByText("Supplier 19")).toBeTruthy();
});

it("keeps listing negotiation prefilled when the proposal opens above the board", async () => {
  const scrollIntoView = vi.fn();
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(scrollIntoView);
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SupplyAgreementsSection corpId="buyer" />
    </NextIntlClientProvider>
  );
  await screen.findByText("Supplier 19");
  fireEvent.click(screen.getAllByRole("button", { name: "Negotiate" })[0]!);
  const form = document.getElementById("supply-proposal-buyer")!;
  expect(within(form).getByText("Supplier 0")).toBeTruthy();
  expect(within(form).getByText("Supplier corporation")).toBeTruthy();
  expect(within(form).getByRole("combobox")).toHaveProperty("value", "energy");
  expect(within(form).getAllByRole("spinbutton")[0]).toHaveProperty("value", "100");
  expect(screen.getByRole("button", { name: "Close" }).parentElement?.nextElementSibling).toBe(
    form
  );
});
