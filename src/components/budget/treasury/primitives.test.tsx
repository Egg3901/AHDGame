/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Delta, Sparkline, StatTile } from "./primitives";
import { FiscalStatStrip } from "./FiscalStatStrip";

describe("Delta", () => {
  it("renders nothing when there is no prior value", () => {
    const { container } = render(<Delta now={10} prev={null} kind="money" sym="¥" />);
    expect(container.textContent).toBe("");
  });

  it("renders a compact money delta with a sign", () => {
    const { container } = render(<Delta now={1_200_000} prev={1_000_000} kind="money" sym="¥" />);
    expect(container.textContent).toContain("+¥200");
  });

  it("renders a percentage-point delta", () => {
    const { container } = render(<Delta now={74} prev={72} kind="pct" />);
    expect(container.textContent).toBe("+2.0pp");
  });

  it("colors a rise red when inverted (e.g. spending/debt)", () => {
    const { container } = render(<Delta now={13} prev={12} kind="money" sym="$" invert />);
    expect(container.querySelector(".text-error")).toBeTruthy();
  });
});

describe("Sparkline", () => {
  it("renders a polyline for a multi-point series", () => {
    const { container } = render(<Sparkline data={[1, 2, 3, 2, 4]} />);
    expect(container.querySelector("polyline")).toBeTruthy();
  });

  it("renders gracefully for a single point", () => {
    const { container } = render(<Sparkline data={[5]} />);
    expect(container.querySelector("polyline")).toBeTruthy();
  });
});

describe("StatTile", () => {
  it("shows the label, value and sub", () => {
    const { container } = render(<StatTile label="Revenue" value="¥49.6T" sub="of GDP" />);
    expect(container.textContent).toContain("Revenue");
    expect(container.textContent).toContain("¥49.6T");
    expect(container.textContent).toContain("of GDP");
  });
});

describe("FiscalStatStrip USD equivalent (ticket-1065)", () => {
  const base = {
    sym: "руб",
    revenue: 571_800_000_000,
    spending: 565_992_434_499,
    gdp: 1_029_166_000_000,
    gdpGrowth: 5.2,
    debtToGdp: 0.1,
    rating: "AAA" as const,
    treasuryReserve: 5_800_000_000,
  };

  it("keeps local-currency headlines and adds ≈ $ notes when toUsd is set", () => {
    const { container } = render(<FiscalStatStrip {...base} toUsd={(n) => n / 9} />);
    expect(container.textContent).toContain("руб 566.0B");
    expect(container.textContent).toContain("≈ $62.9B");
    expect(container.textContent).not.toContain("$565");
  });

  it("omits the dollar note when toUsd is absent (US budget, or flags not loaded)", () => {
    const { container } = render(<FiscalStatStrip {...base} />);
    expect(container.textContent).toContain("руб 566.0B");
    expect(container.textContent).not.toContain("≈ $");
  });
});
