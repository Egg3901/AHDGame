/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NationalSeal } from "./NationalSeal";

describe("NationalSeal", () => {
  it("renders an SVG emblem bearing the national identity glyph by default", () => {
    const { container } = render(<NationalSeal country="CN" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(container.querySelector("text")?.textContent).toBe("国");
  });

  it("renders an overridden glyph (treasury chop) over the same brand", () => {
    const { container } = render(<NationalSeal country="CN" glyph="财" serif="cjk" />);
    expect(container.querySelector("text")?.textContent).toBe("财");
  });

  it("draws the per-country motif ring (China star-and-cog has gear teeth)", () => {
    const { container } = render(<NationalSeal country="CN" />);
    // The gearStar motif emits 24 rect "teeth"; a starRing emits none.
    expect(container.querySelectorAll("rect").length).toBeGreaterThanOrEqual(24);
  });

  it("respects a motif override", () => {
    const { container } = render(<NationalSeal country="CN" motif="starRing" />);
    // starRing has no rect teeth.
    expect(container.querySelectorAll("rect").length).toBe(0);
  });

  it("sizes the SVG to the requested edge length", () => {
    const { container } = render(<NationalSeal country="US" size={32} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("32");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 120 120");
  });
});
