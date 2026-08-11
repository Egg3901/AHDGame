/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Delta, Sparkline, StatTile } from "./primitives";

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
