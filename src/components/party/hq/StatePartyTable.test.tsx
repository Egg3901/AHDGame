/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { StatePartyTable } from "./StatePartyTable";
import type { StatePartyRow } from "@/lib/states/buildStatePartyRows";

const ROWS: StatePartyRow[] = [
  {
    regionId: "CA",
    name: "California",
    organization: 70,
    politicalStrength: 40,
    treasury: 500000,
    registrationPct: 55,
    lean: -4,
    chairName: "Ada",
    nppCount: 3,
    isTarget: true,
    hasPresence: true,
  },
  {
    regionId: "WY",
    name: "Wyoming",
    organization: 15,
    politicalStrength: 80,
    treasury: 1000000,
    registrationPct: 20,
    lean: 6,
    chairName: null,
    nppCount: 0,
    isTarget: false,
    hasPresence: false,
  },
];

function renderTable(over?: Partial<React.ComponentProps<typeof StatePartyTable>>) {
  const props = {
    rows: ROWS,
    sel: new Set<string>(),
    onToggle: vi.fn(),
    onToggleAll: vi.fn(),
    onOpen: vi.fn(),
    sortKey: "organization" as const,
    sortDir: -1 as const,
    onSort: vi.fn(),
    ...over,
  };
  render(<StatePartyTable {...props} />);
  return props;
}

describe("StatePartyTable", () => {
  it("renders a row per region with vacant leadership shown", () => {
    renderTable();
    expect(screen.getByText("California")).toBeTruthy();
    expect(screen.getByText("Wyoming")).toBeTruthy();
    expect(screen.getByText(/Vacant/i)).toBeTruthy();
  });

  it("calls onSort with the column key when a sortable header is clicked", () => {
    const props = renderTable();
    fireEvent.click(screen.getByRole("button", { name: "PS" }));
    expect(props.onSort).toHaveBeenCalledWith("politicalStrength");
  });

  it("opens a region via its manage control", () => {
    const props = renderTable();
    const caRow = screen.getByText("California").closest("tr")!;
    fireEvent.click(within(caRow).getByTitle(/manage/i));
    expect(props.onOpen).toHaveBeenCalledWith("CA");
  });
});
