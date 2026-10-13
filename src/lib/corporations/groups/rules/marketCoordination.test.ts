import { describe, it, expect } from "vitest";
import { coordinateGroupBook, coordinateGroupMarket } from "./marketCoordination";
import { coordinationFixture } from "./testFixtures";
describe("group input routing safeguards", () => {
  it("redistributes scarcity instead of duplicating the public supply", () => {
    const result = coordinateGroupBook(coordinationFixture());
    expect(result.receipts).toHaveLength(1);
    expect(result.receipts[0]).toMatchObject({ units: 100, amountAnchor: 200 });
    expect(result.availabilityByBuyer.get("bb")).toBe(1);
    expect(result.availabilityByBuyer.get("outside")).toBe(0);
    expect([...result.availabilityByBuyer.values()].reduce((sum, v) => sum + v * 100, 0)).toBe(100);
  });
  it("returns to public allocation when a player opts out or their operator changes", () => {
    for (const change of [
      "optout",
      "ceo",
      "tenure",
      "group",
      "vacant",
      "state",
      "playerSupplier",
    ] as const) {
      const f = coordinationFixture();
      const b = f.members[1];
      if (change === "optout") b.preference!.enabled = false;
      if (change === "ceo") b.ceoId = "replacement";
      if (change === "tenure") b.ceoTenureKey = "2";
      if (change === "group") b.rootId = "another";
      if (change === "vacant") b.vacant = true;
      if (change === "state") b.stateOwned = true;
      if (change === "playerSupplier") f.members[0].operator = "player";
      const result = coordinateGroupBook(f);
      expect(result.receipts, change).toEqual([]);
      expect(result.availabilityByBuyer.size, change).toBe(0);
    }
  });
  it("respects committed output, measured production, buyer demand and one corporation cash budget", () => {
    const f = coordinationFixture();
    f.sellers[0].committedUnits = 30;
    f.sellers[0].physicalUnits = 50;
    f.members[1].cashAvailableAnchor = 30;
    f.buyers = [
      { ...f.buyers[0], requiredUnits: 100 },
      { ...f.buyers[0], sectorId: "bb2", requiredUnits: 100 },
    ];
    const result = coordinateGroupBook(f);
    expect(result.receipts.reduce((n, r) => n + r.units, 0)).toBeCloseTo(15);
    expect(result.spendByBuyer.get("b")).toBeCloseTo(30);
    f.sellers[0].physicalUnits = Number.NaN;
    expect(coordinateGroupBook(f).receipts).toEqual([]);
  });
  it("does not bypass geography or unmeasured shipping lanes", () => {
    const f = coordinationFixture();
    f.buyers[0].countryId = "DE";
    expect(coordinateGroupBook(f).receipts).toEqual([]);
    f.buyers[0].countryId = "US";
    f.buyers[0].stateId = "NY";
    f.freightSettlementActive = true;
    expect(coordinateGroupBook(f).receipts).toEqual([]);
  });
  it("fails closed for missing price, production and invalid commitments", () => {
    for (const price of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const f = coordinationFixture();
      f.unitPriceAnchor = price;
      expect(coordinateGroupBook(f).receipts).toEqual([]);
    }
    const f = coordinationFixture();
    f.sellers[0].committedUnits = Number.NaN;
    expect(coordinateGroupBook(f).receipts).toEqual([]);
  });
  it("is deterministic on repeated input and leaves its input untouched", () => {
    const f = coordinationFixture(),
      before = structuredClone(f);
    expect(coordinateGroupBook(f)).toEqual(coordinateGroupBook(f));
    expect(f).toEqual(before);
  });
});

describe("verified physical group delivery", () => {
  it("fails closed without local delivery evidence and conserves the local pool", () => {
    const f = coordinationFixture();
    f.freightSettlementActive = true;
    expect(coordinateGroupMarket(f).receipts).toEqual([]);
    const state = f.buyers[0].stateId;
    const local = new Map([[state, new Map([[f.commodity, 0.25]])]]);
    const demand = new Map([[state, new Map([[f.commodity, { demand: 200 }]])]]);
    const result = coordinateGroupMarket(f, local, demand);
    expect(result.receipts.reduce((sum, r) => sum + r.units, 0)).toBeCloseTo(50);
    expect(result.availabilityByBuyer.get("bb")).toBeCloseTo(0.5);
    expect(result.availabilityByBuyer.get("outside")).toBe(0);
  });
  it("shares one buyer cash budget across verified state slices", () => {
    const f = coordinationFixture();
    f.freightSettlementActive = true;
    f.members[1].cashAvailableAnchor = 30;
    f.sellers = [...f.sellers, { ...f.sellers[0], sectorId: "ss2", stateId: "NY" }];
    f.buyers = [...f.buyers, { ...f.buyers[0], sectorId: "bb2", stateId: "NY" }];
    const states = [f.buyers[0].stateId, "NY"];
    const local = new Map(states.map((s) => [s, new Map([[f.commodity, 1]])]));
    const demand = new Map(states.map((s) => [s, new Map([[f.commodity, { demand: 200 }]])]));
    expect(coordinateGroupMarket(f, local, demand).spendByBuyer.get("b")).toBeCloseTo(30);
  });
  it("deducts existing obligations from the scarce public pool before group preference", () => {
    const f = coordinationFixture();
    f.sellers[0].committedUnits = 70;
    f.buyers[1].contractedUnits = 70;
    const result = coordinateGroupBook(f);
    expect(result.receipts.reduce((sum, r) => sum + r.units, 0)).toBeCloseTo(30);
    expect(result.availabilityByBuyer.get("outside")).toBeCloseTo(0.7);
    expect(result.availabilityByBuyer.get("bb")).toBeCloseTo(0.3);
  });
});

it("shares a reachable book ceiling across verified states without order bias", () => {
  const f = coordinationFixture();
  f.freightSettlementActive = true;
  f.sellers = [...f.sellers, { ...f.sellers[0], sectorId: "ss2", stateId: "NY" }];
  f.buyers = [f.buyers[0], { ...f.buyers[0], sectorId: "bb2", stateId: "NY" }];
  const states = [f.buyers[0].stateId, "NY"];
  const local = new Map(states.map((s) => [s, new Map([[f.commodity, 1]])]));
  const demand = new Map(states.map((s) => [s, new Map([[f.commodity, { demand: 100 }]])]));
  const result = coordinateGroupMarket(f, local, demand);
  expect(result.receipts.map((r) => r.units)).toEqual([50, 50]);
  expect(result.receipts.reduce((n, r) => n + r.units, 0)).toBe(f.supply);
});
