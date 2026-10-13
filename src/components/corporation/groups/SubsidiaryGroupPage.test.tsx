/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/corporations.json";
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (n: number) => "A" + n }),
}));
vi.mock("./useGroupManagement", () => ({ useGroupManagement: vi.fn() }));
vi.mock("../SupplyAgreementsSection", () => ({
  default: ({ corpId }: { corpId: string }) => <div data-testid="agreements-panel">{corpId}</div>,
}));
vi.mock("../GroupOverviewCard", () => ({ GroupOverviewCard: () => null }));
import { useGroupManagement, type GroupManagementView } from "./useGroupManagement";
import { GroupSupplyOffice } from "./GroupSupplyOffice";
import { SubsidiaryGroupPage } from "./SubsidiaryGroupPage";
const root = "100000000000000000000001",
  child = "100000000000000000000002";
const base = {
  rootId: root,
  settings: { name: "Harbor Group", supplyPolicy: "independent" },
  currentTurn: 20,
  canManage: true,
  managementEnabled: true,
  supplyEngineEnabled: false,
  members: [
    {
      id: root,
      pathId: "1",
      name: "Parent",
      operator: "player",
      isRoot: true,
      canEdit: true,
      receiving: false,
      requested: false,
      effectiveTurn: null,
      direction: null,
      history: [{ turn: 19, revenue: 100, costs: 60, income: 40 }],
    },
    {
      id: child,
      pathId: "2",
      name: "Subsidiary",
      operator: "npp",
      isRoot: false,
      canEdit: false,
      receiving: true,
      requested: false,
      effectiveTurn: null,
      direction: null,
      history: [{ turn: 19, revenue: 200, costs: 100, income: 100 }],
    },
  ],
} as GroupManagementView;
function mount(data: GroupManagementView | null = structuredClone(base)) {
  vi.mocked(useGroupManagement).mockReturnValue({
    data,
    loading: false,
    error: "",
    busy: false,
    save: vi.fn(async () => true),
    refresh: vi.fn(),
  } as ReturnType<typeof useGroupManagement>);
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SubsidiaryGroupPage corpId="1" />
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  window.history.replaceState(null, "", "#overview");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        group: {
          members: [
            {
              corporationId: root,
              name: "Parent",
              revenueAnchor: 100,
              liquidCapitalAnchor: 10,
              sectorCount: 2,
            },
            {
              corporationId: child,
              name: "Subsidiary",
              revenueAnchor: 200,
              liquidCapitalAnchor: 20,
              sectorCount: 3,
            },
          ],
        },
      }),
    }))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("Subsidiary Group page", () => {
  it("has group sections but no corporation CEO Office tab", () => {
    mount();
    const nav = screen.getByRole("navigation", { name: "Group sections" });
    expect(within(nav).queryByRole("button", { name: "CEO Office" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Harbor Group" })).toBeTruthy();
  });
  it("keeps identity editing collapsed until the parent opens it", () => {
    mount();
    expect(screen.queryByRole("textbox", { name: "Group name" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit group identity" }));
    expect(screen.getByRole("textbox", { name: "Group name" })).toBeTruthy();
  });
  it("opens identity editing from another tab even after a previous edit was open", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit group identity" }));
    fireEvent.click(screen.getByRole("button", { name: "Financials & comparison" }));
    expect(
      screen.getByRole("button", { name: "Edit group identity" }).getAttribute("aria-expanded")
    ).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Edit group identity" }));
    expect(screen.getByRole("textbox", { name: "Group name" })).toBeTruthy();
  });
  it("compares selected members and allows clearing selection", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Financials & comparison" }));
    await waitFor(() => expect(screen.getAllByText("A300").length).toBeTruthy());
    expect(screen.getByText("A140")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    await waitFor(() => expect(screen.queryAllByText("A300").length).toBe(0));
  });
  it("hides receiving controls under commercial independence", async () => {
    window.history.replaceState(null, "", "#supply");
    mount();
    expect(screen.queryByRole("checkbox", { name: "Receive supply from group" })).toBeNull();
    await waitFor(() => expect(screen.getByText(/Supply coordination is disabled/)).toBeTruthy());
  });
  it("shows receiving controls under members first and keeps other players disabled", () => {
    window.history.replaceState(null, "", "#supply");
    const data = structuredClone(base);
    data.settings.supplyPolicy = "members";
    data.members[1].operator = "player";
    mount(data);
    const controls = screen.getAllByRole("checkbox", {
      name: "Receive supply from group",
    }) as HTMLInputElement[];
    expect(controls.map((c) => c.disabled)).toEqual([false, true]);
  });
  it("has an explicit no-group state", () => {
    mount(null);
    expect(screen.getByText(/not part of a formalized/)).toBeTruthy();
  });
});

describe("corporation office suggestions and supply estimates", () => {
  it("renders policy comparisons and identifies the fixed-output assumptions", async () => {
    const data = structuredClone(base);
    data.forecast = {
      basisTurn: 19,
      appliesTurn: 21,
      corporations: [
        {
          id: root,
          independentRevenue: 100,
          coordinatedRevenue: 120,
          revenueDifference: 20,
          operatingProfitDifference: 20,
          receivingValue: 0,
          supplyingValue: 120,
        },
      ],
      total: {
        independentRevenue: 100,
        coordinatedRevenue: 120,
        revenueDifference: 20,
        operatingProfitDifference: 20,
        internalTradingValue: 120,
      },
    };
    await act(async () => {
      mount(data);
    });
    fireEvent.click(screen.getByRole("button", { name: "Supply chain" }));
    expect(screen.getByText("Estimated supply policy effects")).toBeTruthy();
    expect(screen.getByText(/Estimates hold output/)).toBeTruthy();
    expect(screen.getAllByText("Combined group total")).toHaveLength(2);
  });
  it("shows the corporation CEO the suggestion details and sends its revision", () => {
    const data = structuredClone(base);
    data.regions = [{ id: "US-PA", name: "Pennsylvania", countryId: "US" }];
    data.members[0].direction = {
      revision: "revision",
      rootId: root,
      ceoId: "ceo",
      objective: "regional",
      regions: ["US-PA"],
      allowInvestment: false,
      setTurn: 19,
      response: "pending",
    };
    const save = vi.fn(async () => true);
    vi.mocked(useGroupManagement).mockReturnValue({
      data,
      loading: false,
      error: "",
      busy: false,
      save,
      refresh: vi.fn(),
    } as ReturnType<typeof useGroupManagement>);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <GroupSupplyOffice corpId="1" />
      </NextIntlClientProvider>
    );
    expect(screen.getByText("Target regions: Pennsylvania")).toBeTruthy();
    expect(screen.getByText("New capital investment is not authorized.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(save).toHaveBeenCalledWith({
      action: "respond",
      response: "acknowledged",
      revision: "revision",
    });
  });
});

describe("Group discounts and negotiated agreements", () => {
  it("saves the selected discount using the shared agreement band", async () => {
    window.history.replaceState(null, "", "#supply");
    const data = structuredClone(base);
    data.settings.supplyPolicy = "members";
    mount(data);
    const select = screen.getByRole("combobox", { name: "Automatic Group Chain discount" });
    expect(
      within(select).getByRole("option", { name: "35% discount (65% of market)" })
    ).toBeTruthy();
    fireEvent.change(select, { target: { value: "0.35" } });
    expect(vi.mocked(useGroupManagement).mock.results.at(-1)!.value.save).toHaveBeenCalledWith({
      action: "discount",
      discount: 0.35,
    });
  });
  it("hides automatic discounts under independence and preserves manual agreements", () => {
    window.history.replaceState(null, "", "#supply");
    const data = structuredClone(base);
    data.supplyAgreementsEnabled = true;
    mount(data);
    expect(screen.queryByRole("combobox", { name: "Automatic Group Chain discount" })).toBeNull();
    expect(screen.getByTestId("agreements-panel").textContent).toBe(root);
    expect(
      within(screen.getByRole("combobox", { name: "Manage agreements as" })).queryByRole("option", {
        name: "Subsidiary",
      })
    ).toBeNull();
  });
  it("restricts discount changes to the parent and switches agreements only between own corporations", () => {
    window.history.replaceState(null, "", "#supply");
    const data = structuredClone(base);
    data.settings.supplyPolicy = "members";
    data.canManage = false;
    data.supplyAgreementsEnabled = true;
    data.members[1].canEdit = true;
    data.members[1].operator = "player";
    mount(data);
    expect(
      (
        screen.getByRole("combobox", {
          name: "Automatic Group Chain discount",
        }) as HTMLSelectElement
      ).disabled
    ).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Manage agreements as" }), {
      target: { value: child },
    });
    expect(screen.getByTestId("agreements-panel").textContent).toBe(child);
  });
  it("keeps agreements behind the existing feature flag", () => {
    window.history.replaceState(null, "", "#supply");
    mount();
    expect(screen.queryByTestId("agreements-panel")).toBeNull();
  });
});
