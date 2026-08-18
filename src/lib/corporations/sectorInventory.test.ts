import { describe, it, expect } from "vitest";
import {
  advanceSectorInventory,
  INVENTORY_DRAIN_RATE_PER_TURN,
  INVENTORY_CARRY_COST_RATE_PER_TURN,
  type InventoryTurnInput,
} from "./sectorInventory";
import { COMMODITY_SPOILAGE_PER_TURN } from "@/lib/market/inventory";

const base = (over: Partial<InventoryTurnInput> = {}): InventoryTurnInput => ({
  inventory: {},
  stockpileEnabled: true,
  producedUnits: 1000,
  soldUnits: 600,
  soldFraction: 0.6,
  soldByCommodity: {},
  supplyRates: { iron: 0.4 },
  mixPriceAnchor: 50,
  ...over,
});

describe("advanceSectorInventory", () => {
  it("accrues the unsold remainder of a storable output", () => {
    const r = advanceSectorInventory(base());
    expect(r.accruedUnits).toBeCloseTo(400, 5);
    expect(r.nextInventory.iron).toBeCloseTo(400, 5);
    expect(r.drainedUnits).toBe(0);
  });

  it("accrues nothing with the toggle off, but an existing pile still spoils", () => {
    const r = advanceSectorInventory(base({ stockpileEnabled: false, inventory: { iron: 100 } }));
    expect(r.accruedUnits).toBe(0);
    const spoil = COMMODITY_SPOILAGE_PER_TURN.iron;
    expect(r.nextInventory.iron).toBeCloseTo(100 * (1 - spoil), 5);
  });

  it("never stores a non-storable output", () => {
    const r = advanceSectorInventory(base({ supplyRates: { freight: 0.45 } }));
    expect(r.accruedUnits).toBe(0);
    expect(r.nextInventory.freight).toBeUndefined();
  });

  it("sells down only when the fresh offer fully cleared, at the drain cap", () => {
    const held = 1000;
    const spoil = COMMODITY_SPOILAGE_PER_TURN.iron;
    const notCleared = advanceSectorInventory(
      base({ inventory: { iron: held }, soldFraction: 0.9, soldUnits: 900 })
    );
    expect(notCleared.drainedUnits).toBe(0);
    const cleared = advanceSectorInventory(
      base({ inventory: { iron: held }, soldFraction: 1, soldUnits: 1000 })
    );
    const afterSpoil = held * (1 - spoil);
    expect(cleared.drainedUnits).toBeCloseTo(afterSpoil * INVENTORY_DRAIN_RATE_PER_TURN, 5);
    expect(cleared.drainedRevenueAnchor).toBeCloseTo(cleared.drainedUnits * 50, 5);
  });

  it("charges carrying cost on the held pile", () => {
    const r = advanceSectorInventory(base({ soldFraction: 0.6 }));
    expect(r.carryCostAnchor).toBeCloseTo(r.heldUnits * 50 * INVENTORY_CARRY_COST_RATE_PER_TURN, 5);
  });

  it("splits accrual by per-commodity sold fractions when clearing itemized them", () => {
    // Two outputs with equal unit weight: iron cleared fully, coal barely.
    const r = advanceSectorInventory(
      base({
        supplyRates: { iron: 0.4, coal: 0.4 * (COMMODITY_SPOILAGE_PER_TURN.coal < 1 ? 1 : 1) },
        soldByCommodity: { iron: 1, coal: 0.2 },
        producedUnits: 1000,
        soldUnits: 600,
        soldFraction: 0.6,
      })
    );
    expect(r.nextInventory.iron ?? 0).toBe(0);
    expect(r.nextInventory.coal ?? 0).toBeGreaterThan(0);
  });

  it("holding forever loses money against selling (carry + spoilage are net-negative EV)", () => {
    // One unit held one turn costs carry + spoilage of its value; selling now
    // yields its value. The hoard EV must be strictly below the sell EV.
    const spoil = COMMODITY_SPOILAGE_PER_TURN.iron;
    const holdOneTurnValue = (1 - spoil) * (1 - INVENTORY_CARRY_COST_RATE_PER_TURN);
    expect(holdOneTurnValue).toBeLessThan(1);
  });
});
