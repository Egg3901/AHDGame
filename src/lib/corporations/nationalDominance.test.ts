import { describe, it, expect } from "vitest";
import { buildNationalDominanceShareBySectorId } from "./marketShare";
import {
  getDominanceMarginPenalty,
  getNationalDominanceMarginPenalty,
  DOMINANCE_NATIONAL_SHARE_THRESHOLD,
  DOMINANCE_MARKET_SHARE_THRESHOLD,
} from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporateSector, UnownedSector } from "@/lib/db/types";

const TYPE: CorporationType = "energy";
const fx = new Map<CurrencyCode, number>([["USD" as CurrencyCode, 1]]);

const stateById = () =>
  new Map([
    ["S1", { _id: "S1", gdp: 0, countryId: "US" as CountryId }],
    ["S2", { _id: "S2", gdp: 0, countryId: "US" as CountryId }],
  ]);

const sector = (id: string, corpId: string, stateId: string, revenue: number): CorporateSector =>
  ({
    _id: id,
    corporationId: corpId,
    stateId,
    sectorType: TYPE,
    countryId: "US",
    revenue,
  }) as unknown as CorporateSector;

const build = (sectors: CorporateSector[], unowned: UnownedSector[] = []) =>
  buildNationalDominanceShareBySectorId({
    sectors,
    stateById: stateById(),
    unownedSectors: unowned,
    exchangeRatesByCurrency: fx,
  });

describe("buildNationalDominanceShareBySectorId", () => {
  it("catches a champion spread below the local threshold in every state", () => {
    // Corp X: 40 of 100 in S1 and 40 of 100 in S2 → 40% locally (legal, <50%)
    // but 80/200 = 40% NATIONALLY — above the 30% national threshold.
    const sectors = [
      sector("x1", "X", "S1", 40),
      sector("y1", "Y", "S1", 60),
      sector("x2", "X", "S2", 40),
      sector("y2", "Y", "S2", 60),
    ];
    const nat = build(sectors);
    expect(nat.get("x1")).toBeCloseTo(40, 6);
    expect(nat.get("x2")).toBeCloseTo(40, 6);
    expect(nat.get("y1")).toBeCloseTo(60, 6);

    // The local toll would let X escape entirely; the national toll bites.
    const localX = 40;
    expect(localX).toBeLessThan(DOMINANCE_MARKET_SHARE_THRESHOLD);
    expect(getDominanceMarginPenalty(localX)).toBe(0);
    expect(nat.get("x1")!).toBeGreaterThan(DOMINANCE_NATIONAL_SHARE_THRESHOLD);
    expect(getNationalDominanceMarginPenalty(nat.get("x1")!)).toBeLessThan(0);
  });

  it("national share equals local share when a corp holds one uniform market", () => {
    const nat = build([sector("a", "A", "S1", 50), sector("b", "B", "S1", 50)]);
    // S2 has no sectors and gdp 0 → contributes no market; national == local.
    expect(nat.get("a")).toBeCloseTo(50, 6);
  });

  it("a sector with no corporationId reads 0 (no toll on orphans)", () => {
    const s = sector("o", "", "S1", 100);
    (s as unknown as { corporationId: undefined }).corporationId = undefined;
    const nat = build([s]);
    expect(nat.get("o")).toBe(0);
  });

  it("national share is bounded 0..100", () => {
    const nat = build([sector("solo", "X", "S1", 1000)]);
    expect(nat.get("solo")).toBeGreaterThanOrEqual(0);
    expect(nat.get("solo")).toBeLessThanOrEqual(100);
  });
});
