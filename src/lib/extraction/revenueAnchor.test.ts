import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { extractionRevenueAnchorOf } from "./revenueAnchor";
import { computeExtractionHeadroomByStateResource } from "@/lib/turn/nppExtractionOpportunity";
import type { CorporateSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";

const yenCorp = new ObjectId();
const usdCorp = new ObjectId();
const corpById = new Map([
  [String(yenCorp), { countryId: "JP", liquidCurrencyCode: "JPY" }],
  [String(usdCorp), { countryId: "US", liquidCurrencyCode: "USD" }],
]);
const fx = new Map<CurrencyCode, number>([
  ["JPY" as CurrencyCode, 100],
  ["USD" as CurrencyCode, 1],
]);
const sector = (corporationId: ObjectId, countryId: string, revenue: number) =>
  ({
    _id: new ObjectId(),
    corporationId,
    countryId,
    stateId: "KNS",
    sectorType: "extraction",
    strategyId: "iron_mining",
    revenue,
  }) as unknown as CorporateSector;

describe("extraction desired output reads revenue in the anchor currency", () => {
  const anchorOf = extractionRevenueAnchorOf(corpById, fx);

  it("converts a local-currency sector revenue to ₳ at the host rate", () => {
    expect(anchorOf(sector(yenCorp, "JP", 1_000_000))).toBeCloseTo(10_000);
    expect(anchorOf(sector(usdCorp, "US", 10_000))).toBeCloseTo(10_000);
  });

  it("a yen miner no longer reads 100x over its deposit", () => {
    const caps = [{ stateId: "KNS", resources: { iron: 100 } }];
    const yenMine = [sector(yenCorp, "JP", 1_000_000)];
    const anchored = computeExtractionHeadroomByStateResource(caps, yenMine, 1, false, anchorOf);
    const raw = computeExtractionHeadroomByStateResource(caps, yenMine, 1, false, (s) => s.revenue);
    // ₳10,000 x 0.78 / 120 = 65 iron units against a 100-unit deposit.
    expect(anchored.get("KNS")?.iron).toBeCloseTo(0.35, 2);
    // The raw reading wanted 6,500 units and saw no room at all.
    expect(raw.get("KNS")?.iron).toBe(0);
  });
});

describe("limitExtractionUtilizationRise", () => {
  it("eases a rise in at 0.05 a turn and applies a fall at once", async () => {
    const { limitExtractionUtilizationRise } = await import("./capacityHaircut");
    const next = { utilization: 1, bindingResource: null };
    expect(limitExtractionUtilizationRise(next, 0.014).utilization).toBeCloseTo(0.064);
    expect(limitExtractionUtilizationRise(next, 0.97).utilization).toBe(1);
    expect(
      limitExtractionUtilizationRise({ utilization: 0.2, bindingResource: "iron" }, 0.9)
    ).toEqual({ utilization: 0.2, bindingResource: "iron" });
    expect(limitExtractionUtilizationRise(next, undefined)).toBe(next);
  });
});
