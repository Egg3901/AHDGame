/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlendVitals } from "./BlendVitals";

const CELLS = [
  { label: "War chest", value: "$1.28M", sub: "+$52,400 / turn", color: "#fbbf24" },
  { label: "Actions", value: "14", sub: "+9 / turn", color: "#22d3ee" },
  { label: "Support", value: "63.4", sub: "+1.84 pending", color: "#e8e8ee" },
  { label: "Strength", value: "412", sub: "+8.2% vote boost", color: "#dc2626" },
];

describe("BlendVitals", () => {
  it("renders every cell's label, value and sub", () => {
    render(<BlendVitals cells={CELLS} />);
    for (const c of CELLS) {
      expect(screen.getByText(c.label)).toBeTruthy();
      expect(screen.getByText(c.value)).toBeTruthy();
      expect(screen.getByText(c.sub)).toBeTruthy();
    }
  });

  it("applies each cell's own colour to its value", () => {
    render(<BlendVitals cells={CELLS} />);
    expect(screen.getByText("$1.28M").getAttribute("style")).toContain("#fbbf24");
    expect(screen.getByText("412").getAttribute("style")).toContain("#dc2626");
  });

  it("omits the sub line when a cell has none", () => {
    render(<BlendVitals cells={[{ label: "Field", value: "5", color: "#e8e8ee" }]} />);
    expect(screen.getByText("Field")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("draws a divider on every cell but the last", () => {
    const { container } = render(<BlendVitals cells={CELLS} />);
    const cells = container.querySelectorAll("[data-blend-vital]");
    expect(cells).toHaveLength(4);
    expect(cells[0].getAttribute("style")).toContain("border-right");
    expect(cells[3].getAttribute("style")).not.toContain("border-right");
  });

  it("renders a short list without inventing empty cells", () => {
    const { container } = render(<BlendVitals cells={CELLS.slice(0, 2)} />);
    expect(container.querySelectorAll("[data-blend-vital]")).toHaveLength(2);
  });
});
