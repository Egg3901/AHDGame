import { describe, expect, it } from "vitest";
import { IE_CABINET_POSITIONS } from "./ieCabinet";
import { IE_CABINET_MECHANICS } from "./ieCabinetMechanics";
import { IE_MINISTERIAL_ORDERS } from "./ieCabinetOrders";
import { getCabinetMechanics, getCabinetPositions } from "./cabinetMechanics";
import { getMinisterialOrders } from "./cabinetOrders";
import { isParliamentaryCabinetCountry } from "@/app/country/[code]/executive/cabinet/parliamentaryCabinetConfig";

describe("IE cabinet positions", () => {
  it("has 19 cabinet positions", () => {
    expect(IE_CABINET_POSITIONS.length).toBe(19);
  });

  it("has unique position IDs", () => {
    const ids = IE_CABINET_POSITIONS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("orders are sequential from 0 to 18", () => {
    const orders = IE_CABINET_POSITIONS.map((p) => p.order).sort((a, b) => a - b);
    expect(orders).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });

  it("includes the constitutional executive offices first", () => {
    expect(IE_CABINET_POSITIONS[0]?.id).toBe("taoiseach");
    expect(IE_CABINET_POSITIONS[1]?.id).toBe("tanaiste");
  });

  it("includes minister_for_finance to match the IE config financeMinisterCabinetId", () => {
    const ids = IE_CABINET_POSITIONS.map((p) => p.id);
    expect(ids).toContain("minister_for_finance");
  });
});

describe("IE cabinet mechanics", () => {
  it("every position has mechanics", () => {
    for (const pos of IE_CABINET_POSITIONS) {
      expect(IE_CABINET_MECHANICS[pos.id]).toBeDefined();
      expect(IE_CABINET_MECHANICS[pos.id]!.positionId).toBe(pos.id);
    }
  });

  it("every mechanic carries a department name", () => {
    for (const pos of IE_CABINET_POSITIONS) {
      expect(IE_CABINET_MECHANICS[pos.id]!.department).toBeTruthy();
    }
  });

  it("every mechanic carries at least one nationalMetric", () => {
    for (const pos of IE_CABINET_POSITIONS) {
      expect(IE_CABINET_MECHANICS[pos.id]!.nationalMetrics.length).toBeGreaterThan(0);
    }
  });

  it("minister_for_finance has Exchequer grants allocation + bondProfile", () => {
    const fm = IE_CABINET_MECHANICS.minister_for_finance;
    expect(fm.allocation).toBeDefined();
    expect(fm.allocation!.name).toBe("Exchequer Grants Allocation");
    expect(fm.allocation!.poolLabel).toBe("Exchequer Grants Pool");
    expect(fm.bondProfile).toBeDefined();
    expect(fm.bondProfile!.name).toBe("Sovereign Bond Maturity Profile");
  });

  it("only the Minister for Finance has allocation+bondProfile (sole-finance invariant)", () => {
    for (const pos of IE_CABINET_POSITIONS) {
      if (pos.id === "minister_for_finance") continue;
      expect(IE_CABINET_MECHANICS[pos.id]!.allocation).toBeUndefined();
      expect(IE_CABINET_MECHANICS[pos.id]!.bondProfile).toBeUndefined();
    }
  });
});

describe("IE ministerial orders", () => {
  it("every position has exactly 2 ministerial orders", () => {
    for (const pos of IE_CABINET_POSITIONS) {
      const orders = IE_MINISTERIAL_ORDERS[pos.id];
      expect(orders).toBeDefined();
      expect(orders!.length).toBe(2);
    }
  });

  it("order IDs are all prefixed with ie_", () => {
    for (const pos of IE_CABINET_POSITIONS) {
      for (const order of IE_MINISTERIAL_ORDERS[pos.id] ?? []) {
        expect(order.id.startsWith("ie_")).toBe(true);
      }
    }
  });

  it("order IDs are globally unique across the whole IE order set", () => {
    const allIds: string[] = [];
    for (const pos of IE_CABINET_POSITIONS) {
      for (const order of IE_MINISTERIAL_ORDERS[pos.id] ?? []) {
        allIds.push(order.id);
      }
    }
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(allIds.length).toBe(38);
  });

  it("all orders have valid durations and at least one effect", () => {
    for (const pos of IE_CABINET_POSITIONS) {
      for (const order of IE_MINISTERIAL_ORDERS[pos.id] ?? []) {
        expect(order.duration).toBeGreaterThan(0);
        expect(order.effects.length).toBeGreaterThan(0);
      }
    }
  });

  it("every effect uses a valid scope", () => {
    for (const pos of IE_CABINET_POSITIONS) {
      for (const order of IE_MINISTERIAL_ORDERS[pos.id] ?? []) {
        for (const effect of order.effects) {
          expect(["national", "regional"]).toContain(effect.scope);
        }
      }
    }
  });
});

describe("IE cabinet barrel registration", () => {
  it("resolves IE cabinet positions through the barrel", () => {
    const positions = getCabinetPositions("IE");
    expect(positions.length).toBe(19);
    expect(positions[0]?.id).toBe("taoiseach");
  });

  it("resolves IE cabinet mechanics through the barrel", () => {
    const fm = getCabinetMechanics("IE", "minister_for_finance");
    expect(fm).toBeDefined();
    expect(fm!.positionId).toBe("minister_for_finance");
    expect(fm!.allocation).toBeDefined();
  });
});

describe("IE ministerial-orders barrel registration", () => {
  it("resolves IE finance-minister orders through the barrel", () => {
    const orders = getMinisterialOrders("IE", "minister_for_finance");
    expect(orders.length).toBe(2);
    expect(orders[0].id.startsWith("ie_")).toBe(true);
  });

  it("returns an empty array for an IE position with no orders defined", () => {
    const orders = getMinisterialOrders("IE", "nonexistent_position");
    expect(orders).toEqual([]);
  });
});

describe("IE parliamentary cabinet config registration", () => {
  it("classifies IE as a parliamentary-cabinet country", () => {
    expect(isParliamentaryCabinetCountry("IE")).toBe(true);
  });
});
