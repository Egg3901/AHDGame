import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { loadUSMediaOutletDelivery } from "./turnData";

const politicalOrders = vi.hoisted(() => ({ load: vi.fn(async () => []) }));
vi.mock("@/lib/politicalMedia/journal", () => ({
  loadPoliticalMediaOrdersForClearing: politicalOrders.load,
}));

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
      {
        _id: "canonical-entertainment",
        stateId: "CA",
        corporationId: { toString: () => "corp-3" },
        sectorType: "media",
        mediaDiscriminator: "entertainment",
        strategyId: "live_service",
        producedUnits: 100,
        soldFraction: 1,
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
      sectorType: "media",
    });
    expect(find.mock.calls[0][1].projection).toMatchObject({
      producedUnits: 1,
      soldByCommodity: 1,
      outputUnitsByCommodity: 1,
      mediaDiscriminator: 1,
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

  it("counts current political allocations only after the matching seller receipt is applied", async () => {
    politicalOrders.load.mockResolvedValue([
      {
        orderId: "paid-order",
        identity: { orderId: "paid-order", targetStateId: "CA" },
        status: "settled",
        settlementPlan: {
          plannedTurn: 12,
          plannedUnits: 20,
          sellers: [
            {
              allocationId: "paid-a",
              sectorId: "sector-1",
              corporationId: "corp-1",
              units: 10,
            },
            {
              allocationId: "unpaid-b",
              sectorId: "sector-1",
              corporationId: "corp-1",
              units: 10,
            },
          ],
        },
      },
    ] as never);
    const sectorFind = vi.fn().mockReturnValue({
      toArray: async () => [
        {
          _id: "sector-1",
          stateId: "CA",
          corporationId: { toString: () => "corp-1" },
          sectorType: "media",
          strategyId: "standard",
          producedUnits: 100,
          outputUnitsByCommodity: { advertising: 1000 },
          soldByCommodity: { advertising: 0.8 },
          soldByCommodityTurn: 12,
          soldUnitsByCommodity: { advertising: 80 },
          soldUnitsByCommodityTurn: 12,
        },
      ],
    });
    const corpFind = vi.fn().mockReturnValue({ toArray: async () => [] });
    const receiptFind = vi.fn().mockReturnValue({
      toArray: async () => [
        {
          _id: "political-media-seller:paid-order:paid-a",
          kind: "political-media-seller-receipt",
          status: "applied",
          turn: 12,
          politicalMediaOrderIdentity: {
            orderId: "paid-order",
            allocationId: "paid-a",
            targetStateId: "CA",
            sectorId: "sector-1",
            corporationId: "corp-1",
            units: 10,
          },
        },
        {
          _id: "political-media-seller:paid-order:paid-a",
          kind: "political-media-seller-receipt",
          status: "applied",
          turn: 12,
          politicalMediaOrderIdentity: {
            orderId: "paid-order",
            allocationId: "paid-a",
            targetStateId: "CA",
            sectorId: "sector-1",
            corporationId: "corp-1",
            units: 10,
          },
        },
      ],
    });
    const db = {
      collection: vi.fn((name: string) => {
        if (name === "corporateSectors") return { find: sectorFind };
        if (name === "corporations") return { find: corpFind };
        return { find: receiptFind };
      }),
    } as unknown as Db;

    const outlets = await loadUSMediaOutletDelivery(db, {
      currentTurn: 12,
      currentYear: 1991,
      includeSettledPolitical: true,
    });

    expect(outlets[0].deliveredAdvertisingUnits).toBeCloseTo(70);
    expect(receiptFind).toHaveBeenCalledWith(
      { kind: "political-media-seller-receipt", status: "applied", turn: 12 },
      { projection: expect.objectContaining({ _id: 1, politicalMediaOrderIdentity: 1 }) }
    );
  });

  it("rejects a previous-turn sales snapshot for current-turn concentration", async () => {
    politicalOrders.load.mockResolvedValue([]);
    const db = {
      collection: vi.fn((name: string) =>
        name === "corporateSectors"
          ? {
              find: vi.fn().mockReturnValue({
                toArray: async () => [
                  {
                    _id: "sector-1",
                    stateId: "CA",
                    corporationId: { toString: () => "corp-1" },
                    sectorType: "media",
                    strategyId: "standard",
                    outputUnitsByCommodity: { advertising: 100 },
                    soldByCommodity: { advertising: 0.9 },
                    soldByCommodityTurn: 20,
                    soldUnitsByCommodity: { advertising: 90 },
                    soldUnitsByCommodityTurn: 19,
                  },
                ],
              }),
            }
          : { find: vi.fn().mockReturnValue({ toArray: async () => [] }) }
      ),
    } as unknown as Db;

    const outlets = await loadUSMediaOutletDelivery(db, {
      currentTurn: 20,
      includeSettledPolitical: true,
    });

    expect(outlets[0].deliveredAdvertisingUnits).toBeNull();
  });
});
