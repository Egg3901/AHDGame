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
  it("leaves household and unowned input freight off a tiny corporate buyer's bill", () => {
    const r = apportionFreightBilling({
      freightChargesByDestState: charges({ WA: { vehicles: 698_000 } }),
      haulRevenueByOriginState: new Map(),
      freightSupplyUnitsByOriginState: new Map(),
      demandUnitsByDestState: charges({ WA: { vehicles: 10_000 } }),
      sectors: [sector({ stateId: "WA", demandUnitsByCommodity: demand({ vehicles: 2 }) })],
    });
    expect(r.chargeBySectorId.get("s1")).toBeCloseTo(139.6);
    expect(r.unapportionedCharges).toBeCloseTo(697_860.4);
  });

  it("puts sector inputs on the sourcing book's calibrated demand basis", () => {
    const r = apportionFreightBilling({
      freightChargesByDestState: charges({ WA: { iron: 698_000 } }),
      haulRevenueByOriginState: new Map(),
      demandUnitsByDestState: charges({ WA: { iron: 4_500 } }),
      demandCalibrationByCommodity: demand({ iron: 0.45 }),
      freightSupplyUnitsByOriginState: new Map(),
      sectors: [sector({ stateId: "WA", demandUnitsByCommodity: demand({ iron: 2 }) })],
    });
    expect(r.chargeBySectorId.get("s1")).toBeCloseTo(139.6);
    expect(r.unapportionedCharges).toBeCloseTo(697_860.4);
  });

  it("does not shift missing, invalid or stale demand coverage onto corporate buyers", () => {
    for (const total of [undefined, 0, -1, NaN, Infinity]) {
      const r = apportionFreightBilling({
        freightChargesByDestState: charges({ WA: { vehicles: 698_000 } }),
        haulRevenueByOriginState: new Map(),
        demandUnitsByDestState: total == null ? new Map() : charges({ WA: { vehicles: total } }),
        freightSupplyUnitsByOriginState: new Map(),
        sectors: [sector({ stateId: "WA", demandUnitsByCommodity: demand({ vehicles: 2 }) })],
      });
      expect(r.chargeBySectorId.size).toBe(0);
      expect(r.unapportionedCharges).toBe(698_000);
    }
  });

  it("bounds sector growth against a lagged demand snapshot and preserves the money total", () => {
    const r = apportionFreightBilling({
      freightChargesByDestState: charges({ WA: { vehicles: 300 } }),
      haulRevenueByOriginState: new Map(),
      demandUnitsByDestState: charges({ WA: { vehicles: 1 } }),
      freightSupplyUnitsByOriginState: new Map(),
      sectors: [
        sector({ sectorId: "a", stateId: "WA", demandUnitsByCommodity: demand({ vehicles: 2 }) }),
        sector({ sectorId: "b", stateId: "WA", demandUnitsByCommodity: demand({ vehicles: 4 }) }),
      ],
    });
    expect(r.chargeBySectorId.get("a")).toBe(100);
    expect(r.chargeBySectorId.get("b")).toBe(200);
    expect(r.unapportionedCharges).toBe(0);
  });
  it("splits a state's charge proportional to sector demand for the commodity", () => {
    const r = apportionFreightBilling({
      freightChargesByDestState: charges({ "US-NY": { steel: 300 } }),
      demandUnitsByDestState: charges({ "US-NY": { steel: 30 } }),
      freightSupplyUnitsByOriginState: new Map(),
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
      demandUnitsByDestState: charges({
        "US-NY": { steel: 12.8, coal: 5.4 },
        "US-CA": { steel: 2 },
      }),
      freightSupplyUnitsByOriginState: new Map(),
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
      demandUnitsByDestState: charges({ "US-NY": { steel: 30 } }),
      freightSupplyUnitsByOriginState: new Map(),
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
  it("credits only the corporate share of a network that also has unowned hauliers", () => {
    const r = apportionFreightBilling({
      freightChargesByDestState: new Map(),
      demandUnitsByDestState: new Map(),
      haulRevenueByOriginState: new Map([["WA", 1_000]]),
      freightSupplyUnitsByOriginState: new Map([["WA", 100]]),
      sectors: [sector({ stateId: "WA", freightSupplyUnits: 2 })],
    });
    expect(r.creditBySectorId.get("s1")).toBe(20);
    expect(r.unapportionedHaulRevenue).toBe(980);
  });
  it("splits a state's haul revenue proportional to freight supply share", () => {
    const r = apportionFreightBilling({
      freightChargesByDestState: new Map(),
      demandUnitsByDestState: new Map(),
      freightSupplyUnitsByOriginState: new Map([["US-TX", 90]]),
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
      demandUnitsByDestState: new Map(),
      freightSupplyUnitsByOriginState: new Map([
        ["US-TX", 11],
        ["US-NY", 1],
      ]),
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
      demandUnitsByDestState: new Map(),
      freightSupplyUnitsByOriginState: new Map([["US-TX", 90]]),
      haulRevenueByOriginState: new Map([["US-TX", 900]]),
      sectors: [sector({ sectorId: "mill", stateId: "US-TX", freightSupplyUnits: 0 })],
    });
    expect(r.creditBySectorId.size).toBe(0);
    expect(r.unapportionedHaulRevenue).toBeCloseTo(900);
  });

  it("a sector can both owe charges and earn haul revenue", () => {
    const r = apportionFreightBilling({
      freightChargesByDestState: charges({ "US-TX": { steel: 100 } }),
      demandUnitsByDestState: charges({ "US-TX": { steel: 5 } }),
      freightSupplyUnitsByOriginState: new Map([["US-TX", 10]]),
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
