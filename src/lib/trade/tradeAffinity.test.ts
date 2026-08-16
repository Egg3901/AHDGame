import { describe, it, expect } from "vitest";
import { buildTradeAffinity, type TradeAffinityContext } from "./tradeAffinity";
import { getBaseAffinity } from "./affinity";
import { ftaPairKey, type FtaPairSet } from "@/lib/tariffs/ftaOverrides";
import { TRADE_FTA_AFFINITY_BONUS, TRADE_BLOC_AFFINITY_BONUS } from "./constants";
import type { Tariff } from "@/lib/db/types/tariff";
import type { TradeEmbargo } from "@/lib/db/types/tradeEmbargo";

const ctx = (over: Partial<TradeAffinityContext> = {}): TradeAffinityContext => ({
  ftaPairs: new Set() as FtaPairSet,
  blocsByCountry: new Map(),
  tariffs: [],
  embargoes: [],
  ...over,
});

const embargo = (over: Partial<TradeEmbargo>): TradeEmbargo =>
  ({
    sourceCountry: "US",
    targetCountry: "CN",
    commodity: "all",
    direction: "export",
    mode: "block",
    origin: "minister",
    createdTurn: 1,
    ...over,
  }) as TradeEmbargo;

describe("buildTradeAffinity", () => {
  it("returns base geographic affinity with no modifiers", () => {
    const { affinityFor } = buildTradeAffinity(ctx());
    expect(affinityFor("steel", "US", "CN")).toBeCloseTo(getBaseAffinity("US", "CN"));
  });

  it("boosts affinity for an FTA-covered pair", () => {
    const ftaPairs = new Set([ftaPairKey("US", "CN")]) as FtaPairSet;
    const { affinityFor } = buildTradeAffinity(ctx({ ftaPairs }));
    expect(affinityFor("steel", "US", "CN")).toBeCloseTo(
      getBaseAffinity("US", "CN") * TRADE_FTA_AFFINITY_BONUS
    );
  });

  it("boosts affinity for a shared org bloc", () => {
    const blocsByCountry = new Map([
      ["US", new Set(["NATO"])],
      ["CN", new Set(["NATO"])],
    ]);
    const { affinityFor } = buildTradeAffinity(ctx({ blocsByCountry }));
    expect(affinityFor("steel", "US", "CN")).toBeCloseTo(
      getBaseAffinity("US", "CN") * TRADE_BLOC_AFFINITY_BONUS
    );
  });

  it("drags affinity down with an importer tariff", () => {
    // CN (importer) economy-wide tariff 20% on steel from US.
    const tariffs = [{ countryId: "CN", scopeType: "economy_wide", rate: 20 } as Tariff];
    const base = buildTradeAffinity(ctx()).affinityFor("steel", "US", "CN");
    const dragged = buildTradeAffinity(ctx({ tariffs })).affinityFor("steel", "US", "CN");
    expect(dragged).toBeLessThan(base);
  });

  it("blocks a flow under a block embargo", () => {
    // US blocks exports to CN.
    const embargoes = [embargo({ sourceCountry: "US", targetCountry: "CN", direction: "export" })];
    const { affinityFor } = buildTradeAffinity(ctx({ embargoes }));
    expect(affinityFor("steel", "US", "CN")).toBe(0);
    // Unrelated direction still flows.
    expect(affinityFor("steel", "CN", "US")).toBeGreaterThan(0);
  });

  it("caps a flow under a cap embargo without blocking it", () => {
    const embargoes = [
      embargo({
        mode: "cap",
        cap: 500,
        commodity: "steel",
        sourceCountry: "US",
        targetCountry: "CN",
      }),
    ];
    const { affinityFor, capUnitsFor } = buildTradeAffinity(ctx({ embargoes }));
    expect(affinityFor("steel", "US", "CN")).toBeGreaterThan(0);
    expect(capUnitsFor("steel", "US", "CN")).toBe(500);
    expect(capUnitsFor("oil", "US", "CN")).toBeUndefined(); // different commodity
  });
});

describe("iron curtain (curtainedCountries)", () => {
  const curtain = new Set(["RU", "PL", "UKR"]);

  it("zeroes affinity across the curtain, both directions", () => {
    const { affinityFor } = buildTradeAffinity(ctx({ curtainedCountries: curtain }));
    expect(affinityFor("food", "PL", "US")).toBe(0); // Polish grain cannot go west
    expect(affinityFor("food", "US", "PL")).toBe(0); // and western goods cannot go east
  });

  it("leaves trade WITHIN the curtain (Comecon) untouched", () => {
    const { affinityFor } = buildTradeAffinity(ctx({ curtainedCountries: curtain }));
    expect(affinityFor("food", "UKR", "PL")).toBeCloseTo(getBaseAffinity("UKR", "PL"));
  });

  it("leaves trade within the open world untouched", () => {
    const { affinityFor } = buildTradeAffinity(ctx({ curtainedCountries: curtain }));
    expect(affinityFor("food", "US", "UK")).toBeCloseTo(getBaseAffinity("US", "UK"));
  });

  it("absent or empty set is a no-op", () => {
    const { affinityFor } = buildTradeAffinity(ctx({ curtainedCountries: new Set() }));
    expect(affinityFor("food", "PL", "US")).toBeCloseTo(getBaseAffinity("PL", "US"));
  });
});
