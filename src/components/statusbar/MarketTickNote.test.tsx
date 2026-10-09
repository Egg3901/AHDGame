/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import {
  MarketTickNote,
  minutesSince,
  minutesUntilNextRefresh,
  nextQuarterAt,
} from "./MarketTickNote";

function renderAt(now: string, props: Parameters<typeof MarketTickNote>[0]) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  return render(<MarketTickNote {...props} />);
}

it("counts down to the next price refresh, like the turn timer", () => {
  const view = renderAt("2026-10-09T05:22:00Z", { lastMarketTickAt: "2026-10-09T05:15:00Z" });
  try {
    expect(view.container.textContent).toContain("Prices refresh in 8m");
    expect(view.container.querySelector("[title]")?.getAttribute("title")).toContain(
      "Last refresh 7 min ago"
    );
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

it("says how old prices are when refreshes stop landing", () => {
  const view = renderAt("2026-10-09T05:52:00Z", { lastMarketTickAt: "2026-10-09T05:15:00Z" });
  try {
    expect(view.container.textContent).toContain("Prices 37m old");
    expect(view.container.textContent).not.toContain("refresh in");
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

it("links to the status page when enabled, like the turn timer", () => {
  const view = renderAt("2026-10-09T05:22:00Z", {
    lastMarketTickAt: "2026-10-09T05:15:00Z",
    statusLink: true,
  });
  try {
    const link = view.container.querySelector("a");
    expect(link?.getAttribute("href")).toContain("status");
    expect(link?.getAttribute("target")).toBe("_blank");
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

  it("rounds the refresh countdown up to whole minutes", () => {
    const base = Date.UTC(2026, 9, 9, 20, 0, 0);
    expect(minutesUntilNextRefresh(base)).toBe(15);
    expect(minutesUntilNextRefresh(base + 14 * 60_000 + 30_000)).toBe(1);
    expect(minutesUntilNextRefresh(base + 7 * 60_000 + 1)).toBe(8);
  });

  it("finds the next quarter-hour boundary", () => {
    const base = Date.UTC(2026, 9, 9, 20, 0, 0);
    expect(nextQuarterAt(base)).toBe(base + 15 * 60_000);
    expect(nextQuarterAt(base + 14 * 60_000)).toBe(base + 15 * 60_000);
    expect(nextQuarterAt(base + 31 * 60_000)).toBe(base + 45 * 60_000);
  });
});
