import type { Db } from "mongodb";
import { getMacroCountriesCollection } from "@/lib/db/collections/macroCountries";
import type {
  MacroCountryDataQuality,
  MacroCountryDiagnostics,
  MacroEconomicSystem,
} from "./types";

function resolveDataQuality(
  economicSystem: MacroEconomicSystem | undefined,
  stored: MacroCountryDataQuality | undefined
): MacroCountryDataQuality {
  const system: MacroEconomicSystem = economicSystem ?? stored?.economicSystem ?? "market";
  if (stored) {
    const missingFields = [...stored.missingFields];
    if (!economicSystem) missingFields.push("economicSystem");
    return {
      provenance: stored.provenance,
      economicSystem: system,
      missingFields,
      fallbackFields: [...stored.fallbackFields],
    };
  }
  return {
    provenance: "authored-1953",
    economicSystem: system,
    missingFields: ["dataQuality", ...(economicSystem ? [] : ["economicSystem"])],
    fallbackFields: [],
  };
}

/** Admin-facing snapshot of last macro tick + current sector/commodity contributions. */
export async function getMacroCountryDiagnostics(db: Db): Promise<MacroCountryDiagnostics[]> {
  const countries = await (await getMacroCountriesCollection(db)).find({}).toArray();
  return countries.map((country) => {
    const dataQuality = resolveDataQuality(country.economicSystem, country.dataQuality);
    return {
      entityId: country.entityId,
      displayName: country.displayName,
      economicSystem: country.economicSystem ?? dataQuality.economicSystem,
      lastMacroTickTurn: country.lastMacroTickTurn,
      contributionComputedOnTurn: country.contribution.computedOnTurn,
      population: country.population,
      fiscalCapacity: country.fiscalCapacity,
      stability: country.stability,
      tradeExposure: country.tradeExposure,
      shockModifier: country.shockModifier,
      resources: country.resources,
      sectors: country.sectors,
      sectorContributions: country.contribution.bySector,
      commodityContributions: country.contribution.byCommodity,
      dataQuality,
    };
  });
}
