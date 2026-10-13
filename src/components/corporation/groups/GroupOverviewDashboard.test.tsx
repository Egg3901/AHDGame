/** @vitest-environment happy-dom */
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/corporations.json";
import { GroupOverviewDashboard } from "./GroupOverviewDashboard";
import type { GroupManagementView } from "./useGroupManagement";
import type { GroupBalanceSheet } from "@/lib/corporations/groups/groupBalanceSheet";
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (n: number) => "A" + n }),
}));
const rows = Array.from({ length: 48 }, (_, i) => ({
  turn: 100 - i,
  revenue: 100,
  costs: 60,
  income: 40,
}));
const data = {
  rootId: "a",
  settings: { supplyPolicy: "independent" },
  currentTurn: 100,
  members: [
    { id: "a", pathId: "1", name: "Parent", isRoot: true, operator: "player", history: rows },
    {
      id: "b",
      pathId: "2",
      name: "Child",
      isRoot: false,
      operator: "npp",
      history: rows.map((r) => ({ ...r, income: -10 })),
      parentControl: { corporationId: "a", votingPercent: 75 },
    },
  ],
} as unknown as GroupManagementView;
const sheet = {
  members: [
    { corporationId: "a", sectorCount: 3, regionCount: 2 },
    { corporationId: "b", sectorCount: 2, regionCount: 2 },
  ],
  totalSectorCount: 5,
  totalRegionCount: 3,
  totalLiquidCapitalAnchor: 1000,
} as unknown as GroupBalanceSheet;
function mount(value = data, summary: GroupBalanceSheet | null = sheet) {
  return render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      <GroupOverviewDashboard data={value} sheet={summary} />
    </NextIntlClientProvider>
  );
}
afterEach(cleanup);
describe("Group overview dashboard", () => {
  it("shows real completed figures, contribution bars, cards and comparison navigation", () => {
    mount();
    expect(screen.getByText("Group revenue").nextElementSibling?.textContent).toBe("A200");
    expect(screen.getByText("Group net income").nextElementSibling?.textContent).toBe("A30");
    expect(screen.getByText("A1000")).toBeTruthy();
    expect(screen.getAllByRole("meter").map((m) => m.getAttribute("value"))).toEqual(["50", "50"]);
    expect(screen.getByText("Parent: 75% voting control")).toBeTruthy();
    expect(screen.getAllByText("A-10").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Compare corporations/ }).getAttribute("href")).toBe(
      "#financials"
    );
  });
  it("changes the real history window with the range buttons", () => {
    mount();
    const table = screen.getByRole("table", { hidden: true });
    expect(within(table).getAllByRole("row", { hidden: true })).toHaveLength(25);
    fireEvent.click(screen.getByRole("button", { name: "12 turns" }));
    expect(within(table).getAllByRole("row", { hidden: true })).toHaveLength(13);
    fireEvent.click(screen.getByRole("button", { name: "48 turns" }));
    expect(within(table).getAllByRole("row", { hidden: true })).toHaveLength(49);
  });
  it("preserves privacy and does not derive missing private totals by subtraction", () => {
    const value = structuredClone(data);
    value.members[1].history = null;
    mount(value);
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.queryByRole("img", { name: "Revenue trend" })).toBeNull();
    expect(screen.getByText("Complete Group results are unavailable or private.")).toBeTruthy();
    expect(screen.getAllByText("Private").length).toBe(2);
    expect(screen.queryByText("A200")).toBeNull();
    expect(screen.queryByText("A30")).toBeNull();
  });
  it("does not show stale structure totals for a changed member set", () => {
    const changed = structuredClone(sheet);
    changed.members.pop();
    mount(data, changed);
    expect(screen.queryByText("A1000")).toBeNull();
  });
});
