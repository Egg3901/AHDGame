import type { WorldEntityManifestEntry } from "@/lib/world/worldEntityManifest";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { buildMacroCountryFromSpec, type MacroCountrySeedSpec } from "./seedBuilder";
import type { MacroCountryState } from "./types";

function stableUnit(id: string, salt: number): number {
  let hash = salt >>> 0;
  for (const char of id) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return hash / 0xffffffff;
}

/**
 * Builds an intentionally coarse, deterministic aggregate profile. These
 * estimates are a lower simulation tier, not historical-statistics claims.
 */
export function buildBackgroundMacroCountry(
  entry: WorldEntityManifestEntry,
  presetId: string,
  now = new Date()
): MacroCountryState {
  const year = getStartingYearForPreset(presetId);
  const population = Math.round(350_000 + Math.pow(stableUnit(entry.entityId, 17), 2) * 95_000_000);
  const eraIncome = 900 + Math.max(0, year - 1950) * 115;
  const perCapita = eraIncome * (0.55 + stableUnit(entry.entityId, 41) * 1.9);
  const spec: MacroCountrySeedSpec = {
    entityId: entry.entityId,
    displayName: entry.displayName,
    economicSystem: entry.economicArchetype === "planned" ? "planned" : "market",
    population,
    annualGdpGameUnits: Math.max(100, Math.round((population * perCapita) / 1_000_000)),
    fiscalCapacity: 0.2 + stableUnit(entry.entityId, 73) * 0.45,
    stability: 0.4 + stableUnit(entry.entityId, 97) * 0.45,
    tradeExposure: 0.18 + stableUnit(entry.entityId, 131) * 0.62,
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
    resources: { timber: 0.2 + stableUnit(entry.entityId, 181) * 0.8 },
  };
  return buildMacroCountryFromSpec(spec, now, {
    presetId,
    simulationTier: "background-macro",
    provenance: "estimated-background",
  });
}
