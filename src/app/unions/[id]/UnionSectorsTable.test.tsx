/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { UnionSectorsTable, type UnionSectorsTableProps } from "./UnionSectorsTable";
import type { SectorRow } from "./unionTypes";

function row(id: string, overrides: Partial<SectorRow> = {}): SectorRow {
  return {
    sectorId: id,
    corporationId: `corp-${id}`,
    corporationName: `Corp ${id}`,
    stateId: "TX",
    wageLevel: 1,
    workers: 100,
    wageGap: null,
    unionization: 10,
    representingUnionId: null,
    strikeActive: false,
    strikeCooldownUntilTurn: null,
    strikeBlockReason: null,
    ...overrides,
  };
}

function renderTable(props: Partial<UnionSectorsTableProps> = {}) {
  const onOrganize = vi.fn();
  const onOrganizeBatch = vi.fn(async (ids: string[]) => ids);
  render(
    <UnionSectorsTable
      unionId="u1"
      approval={60.25}
      sectors={[
        row("a", { corporationName: "Zeta Steel", workers: 300 }),
        row("b", { corporationName: "Alpha Steel", workers: 900, representingUnionId: "u2" }),
        row("c", { corporationName: "Mid Steel", stateId: "OH", strikeActive: true }),
      ]}
      treasury={1_000_000}
      myActions={10}
      canOrganize
      organizeActionCost={1}
      organizeGain={2.5}
      actionPending={false}
      onOrganize={onOrganize}
      onOrganizeBatch={onOrganizeBatch}
      {...props}
    />
  );
  return { onOrganize, onOrganizeBatch };
}

function corpOrder(): string[] {
  return screen
    .getAllByRole("link")
    .map((a) => a.textContent ?? "")
    .filter((t) => t.endsWith("Steel"));
}

describe("UnionSectorsTable", () => {
  it("explains every column with a touch-friendly tooltip", () => {
    renderTable();
    for (const label of [
      "Corporation",
      "Representing union",
      "State",
      "Workers",
      "Wage",
      "Demand gap",
      "Unionization",
      "Status",
      "Drive",
    ]) {
      expect(screen.getByRole("button", { name: `What ${label} means` })).toBeTruthy();
    }
  });

  it("sorts by a column and reverses on a second click", () => {
    renderTable();
    expect(corpOrder()).toEqual(["Zeta Steel", "Alpha Steel", "Mid Steel"]);
    fireEvent.click(screen.getByRole("button", { name: "Corporation" }));
    expect(corpOrder()).toEqual(["Alpha Steel", "Mid Steel", "Zeta Steel"]);
    fireEvent.click(screen.getByRole("button", { name: /^Corporation/ }));
    expect(corpOrder()).toEqual(["Zeta Steel", "Mid Steel", "Alpha Steel"]);
  });

  it("filters by text, status and representation", () => {
    renderTable();
    fireEvent.change(screen.getByLabelText(/filter sectors by corporation or state/i), {
      target: { value: "oh" },
    });
    expect(corpOrder()).toEqual(["Mid Steel"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByLabelText(/filter sectors by strike status/i), {
      target: { value: "striking" },
    });
    expect(corpOrder()).toEqual(["Mid Steel"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByLabelText(/filter sectors by representing union/i), {
      target: { value: "rival" },
    });
    expect(corpOrder()).toEqual(["Alpha Steel"]);
  });

  it("keeps the single-row drive, labelled Raid on a rival's shop", () => {
    const { onOrganize } = renderTable();
    expect(screen.getAllByRole("button", { name: "Organize" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Raid" }));
    expect(onOrganize).toHaveBeenCalledWith("b");
  });

  it("runs the ticked shops together and clears the ones that landed", async () => {
    const { onOrganizeBatch } = renderTable();
    fireEvent.click(screen.getByLabelText("Select Zeta Steel in TX"));
    fireEvent.click(screen.getByLabelText("Select Mid Steel in OH"));
    const bar = screen.getByRole("region", { name: "Selected drives" });
    expect(within(bar).getByText("2 shops selected")).toBeTruthy();
    fireEvent.click(within(bar).getByRole("button", { name: "Run 2 drives" }));
    expect(onOrganizeBatch).toHaveBeenCalledWith(["a", "c"]);
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Selected drives" })).toBeNull()
    );
  });

  it("blocks a batch the head cannot pay for, and says why", () => {
    renderTable({ myActions: 1 });
    fireEvent.click(screen.getByLabelText("Select every shop shown"));
    const run = screen.getByRole("button", { name: "Run 3 drives" }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(screen.getByText(/needs 3 action points, you have 1/i)).toBeTruthy();
  });

  it("hides selection and drives from anyone who is not the sitting head", () => {
    renderTable({ canOrganize: false });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Organize" })).toBeNull();
    expect(screen.queryByRole("button", { name: "What Drive means" })).toBeNull();
  });
});

it("names each shop's representative and counts only represented members across all unions", () => {
  renderTable({
    sectors: [
      row("ours", {
        representingUnionId: "u1",
        representingUnionName: "Our union",
        unionization: 20,
      }),
      row("rival", {
        representingUnionId: "u2",
        representingUnionName: "Rival union",
        unionization: 30,
      }),
      row("none", { unionization: 90 }),
      row("deleted", { representingUnionId: "gone", unionization: 10 }),
    ],
  });
  expect(screen.getByRole("link", { name: "Our union" }).getAttribute("href")).toBe("/unions/u1");
  expect(screen.getByRole("link", { name: "Rival union" }).getAttribute("href")).toBe("/unions/u2");
  expect(screen.getByText("Unrepresented")).toBeTruthy();
  expect(screen.getByText("Unknown union (gone)")).toBeTruthy();
  for (const [shop, count] of [
    ["ours", "20"],
    ["rival", "30"],
    ["deleted", "10"],
  ]) {
    const shopRow = screen.getByRole("link", { name: `Corp ${shop}` }).closest("tr")!;
    expect(within(shopRow).getByText(count)).toBeTruthy();
  }
  const unrepresented = screen.getByRole("link", { name: "Corp none" }).closest("tr")!;
  expect(within(unrepresented).getByText("0")).toBeTruthy();
  expect(screen.getByText(/60 of 400 workers organized across all unions/)).toBeTruthy();
  expect(screen.getByText(/one representing union per shop/i)).toBeTruthy();
});

describe("current raid approval comparison", () => {
  it.each([
    [55.251, "4.999", false],
    [55.25000000000001, "<5", false],
    [55.24999999999999, ">5", true],
    [55.25, "5", true],
    [55.249, "5.001", true],
    [60.25, "0", false],
    [65.25, "-5", false],
  ])("shows rival approval %s without rounding the outcome", (rivalApproval, edge, meets) => {
    renderTable({
      canOrganize: false,
      sectors: [
        row("rival", {
          representingUnionId: "u2",
          representingUnionName: "Rival union",
          representingUnionApproval: rivalApproval,
        }),
      ],
    });
    expect(screen.getByText(`Rival approval: ${rivalApproval}%`)).toBeTruthy();
    expect(screen.getByText("This union: 60.25%")).toBeTruthy();
    expect(screen.getByText(`Current edge: ${edge} points (needs 5)`)).toBeTruthy();
    expect(
      screen.getByText(meets ? "Meets current raid edge" : "Below current raid edge")
    ).toBeTruthy();
    expect(screen.getByText(/approval can change before a drive runs/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Raid" })).toBeNull();
  });

  it("does not invent a contest for own, unrepresented or dangling sectors", () => {
    renderTable({
      sectors: [
        row("own", { representingUnionId: "u1", representingUnionApproval: 60.25 }),
        row("none"),
        row("gone", { representingUnionId: "missing", representingUnionApproval: null }),
      ],
    });
    expect(screen.queryByText(/Current edge:/)).toBeNull();
    expect(screen.queryByText(/Rival approval:/)).toBeNull();
    expect(screen.getByText("Rival approval unavailable; no live rival to contest.")).toBeTruthy();
  });

  it("keeps selection, filters, sorting and the mounted table when approval refreshes", () => {
    const sectors = [
      row("a", {
        corporationName: "Zeta Steel",
        representingUnionId: "u2",
        representingUnionApproval: 56,
      }),
      row("b", {
        corporationName: "Alpha Steel",
        representingUnionId: "u2",
        representingUnionApproval: 56,
      }),
    ];
    const props = {
      unionId: "u1",
      approval: 60.25,
      sectors,
      treasury: 1000000,
      myActions: 10,
      canOrganize: true,
      organizeActionCost: 1,
      organizeGain: 3,
      actionPending: false,
      onOrganize: vi.fn(),
      onOrganizeBatch: vi.fn(async () => []),
    };
    const { rerender } = render(<UnionSectorsTable {...props} />);
    fireEvent.change(screen.getByLabelText(/filter sectors by corporation or state/i), {
      target: { value: "Steel" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Corporation" }));
    fireEvent.click(screen.getByLabelText("Select Zeta Steel in TX"));
    const table = screen.getByRole("table");
    table.parentElement!.scrollLeft = 80;
    rerender(<UnionSectorsTable {...props} approval={62} />);
    expect(screen.getByRole("table")).toBe(table);
    expect(table.parentElement!.scrollLeft).toBe(80);
    expect(corpOrder()).toEqual(["Alpha Steel", "Zeta Steel"]);
    expect(
      (screen.getByLabelText(/filter sectors by corporation or state/i) as HTMLInputElement).value
    ).toBe("Steel");
    expect((screen.getByLabelText("Select Zeta Steel in TX") as HTMLInputElement).checked).toBe(
      true
    );
    expect(screen.getAllByText("Meets current raid edge")).toHaveLength(2);
  });
});
