/** @vitest-environment happy-dom */
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/corporations.json";
import { GroupFinancialComparison } from "./GroupFinancialComparison";
import type { GroupManagementView } from "./useGroupManagement";
import type { GroupBalanceSheet } from "@/lib/corporations/groups/groupBalanceSheet";
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (n: number) => "A" + n }),
}));
const history = (revenue: number, income: number) =>
  Array.from({ length: 48 }, (_, i) => ({
    turn: 100 - i,
    revenue,
    income,
    costs: revenue - income,
    cash: 5000 - i,
  }));
const data = {
  currentTurn: 100,
  members: [
    {
      id: "a",
      pathId: "1",
      name: "Parent",
      isRoot: true,
      operator: "player",
      currentDebtAnchor: 400,
      history: history(100, 20),
    },
    {
      id: "b",
      pathId: "2",
      name: "Child",
      isRoot: false,
      operator: "npp",
      currentDebtAnchor: 100,
      history: history(200, 80),
    },
  ],
} as unknown as GroupManagementView;
const sheet = {
  members: [
    { corporationId: "a", liquidCapitalAnchor: 2000 },
    { corporationId: "b", liquidCapitalAnchor: 3000 },
  ],
} as unknown as GroupBalanceSheet;
function mount(value = data, summary: GroupBalanceSheet | null = sheet) {
  render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      <GroupFinancialComparison data={value} sheet={summary} />
    </NextIntlClientProvider>
  );
}
afterEach(cleanup);
const summary = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
describe("Group financial comparison", () => {
  it("updates selected totals and subsidiaries-only selection, and disables export when cleared", () => {
    mount();
    expect(summary("Selected revenue")).toBe("A300");
    expect(summary("Selected net income")).toBe("A100");
    expect(summary("Weighted net margin")).toBe("33.3%");
    fireEvent.click(screen.getByRole("button", { name: "Subsidiaries only" }));
    expect(summary("Selected revenue")).toBe("A200");
    expect(summary("Selected current cash")).toBe("A3000");
    expect((screen.getByRole("checkbox", { name: "Parent" }) as HTMLInputElement).checked).toBe(
      false
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect((screen.getByRole("button", { name: /Export CSV/ }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });
  it("changes flow basis without scaling cash, debt or margin", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Financial time basis"), { target: { value: "day" } });
    expect(summary("Selected revenue")).toBe("A7200");
    expect(summary("Selected current cash")).toBe("A5000");
    expect(summary("Weighted net margin")).toBe("33.3%");
    expect(
      within(
        screen.getByRole("table", { name: "Selected corporation financial comparison" })
      ).getByText("A500")
    ).toBeTruthy();
  });
  it("sorts the comparison table and switches actual chart metrics and ranges", () => {
    mount();
    const table = screen.getByRole("table", { name: "Selected corporation financial comparison" });
    const header = within(table).getByRole("button", { name: "Revenue" });
    fireEvent.click(header);
    expect(header.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    expect(within(table).getAllByRole("row")[1].textContent).toContain("Parent");
    fireEvent.click(screen.getByRole("button", { name: "48 turns" }));
    expect(
      within(
        screen.getByRole("table", { name: "Selected corporation history data", hidden: true })
      ).getAllByRole("row", { hidden: true })
    ).toHaveLength(49);
    const metrics = screen.getByRole("group", { name: "Chart metric" });
    fireEvent.click(within(metrics).getByRole("button", { name: "Cash" }));
    expect(screen.getByRole("img", { name: "Cash trend by corporation" })).toBeTruthy();
  });
  it("keeps private and missing historical cash unavailable", () => {
    const value = structuredClone(data);
    value.members[1].history = null;
    value.members[1].currentDebtAnchor = null;
    mount(value);
    expect(summary("Selected revenue")).toBe("Unavailable");
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getAllByText("Private").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("checkbox", { name: "Child" }));
    expect(screen.getByRole("img", { name: "Revenue trend by corporation" })).toBeTruthy();
  });
  it("supports anchor display and rejects stale structure totals", () => {
    const stale = structuredClone(sheet);
    stale.members.pop();
    mount(data, stale);
    expect(summary("Selected current cash")).toBe("Unavailable");
    fireEvent.change(screen.getByLabelText("Display currency"), { target: { value: "anchor" } });
    expect(summary("Selected revenue")).toContain("₳");
  });
});
