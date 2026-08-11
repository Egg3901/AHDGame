import { describe, it, expect } from "vitest";
import { shapeWorldTradeLedger } from "./worldTradeLedger";
import type { TradeFlowSnapshot } from "@/lib/db/types/tradeFlowSnapshot";

const snap: Omit<TradeFlowSnapshot, "_id"> = {
  turn: 412,
  updatedAt: new Date("2026-06-16T00:00:00Z"),
  commodities: {
    steel: {
      flow: { US: { CN: 80000 } },
      perCountry: {
        US: { exports: 80000, imports: 0, net: 80000, uncleared: 0 },
        CN: { exports: 0, imports: 80000, net: -80000, uncleared: 0 },
      },
      worldVolume: 80000,
    },
    electronics: {
      flow: { CN: { US: 25000 } },
      perCountry: {
        US: { exports: 0, imports: 25000, net: -25000, uncleared: 0 },
        CN: { exports: 25000, imports: 0, net: 25000, uncleared: 0 },
      },
      worldVolume: 25000,
    },
  },
  national: {
    US: { exports: 80000, imports: 25000, net: 55000 },
    CN: { exports: 25000, imports: 80000, net: -55000 },
  },
  world: { grossVolume: 105000, clearedVolume: 105000, unclearedSurplus: 0 },
};

describe("shapeWorldTradeLedger", () => {
  it("ranks nations by net (surplus first) with meta", () => {
    const led = shapeWorldTradeLedger(snap, ["US", "CN"]);
    expect(led.nations.map((n) => n.code)).toEqual(["US", "CN"]);
    expect(led.nations[0]).toMatchObject({ code: "US", net: 55000, direction: "surplus" });
    expect(led.nations[1].direction).toBe("deficit");
    expect(led.nations[0].name).toBe("United States");
    expect(typeof led.nations[0].hue).toBe("string");
  });

  it("summarizes the headline strip", () => {
    const led = shapeWorldTradeLedger(snap, ["US", "CN"]);
    expect(led.headline.worldVolume).toBe(105000);
    expect(led.headline.largestSurplus).toMatchObject({ code: "US", value: 55000 });
    expect(led.headline.largestDeficit).toMatchObject({ code: "CN", value: -55000 });
    expect(led.headline.surplusCount).toBe(1);
    expect(led.headline.deficitCount).toBe(1);
    expect(led.headline.mostTradedGood.key).toBe("steel"); // 80k > 25k
  });

  it("ranks commodities with top exporter and importer", () => {
    const led = shapeWorldTradeLedger(snap, ["US", "CN"]);
    const steel = led.commodities.find((c) => c.key === "steel")!;
    expect(steel.worldVolume).toBe(80000);
    expect(steel.topExporter).toMatchObject({ code: "US" });
    expect(steel.topImporter).toMatchObject({ code: "CN" });
    expect(steel.label).toBe("Steel & Metals");
  });

  it("builds a signed bilateral net matrix (row vs column)", () => {
    const led = shapeWorldTradeLedger(snap, ["US", "CN"]);
    // US net vs CN = (80000 steel out) − (25000 electronics in) = +55000.
    expect(led.bilateral.US.CN).toBeCloseTo(55000);
    expect(led.bilateral.CN.US).toBeCloseTo(-55000);
    expect(led.bilateral.US.US).toBe(0);
  });

  it("computes per-country total trade volume for map node sizing", () => {
    const led = shapeWorldTradeLedger(snap, ["US", "CN"]);
    expect(led.nations.find((n) => n.code === "US")!.totalVolume).toBe(105000); // 80k+25k
  });

  it("derives the verdict from imbalance ratio", () => {
    const led = shapeWorldTradeLedger(snap, ["US", "CN"]);
    // totalSurplus/worldVolume = 55000/105000 ≈ 0.52 > 0.12 → IMBALANCED.
    expect(led.headline.verdict).toBe("IMBALANCED");
  });
});
