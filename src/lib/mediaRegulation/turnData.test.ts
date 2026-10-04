import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { loadUSMediaOutletDelivery } from "./turnData";

describe("loadUSMediaOutletDelivery", () => {
  it("projects ad production and sales with ledger scaling and the current transition turn", async () => {
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
        sectorType: "media",
        strategyId: "legacy_broadcast",
        producedUnits: 100,
        soldFraction: 0.5,
      },
    ]);
    const find = vi.fn().mockReturnValue({ toArray });
    const corporationFind = vi.fn().mockReturnValue({ toArray: async () => [] });
    const collection = vi.fn((name: string) =>
      name === "corporateSectors" ? { find } : { find: corporationFind }
    );
    const db = { collection } as unknown as Db;

    const outlets = await loadUSMediaOutletDelivery(db, {
      currentTurn: 48,
      currentYear: 1991,
    });

    expect(collection).toHaveBeenCalledTimes(2);
    expect(find).toHaveBeenCalledOnce();
    expect(corporationFind).toHaveBeenCalledOnce();
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
      deliveredAdvertisingUnits: 8,
    });
    expect(outlets[1].deliveredAdvertisingUnits).toBeCloseTo(5);
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
    const corporationFind = vi.fn().mockReturnValue({ toArray: async () => [] });
    const db = {
      collection: vi.fn((name: string) =>
        name === "corporateSectors"
          ? { find: vi.fn().mockReturnValue({ toArray }) }
          : { find: corporationFind }
      ),
    } as unknown as Db;

    const outlets = await loadUSMediaOutletDelivery(db);

    expect(outlets[0].deliveredAdvertisingUnits).toBeNull();
  });
});
