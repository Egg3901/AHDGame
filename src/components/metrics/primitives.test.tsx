/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HealthRing } from "./HealthRing";
import { Sparkline } from "./Sparkline";
import { ScoreBadge } from "./ScoreBadge";
import { TrendChip } from "./TrendChip";
import { TickChip } from "./TickChip";
import { ComparisonBar } from "./ComparisonBar";

describe("metrics primitives", () => {
  it("HealthRing renders its score", () => {
    render(<HealthRing score={72} />);
    expect(screen.getByText("72")).toBeTruthy();
  });

  it("ScoreBadge renders score and label", () => {
    render(<ScoreBadge score={88} label="Very Good" />);
    expect(screen.getByText("88")).toBeTruthy();
    expect(screen.getByText("Very Good")).toBeTruthy();
  });

  it("TrendChip shows a percentage for a non-trivial trend", () => {
    render(<TrendChip trend={2.4} isHigherBetter={true} />);
    expect(screen.getByText(/2\.4%/)).toBeTruthy();
  });

  it("TrendChip shows flat for a negligible trend", () => {
    render(<TrendChip trend={0.01} isHigherBetter={true} />);
    expect(screen.getByText(/flat/i)).toBeTruthy();
  });

  it("TickChip renders a per-turn rate", () => {
    render(<TickChip tick={0.25} isHigherBetter={true} suffix="%" />);
    expect(screen.getByText(/\/turn/)).toBeTruthy();
  });

  it("TickChip renders nothing for a zero tick", () => {
    const { container } = render(<TickChip tick={0} isHigherBetter={true} />);
    expect(container.textContent).toBe("");
  });

  it("ComparisonBar renders without throwing", () => {
    const { container } = render(<ComparisonBar value={10} avg={8} isHigherBetter={true} />);
    expect(container.querySelector("div")).toBeTruthy();
  });

  it("Sparkline renders an svg polyline", () => {
    const { container } = render(<Sparkline data={[1, 3, 2, 5, 4]} />);
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.querySelector("polyline")).toBeTruthy();
  });
});
