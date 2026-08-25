import { describe, it, expect } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import { apportionFreightBilling, type FreightBillingSectorUnits } from "./freightBilling";

const demand = (entries: Partial<Record<CommodityType, number>>): Map<CommodityType, number> => {
  const m = new Map<CommodityType, number>();
  for (const [c, units] of Object.entries(entries)) m.set(c as CommodityType, units as number);
  return m;
};

function sector(over: Partial<FreightBillingSectorUnits> = {}): FreightBillingSectorUnits {
  return {
    sectorId: "s1",
    stateId: "US-NY",
    demandUnitsByCommodity: new Map(),
    freightSupplyUnits: 0,
    ...over,
  };
}

const charges = (
  entries: Record<string, Partial<Record<CommodityType, number>>>
): Map<string, Map<CommodityType, number>> =>
  new Map(Object.entries(entries).map(([stateId, byCommodity]) => [stateId, demand(byCommodity)]));

describe("apportionFreightBilling — charges", () => {
  it("splits a state's charge proportional to sector demand for the commodity", () => {
    const r = apportionFreightBilling({
      freightChargesByDestState: charges({ "US-NY": { steel: 300 } }),
      haulRevenueByOriginState: new Map(),
      sectors: [
        sector({ sectorId: "a", demandUnitsByCommodity: demand({ steel: 10 }) }),
        sector({ sectorId: "b", demandUnitsByCommodity: demand({ steel: 20 }) }),
        // Demands a different commodity: owes nothing on the steel charge.
        sector({ sectorId: "c", demandUnitsByCommodity: demand({ coal: 50 }) }),
      ],
    });
    expect(r.chargeBySectorId.get("a")).toBeCloseTo(100);
    expect(r.chargeBySectorId.get("b")).toBeCloseTo(200);
    expect(r.chargeBySectorId.has("c")).toBe(false);
    expect(r.unapportionedCharges).toBe(0);
  });

  it("full-apportionment identity: sector shares sum to the state aggregate", () => {
    const stateCharges = charges({
      "US-NY": { steel: 1234.56, coal: 78.9 },
      "US-CA": { steel: 55.5 },
    });
    const r = apportionFreightBilling({
      freightChargesByDestState: stateCharges,
      haulRevenueByOriginState: new Map(),
      sectors: [
        sector({ sectorId: "a", demandUnitsByCommodity: demand({ steel: 3.7, coal: 1 }) }),
        sector({ sectorId: "b", demandUnitsByCommodity: demand({ steel: 9.1, coal: 4.4 }) }),
        sector({
          sectorId: "c",
          stateId: "US-CA",
          demandUnitsByCommodity: demand({ steel: 2 }),
        }),
      ],
    });
    let aggregate = 0;
    for (const byCommodity of stateCharges.values())
      for (const charge of byCommodity.values()) aggregate += charge;
    let apportioned = 0;
    for (const share of r.chargeBySectorId.values()) apportioned += share;
    expect(apportioned + r.unapportionedCharges).toBeCloseTo(aggregate, 10);
    expect(r.unapportionedCharges).toBe(0);
  });

  it("zero demand: the whole charge lands in the unapportioned remainder", () => {
    const r = apportionFreightBilling({
      freightChargesByDestState: charges({ "US-NY": { steel: 300 } }),
      haulRevenueByOriginState: new Map(),
      sectors: [
        // In the state, but demands none of the charged commodity.
        sector({ sectorId: "a", demandUnitsByCommodity: demand({ coal: 10 }) }),
        // Demands the commodity, but in another state.
        sector({
          sectorId: "b",
          stateId: "US-CA",
          demandUnitsByCommodity: demand({ steel: 10 }),
        }),
      ],
    });
    expect(r.chargeBySectorId.size).toBe(0);
    expect(r.unapportionedCharges).toBeCloseTo(300);
  });
});

describe("apportionFreightBilling — haul revenue", () => {
  it("splits a state's haul revenue proportional to freight supply share", () => {
    const r = apportionFreightBilling({
      freightChargesByDestState: new Map(),
      haulRevenueByOriginState: new Map([["US-TX", 900]]),
      sectors: [
        sector({ sectorId: "hauler1", stateId: "US-TX", freightSupplyUnits: 60 }),
        sector({ sectorId: "hauler2", stateId: "US-TX", freightSupplyUnits: 30 }),
        // No freight supply: earns nothing.
        sector({ sectorId: "mill", stateId: "US-TX", freightSupplyUnits: 0 }),
        // Supplies freight in another state: earns nothing here.
        sector({ sectorId: "far", stateId: "US-CA", freightSupplyUnits: 100 }),
      ],
    });
    expect(r.creditBySectorId.get("hauler1")).toBeCloseTo(600);
    expect(r.creditBySectorId.get("hauler2")).toBeCloseTo(300);
    expect(r.creditBySectorId.has("mill")).toBe(false);
    expect(r.creditBySectorId.has("far")).toBe(false);
    expect(r.unapportionedHaulRevenue).toBe(0);
  });

  it("full-apportionment identity: sector credits sum to the state aggregate", () => {
    const haulRevenue = new Map([
      ["US-TX", 123.45],
      ["US-NY", 67.8],
    ]);
    const r = apportionFreightBilling({
      freightChargesByDestState: new Map(),
      haulRevenueByOriginState: haulRevenue,
      sectors: [
        sector({ sectorId: "t1", stateId: "US-TX", freightSupplyUnits: 3.3 }),
        sector({ sectorId: "t2", stateId: "US-TX", freightSupplyUnits: 7.7 }),
        sector({ sectorId: "n1", stateId: "US-NY", freightSupplyUnits: 1 }),
      ],
    });
    let aggregate = 0;
    for (const revenue of haulRevenue.values()) aggregate += revenue;
    let apportioned = 0;
    for (const share of r.creditBySectorId.values()) apportioned += share;
    expect(apportioned + r.unapportionedHaulRevenue).toBeCloseTo(aggregate, 10);
    expect(r.unapportionedHaulRevenue).toBe(0);
  });

  it("zero supply: the whole revenue lands in the unapportioned remainder", () => {
    const r = apportionFreightBilling({
      freightChargesByDestState: new Map(),
      haulRevenueByOriginState: new Map([["US-TX", 900]]),
      sectors: [sector({ sectorId: "mill", stateId: "US-TX", freightSupplyUnits: 0 })],
    });
    expect(r.creditBySectorId.size).toBe(0);
    expect(r.unapportionedHaulRevenue).toBeCloseTo(900);
  });

  it("a sector can both owe charges and earn haul revenue", () => {
    const r = apportionFreightBilling({
      freightChargesByDestState: charges({ "US-TX": { steel: 100 } }),
      haulRevenueByOriginState: new Map([["US-TX", 50]]),
      sectors: [
        sector({
          sectorId: "hauler",
          stateId: "US-TX",
          demandUnitsByCommodity: demand({ steel: 5 }),
          freightSupplyUnits: 10,
        }),
      ],
    });
    expect(r.chargeBySectorId.get("hauler")).toBeCloseTo(100);
    expect(r.creditBySectorId.get("hauler")).toBeCloseTo(50);
  });
});
