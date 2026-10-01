/**
 * Background countries use repeatable simulation estimates, not historical statistics.
 * buildBackgroundMacroSpec derives population and all economic inputs from a country id
 * and opening year; backgroundSeedUnit mixes short and long ids across the unit interval.
 */
import type { MacroCountrySeedSpec } from "../seedBuilder";

/** FNV-1a over UTF-16 code units, then a 32-bit avalanche; returns a value in [0, 1). */
export function backgroundSeedUnit(id: string, salt: number): number {
  let hash = (0x811c9dc5 ^ salt) >>> 0;
  for (let index = 0; index < id.length; index++) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193) >>> 0;
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x100000000;
}

/** Existing coarse model: 350k floor, 95m quadratic spread, opening-year income proxy. */
export function buildBackgroundMacroSpec(
  entityId: string,
  displayName: string,
  economicArchetype: string,
  year: number
): MacroCountrySeedSpec {
  const population = Math.round(
    350_000 + Math.pow(backgroundSeedUnit(entityId, 17), 2) * 95_000_000
  );
  const eraIncome = 900 + Math.max(0, year - 1950) * 115;
  const perCapita = eraIncome * (0.55 + backgroundSeedUnit(entityId, 41) * 1.9);
  return {
    entityId,
    displayName,
    economicSystem: economicArchetype === "planned" ? "planned" : "market",
    population,
    annualGdpGameUnits: Math.max(100, Math.round((population * perCapita) / 1_000_000)),
    fiscalCapacity: 0.2 + backgroundSeedUnit(entityId, 73) * 0.45,
    stability: 0.4 + backgroundSeedUnit(entityId, 97) * 0.45,
    tradeExposure: 0.18 + backgroundSeedUnit(entityId, 131) * 0.62,
    sectorWeights: {
      agriculture: 0.2,
      manufacturing: 0.2,
      retail: 0.18,
      construction: 0.1,
      energy: 0.08,
      logistics: 0.08,
      financial: 0.08,
      extraction: 0.08,
    },
    resources: { timber: 0.2 + backgroundSeedUnit(entityId, 181) * 0.8 },
  };
}
