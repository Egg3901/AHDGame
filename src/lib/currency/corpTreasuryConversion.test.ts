import { describe, expect, it } from "vitest";
import type { Corporation } from "@/lib/db/types";
import {
  buildFxLocalPerInternalMap,
  getFxLocalPerInternalForCorpHome,
  internalSectorCostToTreasuryLiquidUnits,
} from "./corpTreasuryConversion";

describe("corpTreasuryConversion", () => {
  const jpFxMap = buildFxLocalPerInternalMap([{ currencyCode: "JPY", rate: 106 }]);

  it("buildFxLocalPerInternalMap defaults USD to 1", () => {
    const m = buildFxLocalPerInternalMap([{ currencyCode: "GBP", rate: 0.75 }]);
    expect(m.get("USD")).toBe(1.0);
    expect(m.get("GBP")).toBe(0.75);
  });

  it("getFxLocalPerInternalForCorpHome reads corp headquarters country", () => {
    const corp = { countryId: "JP" } as Pick<Corporation, "countryId">;
    expect(getFxLocalPerInternalForCorpHome(corp, jpFxMap)).toBe(106);
  });

  it("prefers the stamped home currency over the era-blind map", () => {
    // A 2027 French corp seeds as EUR while the map still says FRF; the
    // legacy code matches no FX row, so map-first resolution would fall
    // back to 1.0 and misprice every conversion.
    const fx = buildFxLocalPerInternalMap([
      { currencyCode: "EUR", rate: 0.92 },
      { currencyCode: "FRF", rate: 4.2 },
    ]);
    const corp = { countryId: "FR", liquidCurrencyCode: "EUR" } as Pick<
      Corporation,
      "countryId" | "liquidCurrencyCode"
    >;
    expect(getFxLocalPerInternalForCorpHome(corp, fx)).toBe(0.92);
  });

  it("keeps map resolution for unstamped corps (1991 passthrough)", () => {
    const fx = buildFxLocalPerInternalMap([
      { currencyCode: "EUR", rate: 0.92 },
      { currencyCode: "FRF", rate: 4.2 },
    ]);
    const corp = { countryId: "FR", liquidCurrencyCode: undefined } as Pick<
      Corporation,
      "countryId" | "liquidCurrencyCode"
    >;
    expect(getFxLocalPerInternalForCorpHome(corp, fx)).toBe(4.2);
  });

  it("internalSectorCostToTreasuryLiquidUnits leaves pre-migration corps unchanged", () => {
    const corp = { countryId: "JP", liquidCurrencyCode: undefined } as Pick<
      Corporation,
      "liquidCurrencyCode" | "countryId"
    >;
    expect(internalSectorCostToTreasuryLiquidUnits(50_000, corp, 106)).toBe(50_000);
  });

  it("scales internal split cost to JPY treasury units", () => {
    const corp = { countryId: "JP", liquidCurrencyCode: "JPY" } as Pick<
      Corporation,
      "liquidCurrencyCode" | "countryId"
    >;
    expect(internalSectorCostToTreasuryLiquidUnits(50_000, corp, 106)).toBe(5_300_000);
  });

  it("scales internal split cost to GBP treasury units", () => {
    const corp = { countryId: "UK", liquidCurrencyCode: "GBP" } as Pick<
      Corporation,
      "liquidCurrencyCode" | "countryId"
    >;
    expect(internalSectorCostToTreasuryLiquidUnits(100_000, corp, 0.75)).toBe(75_000);
  });
});
