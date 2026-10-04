import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { loadUSMediaOutletDelivery } from "./turnData";

describe("loadUSMediaOutletDelivery", () => {
  it("projects ad production and sales in one indexed state/type query", async () => {
    const toArray = vi.fn().mockResolvedValue([
      {
        _id: "sector-1",
        stateId: "CA",
        corporationId: { toString: () => "corp-1" },
        sectorType: "media",
        strategyId: "standard",
        producedUnits: 100,
        soldByCommodity: { advertising: 0.8 },
      },
      {
        _id: "sector-2",
        stateId: "CA",
        corporationId: { toString: () => "corp-2" },
        sectorType: "entertainment",
        strategyId: "standard",
        producedUnits: 100,
        soldFraction: 0.5,
      },
    ]);
    const find = vi.fn().mockReturnValue({ toArray });
    const collection = vi.fn().mockReturnValue({ find });
    const db = { collection } as unknown as Db;

    const outlets = await loadUSMediaOutletDelivery(db, 48);

    expect(collection).toHaveBeenCalledOnce();
    expect(find).toHaveBeenCalledOnce();
    expect(find.mock.calls[0][0]).toMatchObject({
      stateId: { $in: expect.arrayContaining(["CA"]) },
      sectorType: { $in: ["media", "entertainment"] },
    });
    expect(find.mock.calls[0][1].projection).toMatchObject({
      producedUnits: 1,
      soldByCommodity: 1,
      outputUnitsByCommodity: 1,
    });
    expect(outlets).toHaveLength(2);
    expect(outlets[0]).toMatchObject({
      stateId: "CA",
      countryId: "US",
      corporationId: "corp-1",
      deliveredAdvertisingUnits: 80,
    });
    expect(outlets[1].deliveredAdvertisingUnits).toBeGreaterThan(0);
  });

  it("does not count transition-era estimates without a current turn or exact output", async () => {
    const toArray = vi.fn().mockResolvedValue([
      {
        _id: "sector-1",
        stateId: "CA",
        corporationId: { toString: () => "corp-1" },
        sectorType: "media",
        strategyId: "standard",
        transitionFromStrategyId: "legacy_broadcast",
        transitionStartTurn: 10,
        producedUnits: 100,
        soldFraction: 1,
      },
    ]);
    const db = {
      collection: vi.fn().mockReturnValue({ find: vi.fn().mockReturnValue({ toArray }) }),
    } as unknown as Db;

    const outlets = await loadUSMediaOutletDelivery(db);

    expect(outlets[0].deliveredAdvertisingUnits).toBeNull();
  });
});
