/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarketTickNote, minutesSince, nextQuarterAt } from "./MarketTickNote";

it("uses the wall-clock market update even when the game clock is ahead", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T05:22:00Z"));
  const world = {
    lastMarketTickAt: "2026-10-09T05:15:00Z",
    lastTurnProcessed: "2026-10-11T05:00:00Z",
  };
  const view = render(<MarketTickNote {...world} />);
  try {
    expect(screen.getByText("Markets 7m ago")).toBeTruthy();
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

describe("market tick note helpers", () => {
  it("counts whole minutes since the last update", () => {
    expect(minutesSince(null, 1_000)).toBeNull();
    expect(minutesSince(0, 59_000)).toBe(0);
    expect(minutesSince(0, 7 * 60_000 + 5)).toBe(7);
    expect(minutesSince(10_000, 0)).toBe(0);
  });

  it("finds the next quarter-hour boundary", () => {
    const base = Date.UTC(2026, 9, 9, 20, 0, 0);
    expect(nextQuarterAt(base)).toBe(base + 15 * 60_000);
    expect(nextQuarterAt(base + 14 * 60_000)).toBe(base + 15 * 60_000);
    expect(nextQuarterAt(base + 31 * 60_000)).toBe(base + 45 * 60_000);
  });
});
