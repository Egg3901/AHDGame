import { describe, expect, it } from "vitest";
import { readFreightBillingSnapshot } from "./freightBillingSnapshot";

const prices: Parameters<typeof readFreightBillingSnapshot>[1] = [
  { commodity: "vehicles", turn: 27, stateDemand: { WA: 100 }, stateSupply: {} },
  { commodity: "freight", turn: 27, stateDemand: {}, stateSupply: { CA: 200 } },
];
const legacy = {
  turn: 27,
  freightCharges: { WA: { vehicles: 500 } },
  freightHaulRevenue: { CA: 500 },
};

describe("readFreightBillingSnapshot", () => {
  it("uses same-turn state demand and supply for legacy network records", () => {
    const snapshot = readFreightBillingSnapshot(legacy, prices);
    expect(snapshot.demandByDestState.get("WA")?.get("vehicles")).toBe(100);
    expect(snapshot.supplyByOriginState.get("CA")).toBe(200);
  });

  it("refuses to mix old charges with a newer commodity book", () => {
    const snapshot = readFreightBillingSnapshot({ ...legacy, turn: 26 }, prices);
    expect(snapshot.demandByDestState.get("WA")?.size).toBe(0);
    expect(snapshot.supplyByOriginState.size).toBe(0);
  });

  it("prefers exact sourcing snapshots and preserves explicit missing coverage", () => {
    const snapshot = readFreightBillingSnapshot(
      {
        ...legacy,
        freightDemand: { WA: { vehicles: 123.456 } },
        freightSupply: { CA: 234.567 },
      },
      prices
    );
    expect(snapshot.demandByDestState.get("WA")?.get("vehicles")).toBe(123.456);
    expect(snapshot.supplyByOriginState.get("CA")).toBe(234.567);
    const missing = readFreightBillingSnapshot(
      { ...legacy, freightDemand: {}, freightSupply: {} },
      prices
    );
    expect(missing.demandByDestState.get("WA")?.size).toBe(0);
    expect(missing.supplyByOriginState.size).toBe(0);
  });

  it("returns empty maps without a sourcing record", () => {
    const snapshot = readFreightBillingSnapshot(undefined, prices);
    expect(snapshot.demandByDestState.size).toBe(0);
    expect(snapshot.supplyByOriginState.size).toBe(0);
  });
});
