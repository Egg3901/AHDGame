/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/corporations.json";
import { GroupSupplyForecast } from "./GroupSupplyForecast";
import type { GroupManagementView } from "./useGroupManagement";
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (n: number) => "A" + n }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const data = {
  settings: { supplyPolicy: "independent" },
  members: [
    { id: "s", name: "Supplier" },
    { id: "b", name: "Buyer" },
  ],
  forecast: {
    basisTurn: 10,
    appliesTurn: 12,
    corporations: [
      {
        id: "s",
        independentRevenue: 100,
        coordinatedRevenue: 120,
        revenueDifference: 20,
        operatingProfitDifference: -5,
        receivingValue: 0,
        supplyingValue: 95,
      },
      {
        id: "b",
        independentRevenue: 200,
        coordinatedRevenue: 200,
        revenueDifference: 0,
        operatingProfitDifference: 25,
        receivingValue: 95,
        supplyingValue: 0,
      },
    ],
    total: {
      independentRevenue: 300,
      coordinatedRevenue: 320,
      revenueDifference: 20,
      operatingProfitDifference: 20,
      internalTradingValue: 95,
    },
  },
} as GroupManagementView;
const view = (value: GroupManagementView) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    <GroupSupplyForecast data={value} />
  </NextIntlClientProvider>
);
it("changes per-corporation and group estimates with the selected policy", () => {
  const { rerender } = render(view(data));
  const independent = screen.getByRole("table", {
    name: "Selected policy: Commercial independence",
  });
  expect(within(independent).getByText("A300")).toBeTruthy();
  expect(within(independent).queryByText("A95")).toBeNull();
  expect(within(independent).queryByText("A-5")).toBeNull();
  rerender(view({ ...data, settings: { ...data.settings, supplyPolicy: "members" } }));
  const group = screen.getByRole("table", { name: "Selected policy: Group members first" });
  expect(within(group).getByText("A320")).toBeTruthy();
  expect(within(group).getByText("A-5")).toBeTruthy();
  expect(within(group).getByText("A25")).toBeTruthy();
  expect(within(group).getAllByText("A95")).toHaveLength(2);
  expect(screen.getByText("Compare both supply policies")).toBeTruthy();
});
it("preserves private totals and does not fabricate a missing forecast", () => {
  const { rerender } = render(
    view({
      ...data,
      forecast: {
        ...data.forecast!,
        total: null,
        corporations: data.forecast!.corporations.slice(1),
      },
    })
  );
  const table = screen.getByRole("table", { name: "Selected policy: Commercial independence" });
  expect(within(table).queryByText("Combined group total")).toBeNull();
  expect(within(table).queryByText("Supplier")).toBeNull();
  rerender(view({ ...data, forecast: null }));
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByText(/Estimates become available/)).toBeTruthy();
});

it("exports only authorized rows and omits private totals", async () => {
  let blob: Blob | undefined;
  const create = vi.fn((value: Blob) => {
    blob = value;
    return "blob:test";
  });
  const ActualURL = URL;
  vi.stubGlobal(
    "URL",
    class extends ActualURL {
      static createObjectURL = create;
      static revokeObjectURL = vi.fn();
    }
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(
    view({
      ...data,
      forecast: {
        ...data.forecast!,
        total: null,
        corporations: data.forecast!.corporations.slice(1),
      },
    })
  );
  fireEvent.click(screen.getByRole("button", { name: "Export estimates (anchor CSV)" }));
  const csv = await blob!.text();
  expect(csv).toContain('"Buyer"');
  expect(csv).not.toContain('"Supplier"');
  expect(csv).not.toContain('"Combined group total"');
  expect(csv).toContain("Anchor currency per turn");
  expect(csv).toContain("Commercial independence");
});
it("disables exporting when no private corporations are visible", () => {
  render(view({ ...data, forecast: { ...data.forecast!, corporations: [], total: null } }));
  expect(
    (screen.getByRole("button", { name: "Export estimates (anchor CSV)" }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});
