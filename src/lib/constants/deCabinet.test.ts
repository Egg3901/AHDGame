import { describe, expect, it } from "vitest";
import { DE_CABINET_POSITIONS } from "./deCabinet";
import { DE_CABINET_MECHANICS } from "./deCabinetMechanics";
import { DE_MINISTERIAL_ORDERS } from "./deCabinetOrders";

describe("DE cabinet", () => {
  it("has 11 cabinet positions", () => {
    expect(DE_CABINET_POSITIONS.length).toBe(11);
  });

  it("has unique position IDs", () => {
    const ids = DE_CABINET_POSITIONS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("orders are sequential from 1", () => {
    const orders = DE_CABINET_POSITIONS.map((p) => p.order).sort((a, b) => a - b);
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("every position has mechanics", () => {
    for (const pos of DE_CABINET_POSITIONS) {
      expect(DE_CABINET_MECHANICS[pos.id]).toBeDefined();
      expect(DE_CABINET_MECHANICS[pos.id]!.positionId).toBe(pos.id);
    }
  });

  it("every position has 2 ministerial orders", () => {
    for (const pos of DE_CABINET_POSITIONS) {
      const orders = DE_MINISTERIAL_ORDERS[pos.id];
      expect(orders).toBeDefined();
      expect(orders!.length).toBe(2);
    }
  });

  it("order IDs are prefixed with de_", () => {
    for (const pos of DE_CABINET_POSITIONS) {
      for (const order of DE_MINISTERIAL_ORDERS[pos.id] ?? []) {
        expect(order.id.startsWith("de_")).toBe(true);
      }
    }
  });

  it("finance minister has federal grants allocation", () => {
    const fm = DE_CABINET_MECHANICS.finance_minister;
    expect(fm.allocation).toBeDefined();
    expect(fm.allocation!.name).toBe("Federal Grants Allocation");
  });

  it("all orders have valid durations", () => {
    for (const pos of DE_CABINET_POSITIONS) {
      for (const order of DE_MINISTERIAL_ORDERS[pos.id] ?? []) {
        expect(order.duration).toBeGreaterThan(0);
        expect(order.effects.length).toBeGreaterThan(0);
      }
    }
  });
});
