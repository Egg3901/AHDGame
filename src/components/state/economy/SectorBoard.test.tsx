/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SectorBoard, type SectorBoardTile } from "./SectorBoard";

const tiles: SectorBoardTile[] = [
  {
    type: "financial",
    label: "Financial",
    totalMarket: 3_940_000,
    ownedPercent: 64,
    avgGrowth: 2.45,
  },
  {
    type: "energy",
    label: "Energy",
    totalMarket: 4_820_000,
    ownedPercent: 78,
    star: { rank: "primary", bonus: 10 },
    avgGrowth: -1.3,
  },
  {
    type: "technology",
    label: "Technology",
    totalMarket: 3_410_000,
    ownedPercent: 51,
    star: { rank: "secondary", bonus: 5 },
    avgGrowth: null,
  },
];

const fmt = (v: number) => `$${(v / 1_000_000).toFixed(1)}M`;

describe("SectorBoard", () => {
  it("renders one tile per sector, sorted by market size descending", () => {
    render(
      <SectorBoard tiles={tiles} selectedType="financial" onSelect={() => {}} formatMarket={fmt} />
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("data-sector"))).toEqual([
      "energy",
      "financial",
      "technology",
    ]);
  });

  it("marks specialization tiles with their bonus", () => {
    render(
      <SectorBoard tiles={tiles} selectedType="financial" onSelect={() => {}} formatMarket={fmt} />
    );
    expect(screen.getByText(/1st \+10pp/)).toBeTruthy();
    expect(screen.getByText(/2nd \+5pp/)).toBeTruthy();
  });

  it("selects a sector on tile click", () => {
    const onSelect = vi.fn();
    render(
      <SectorBoard tiles={tiles} selectedType="financial" onSelect={onSelect} formatMarket={fmt} />
    );
    fireEvent.click(screen.getByText("Technology"));
    expect(onSelect).toHaveBeenCalledWith("technology");
  });

  it("on mobile shows only the selected tile full-width and hides the rest", () => {
    render(
      <SectorBoard tiles={tiles} selectedType="energy" onSelect={() => {}} formatMarket={fmt} />
    );
    const buttons = screen.getAllByRole("button");
    const selected = buttons.find((b) => b.getAttribute("data-sector") === "energy");
    const other = buttons.find((b) => b.getAttribute("data-sector") === "financial");
    // selected tile spans the full mobile grid and is never hidden
    expect(selected?.className).toContain("col-span-2");
    expect(selected?.className).not.toContain("hidden");
    // non-selected tiles are hidden below sm, shown at sm+
    expect(other?.className).toContain("hidden");
    expect(other?.className).toContain("sm:block");
  });

  it("flags the selected tile via aria-pressed", () => {
    render(
      <SectorBoard tiles={tiles} selectedType="energy" onSelect={() => {}} formatMarket={fmt} />
    );
    const selected = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("data-sector") === "energy");
    expect(selected?.getAttribute("aria-pressed")).toBe("true");
    const other = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("data-sector") === "financial");
    expect(other?.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows the formatted market size on each tile", () => {
    render(
      <SectorBoard tiles={tiles} selectedType="financial" onSelect={() => {}} formatMarket={fmt} />
    );
    expect(screen.getByText("$4.8M")).toBeTruthy();
  });

  it("shows colored average growth, signed, replacing the owned percentage", () => {
    render(
      <SectorBoard tiles={tiles} selectedType="financial" onSelect={() => {}} formatMarket={fmt} />
    );
    // owned % is no longer the bottom label
    expect(screen.queryByText("78%")).toBeNull();
    expect(screen.getAllByText("Avg. Growth").length).toBe(tiles.length);

    const pos = screen.getByText("+2.45%");
    expect(pos.className).toContain("text-success");
    const neg = screen.getByText("-1.30%");
    expect(neg.className).toContain("text-error");
    // unknown growth → muted em-dash
    const unknown = screen.getByText("—");
    expect(unknown.className).toContain("text-muted");
  });
});
