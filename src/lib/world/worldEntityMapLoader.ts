import type { Db } from "mongodb";
import { loadRuntimeWorldEntities } from "./succession/runtimeEntities";
import { getMacroCountriesCollection } from "@/lib/db/collections/macroCountries";
import { getWorldEntityMapSnapshot, type WorldEntityMapSnapshot } from "./worldEntityMap";

/** Attach only active aggregate data from the same world preset. */
export async function loadWorldEntityMapSnapshot(
  db: Db,
  presetId: string
): Promise<WorldEntityMapSnapshot> {
  const snapshot = getWorldEntityMapSnapshot(
    presetId,
    await loadRuntimeWorldEntities(db, presetId)
  );
  const collection = await getMacroCountriesCollection(db);
  const rows = await collection
    .find({ presetId, simulationTier: "background-macro", retiredAt: null })
    .project({
      _id: 1,
      population: 1,
      economicSystem: 1,
      stability: 1,
      tradeExposure: 1,
      lastMacroTickTurn: 1,
      "contribution.computedOnTurn": 1,
      "dataQuality.provenance": 1,
    })
    .toArray();
  const byId = new Map(rows.map((row) => [row._id, row]));
  for (const item of Object.values(snapshot.byEntityId ?? snapshot.byFeatureId)) {
    const row = byId.get(item.entityId);
    if (!row || item.status !== "sovereign" || item.simulationTier !== "background-macro") continue;
    item.macroSummary = {
      population: row.population,
      economicSystem: row.economicSystem,
      stability: row.stability,
      tradeExposure: row.tradeExposure,
      lastMacroTickTurn: row.lastMacroTickTurn,
      contributionComputedOnTurn: row.contribution.computedOnTurn,
      provenance: row.dataQuality.provenance,
    };
  }
  return snapshot;
}
