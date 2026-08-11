import { describe, expect, it } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import { computeQualityUpdates, type QualityCorpInput } from "./brandQualityTurn";

const laggedNeutral = new Map<CommodityType, number>();

describe("computeQualityUpdates", () => {
  it("computes corp averageQuality and per-commodity output quality", () => {
    const corps: QualityCorpInput[] = [
      {
        corpId: "auto",
        techScore: 90,
        operationsStrength: 60,
        sectors: [{ revenueWeight: 100, wageLevel: 1.2, outputs: ["vehicles"], inputs: ["steel"] }],
      },
    ];
    const { corpQuality, commodityQuality } = computeQualityUpdates(corps, laggedNeutral);
    expect(corpQuality.get("auto")).toBeGreaterThan(0);
    expect(commodityQuality.get("vehicles")).toBeCloseTo(corpQuality.get("auto")!, 5);
  });

  it("propagates: good input commodity quality lifts the consumer's quality", () => {
    const corps: QualityCorpInput[] = [
      {
        corpId: "c",
        techScore: 40,
        operationsStrength: 40,
        sectors: [{ revenueWeight: 100, wageLevel: 1, outputs: ["vehicles"], inputs: ["steel"] }],
      },
    ];
    const withBadSteel = computeQualityUpdates(corps, new Map([["steel", 10]])).corpQuality.get(
      "c"
    )!;
    const withGoodSteel = computeQualityUpdates(corps, new Map([["steel", 95]])).corpQuality.get(
      "c"
    )!;
    expect(withGoodSteel).toBeGreaterThan(withBadSteel);
  });

  it("extraction-only corps get no quality and don't pollute commodity quality", () => {
    const corps: QualityCorpInput[] = [
      {
        corpId: "miner",
        techScore: 40,
        operationsStrength: 40,
        sectors: [{ revenueWeight: 100, wageLevel: 1, outputs: ["iron"], inputs: [] }],
      },
    ];
    const { corpQuality, commodityQuality } = computeQualityUpdates(corps, laggedNeutral);
    expect(corpQuality.has("miner")).toBe(false);
    expect(commodityQuality.has("iron")).toBe(false);
  });

  it("commodity quality is revenue-weighted across producers", () => {
    const corps: QualityCorpInput[] = [
      {
        corpId: "big",
        techScore: 160,
        operationsStrength: 160,
        sectors: [{ revenueWeight: 1000, wageLevel: 1.4, outputs: ["electronics"], inputs: [] }],
      },
      {
        corpId: "small",
        techScore: 1,
        operationsStrength: 1,
        sectors: [{ revenueWeight: 1, wageLevel: 0.8, outputs: ["electronics"], inputs: [] }],
      },
    ];
    const q = computeQualityUpdates(corps, laggedNeutral).commodityQuality.get("electronics")!;
    // Dominated by the big high-quality producer.
    expect(q).toBeGreaterThan(
      computeQualityUpdates([corps[1]], laggedNeutral).corpQuality.get("small")!
    );
  });
});
