/** @vitest-environment happy-dom */
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/corporations.json";
import { GroupSupplyChain } from "./GroupSupplyChain";
import type { GroupManagementView } from "./useGroupManagement";
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (n: number) => "A" + n }),
}));
vi.mock("../SupplyAgreementsSection", () => ({
  default: ({ corpId }: { corpId: string }) => <div>Agreement controls {corpId}</div>,
}));
const data = {
  canManage: true,
  currentTurn: 20,
  supplyEngineEnabled: true,
  supplyAgreementsEnabled: true,
  settings: { supplyPolicy: "independent", supplyDiscount: 0.1 },
  members: [
    {
      id: "p",
      pathId: "1",
      name: "Parent",
      operator: "player",
      isRoot: true,
      canEdit: true,
      receiving: false,
      requested: false,
      effectiveTurn: null,
    },
    { id: "n", pathId: "2", name: "NPP supplier", operator: "npp", canEdit: false },
    {
      id: "o",
      pathId: "3",
      name: "Other player",
      operator: "player",
      canEdit: false,
      receiving: null,
      requested: null,
      effectiveTurn: null,
    },
  ],
  forecast: {
    basisTurn: 19,
    appliesTurn: 21,
    corporations: [
      {
        id: "p",
        independentRevenue: 100,
        coordinatedRevenue: 110,
        revenueDifference: 10,
        operatingProfitDifference: 15,
        receivingValue: 90,
        supplyingValue: 0,
      },
    ],
    total: {
      independentRevenue: 200,
      coordinatedRevenue: 210,
      revenueDifference: 10,
      operatingProfitDifference: 10,
      internalTradingValue: 90,
    },
    connections: [
      {
        supplierId: "n",
        buyerId: "p",
        commodity: "steel",
        units: 50,
        benchmarkValue: 100,
        rebate: 10,
        estimatedPayment: 90,
      },
    ],
    connectionCount: 1,
  },
} as unknown as GroupManagementView;
function mount(value = data, save = vi.fn().mockResolvedValue(true), busy = false) {
  render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      <GroupSupplyChain data={value} busy={busy} save={save} />
    </NextIntlClientProvider>
  );
  return save;
}
afterEach(cleanup);
describe("Supply chain", () => {
  it("previews estimates without saving and applies only on explicit action", async () => {
    const save = mount();
    fireEvent.click(screen.getByRole("button", { name: /^Group members first/ }));
    expect(save).not.toHaveBeenCalled();
    expect(
      screen.getByRole("table", { name: "Selected policy: Group members first" })
    ).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/Apply Group members first before changing/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply Group members first" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ action: "policy", policy: "members" }));
  });
  it("cancels preview and leaves rejected changes available to retry", async () => {
    const save = mount(data, vi.fn().mockResolvedValue(false));
    fireEvent.click(screen.getByRole("button", { name: /^Group members first/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("table", { name: "Selected policy: Commercial independence" })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Group members first/ }));
    fireEvent.click(screen.getByRole("button", { name: "Apply Group members first" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Apply Group members first" })).toBeTruthy();
  });
  it("keeps discounts and participation on the saved members policy and preserves agreements", () => {
    const save = mount({ ...data, settings: { ...data.settings, supplyPolicy: "members" } });
    const checks = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checks.map((c) => c.disabled)).toEqual([false, true]);
    fireEvent.click(checks[0]);
    expect(save).toHaveBeenCalledWith({ action: "participation", enabled: true }, "p");
    fireEvent.change(screen.getByRole("combobox", { name: "Automatic Group Chain discount" }), {
      target: { value: "0.35" },
    });
    expect(save).toHaveBeenCalledWith({ action: "discount", discount: 0.35 });
    expect(
      screen.getByRole("link", { name: "Open corporation CEO Office" }).getAttribute("href")
    ).toBe("/corporation/1?tab=ceo");
    expect(screen.getByText("Agreement controls p")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Commercial independence/ }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("Agreement controls p")).toBeTruthy();
  });
  it("shows honest connection values and private notices without inventing delivery history", () => {
    mount();
    expect(screen.getByText("NPP supplier → Parent")).toBeTruthy();
    expect(screen.getAllByText("A10").length).toBeGreaterThan(0);
    expect(screen.getByText(/not settled deliveries/)).toBeTruthy();
    cleanup();
    mount({
      ...data,
      canManage: false,
      forecast: { ...data.forecast!, total: null, connections: [], connectionCount: null },
    });
    expect(screen.queryByText("NPP supplier → Parent")).toBeNull();
    expect(screen.getByText(/Full connection details/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /^Group members first/ }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
  it("handles missing forecasts and disables settings while saving", () => {
    mount({ ...data, forecast: null }, vi.fn(), true);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/Estimates become available/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /^Group members first/ }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});
