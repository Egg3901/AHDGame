import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

const { recompute, multipliers, snapshots } = vi.hoisted(() => ({
  recompute: vi.fn(),
  multipliers: vi.fn(),
  snapshots: vi.fn(),
}));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/turn/corporation/recomputeSharePrices", () => ({
  recomputeSharePricesAfterBondTurn: recompute,
}));
vi.mock("@/lib/corporations/applyPriceMultipliers", () => ({ applyPriceMultipliers: multipliers }));
vi.mock("@/lib/turn/stockExchangeSnapshot", () => ({
  generateStockExchangeSnapshots: snapshots,
}));

import { runMarketTick } from "./marketTick";

function fakeDb(state: Record<string, unknown> | null) {
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
  const db = {
    collection: () => ({ findOne: vi.fn().mockResolvedValue(state), updateOne }),
  } as unknown as Db;
  return { db, updateOne };
}

describe("runMarketTick", () => {
  const now = new Date("2026-10-09T20:15:00Z");
  beforeEach(() => {
    vi.clearAllMocks();
    recompute.mockResolvedValue({ corpsRepriced: 4, corpsSkipped: 1 });
    multipliers.mockResolvedValue({ updated: 4, pulseCount: 2 });
    snapshots.mockResolvedValue(undefined);
  });

  it("re-prices against the last completed turn, then sentiment, then snapshots", async () => {
    const { db, updateOne } = fakeDb({ currentTurn: 56, isActive: true, isProcessing: false });
    const result = await runMarketTick(now, db);
    expect(result).toMatchObject({ turn: 56, corpsRepriced: 4, corpsSkipped: 1, pricesUpdated: 4 });
    expect(recompute).toHaveBeenCalledWith(56, db, { intraHour: true });
    expect(recompute.mock.invocationCallOrder[0]).toBeLessThan(
      multipliers.mock.invocationCallOrder[0]
    );
    expect(multipliers.mock.invocationCallOrder[0]).toBeLessThan(
      snapshots.mock.invocationCallOrder[0]
    );
    expect(snapshots).toHaveBeenCalledWith(56, db);
    expect(updateOne).toHaveBeenCalledWith({ _id: "current" }, { $set: { lastMarketTickAt: now } });
  });

  it("skips an inactive world", async () => {
    const { db } = fakeDb({ currentTurn: 56, isActive: false });
    expect(await runMarketTick(now, db)).toBeNull();
    expect(recompute).not.toHaveBeenCalled();
  });

  it("skips while a live turn holds the lock", async () => {
    const { db } = fakeDb({
      currentTurn: 56,
      isActive: true,
      isProcessing: true,
      processingHeartbeatAt: new Date(now.getTime() - 60_000),
    });
    expect(await runMarketTick(now, db)).toBeNull();
    expect(recompute).not.toHaveBeenCalled();
  });

  it("keeps markets moving under a stale lock (a turn died mid-process)", async () => {
    const { db } = fakeDb({
      currentTurn: 56,
      isActive: true,
      isProcessing: true,
      processingHeartbeatAt: new Date(now.getTime() - 60 * 60_000),
    });
    expect(await runMarketTick(now, db)).not.toBeNull();
    expect(recompute).toHaveBeenCalled();
  });
});
