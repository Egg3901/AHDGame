/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LeanStrip } from "./LeanStrip";

afterEach(cleanup);

const metrics = [-5, -3, -1, 0, 1, 3, 5].map((lean, i) => ({
  id: `economy.m${i}`,
  lean,
  leanLabel: "Mixed",
  displayName: `Metric ${i}`,
  value: 10 * i + 20,
  status: "Stable",
}));

describe("LeanStrip", () => {
  it("renders 7 bars in lean order with accessible labels and click-through", () => {
    const onOpenMetric = vi.fn();
    render(<LeanStrip metrics={metrics} onOpenMetric={onOpenMetric} />);
    const bars = screen.getAllByRole("button");
    expect(bars).toHaveLength(7);
    expect(screen.getByRole("button", { name: /Metric 0/ })).toBe(bars[0]);
    bars[0].click();
    expect(onOpenMetric).toHaveBeenCalledWith("economy.m0");
  });
});
