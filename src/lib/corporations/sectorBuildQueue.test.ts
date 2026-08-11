import { describe, expect, it } from "vitest";
import { summarizeBuildQueue } from "@/lib/corporations/sectorBuildQueue";
import type { SectorBuildOrder } from "@/lib/db/types";

function order(partial: Partial<SectorBuildOrder>): SectorBuildOrder {
  return { unitsOrdered: 100, costPaidAnchor: 1_000, startTurn: 0, onlineTurn: 48, ...partial };
}

describe("summarizeBuildQueue", () => {
  it("returns null for an absent or empty queue", () => {
    expect(summarizeBuildQueue(undefined, 10)).toBeNull();
    expect(summarizeBuildQueue(null, 10)).toBeNull();
    expect(summarizeBuildQueue([], 10)).toBeNull();
  });

  it("sums units across the whole queue, not just the head order", () => {
    const summary = summarizeBuildQueue(
      [order({ unitsOrdered: 100 }), order({ unitsOrdered: 250 }), order({ unitsOrdered: 50 })],
      0
    );
    expect(summary?.orders).toBe(3);
    expect(summary?.unitsOrdered).toBe(400);
  });

  it("reports the SOONEST delivery, not the last one queued", () => {
    // Orders are stored oldest-first, but a later order on a faster line can
    // land first. Showing the array's last onlineTurn would tell a CEO their
    // capacity is years out when some of it arrives next week.
    const summary = summarizeBuildQueue(
      [order({ onlineTurn: 90 }), order({ onlineTurn: 60 }), order({ onlineTurn: 120 })],
      50
    );
    expect(summary?.nextOnlineTurn).toBe(60);
    expect(summary?.turnsRemaining).toBe(10);
  });

  it("floors the countdown at zero for an order the turn processor has not yet landed", () => {
    const summary = summarizeBuildQueue([order({ onlineTurn: 40 })], 55);
    expect(summary?.turnsRemaining).toBe(0);
  });

  it("ignores non-finite unit counts rather than summing to NaN", () => {
    const summary = summarizeBuildQueue(
      [order({ unitsOrdered: Number.NaN }), order({ unitsOrdered: 300 })],
      0
    );
    expect(summary?.unitsOrdered).toBe(300);
  });
});
