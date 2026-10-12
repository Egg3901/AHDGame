/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/corporations.json";
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (n: number) => "A" + n }),
}));
vi.mock("./useGroupManagement", () => ({ useGroupManagement: vi.fn() }));
vi.mock("../GroupOverviewCard", () => ({ GroupOverviewCard: () => null }));
import { useGroupManagement, type GroupManagementView } from "./useGroupManagement";
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
  it("compares selected members and allows clearing selection", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Financials & comparison" }));
    await waitFor(() => expect(screen.getAllByText("A300").length).toBeTruthy());
    expect(screen.getByText("A140")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    await waitFor(() => expect(screen.queryAllByText("A300").length).toBe(0));
  });
  it("hides receiving controls under commercial independence", () => {
    window.history.replaceState(null, "", "#supply");
    mount();
    expect(screen.queryByRole("checkbox", { name: "Receive supply from group" })).toBeNull();
    expect(screen.getByText(/Supply coordination is not active/)).toBeTruthy();
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
