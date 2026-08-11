import type { Db } from "mongodb";
import { getWorldEntityPresetManifest } from "@/lib/world/worldEntityManifest";
import { getAuthored1953MacroCountry } from "@/lib/world/macro/roster1953";
import { getTransitionMacroCountry } from "@/lib/world/transitions";
import { getMacroCountriesCollection } from "@/lib/db/collections/macroCountries";

/**
 * Collections that must remain empty for a Tier-2 macro country.
 * Used by tests and diagnostics — macro seeding never writes these.
 */
export const MACRO_FORBIDDEN_SEED_COLLECTIONS = [
  "corporations",
  "corporateSectors",
  "unownedSectors",
  "seats",
  "electedOfficials",
  "officeStates",
  "npps",
] as const;

/**
 * Seed sphere-macro countries for the active preset.
 * 1953-default: European (#3719) + Asian/Middle Eastern (#3720) + African/American (#3721)
 * Tier-2 rosters; Austria remains the reference oracle. Emergent decolonization
 * targets wait for sovereignty before receiving transition-roster macros.
 *
 * Invariant: does not seed firms, corporate balance sheets, NPP corporations,
 * or player offices for macro entities. Planned economies never receive market
 * corporation documents from this path.
 */
export async function seedMacroCountries(
  db: Db,
  preset: string,
  log: (msg: string) => void = () => {}
): Promise<number> {
  const manifest = getWorldEntityPresetManifest(preset);
  const macroEntries = manifest.entries.filter((entry) => entry.simulationTier === "sphere-macro");
  if (macroEntries.length === 0) {
    log(`[macroCountries] no sphere-macro entities for preset ${preset}`);
    return 0;
  }

  const collection = await getMacroCountriesCollection(db);
  const now = new Date();
  let seeded = 0;

  for (const entry of macroEntries) {
    // Emergent sphere-macro targets wait for a sovereignty transition.
    if (entry.status !== "sovereign") continue;

    if (preset !== "1953-default") {
      throw new Error(
        `Sphere-macro entity ${entry.entityId} in ${preset} has no authored seed yet; refusing fallback.`
      );
    }

    // Post-sovereignty transition targets (Ghana + #3727 roster).
    const transitionMacro = getTransitionMacroCountry(entry.entityId, 1, now);
    if (transitionMacro) {
      await collection.updateOne(
        { _id: transitionMacro._id },
        {
          $set: {
            ...transitionMacro,
            updatedAt: now,
          },
        },
        { upsert: true }
      );
      seeded++;
      continue;
    }

    const doc = getAuthored1953MacroCountry(entry.entityId, now);
    if (doc.dataQuality.fallbackFields.length > 0) {
      throw new Error(
        `Macro seed ${entry.entityId} would inherit fallback fields: ${doc.dataQuality.fallbackFields.join(", ")}`
      );
    }
    if (doc.dataQuality.missingFields.length > 0) {
      throw new Error(
        `Macro seed ${entry.entityId} is missing fields: ${doc.dataQuality.missingFields.join(", ")}`
      );
    }

    // Planned economies must not be routed through market corporation seeders.
    if (doc.economicSystem === "planned" && entry.economicArchetype !== "planned") {
      throw new Error(
        `Macro seed ${entry.entityId} is planned but manifest archetype is ${entry.economicArchetype}.`
      );
    }

    await collection.updateOne(
      { _id: doc._id },
      {
        $set: {
          ...doc,
          updatedAt: now,
        },
      },
      { upsert: true }
    );
    seeded++;
  }

  log(`[macroCountries] seeded ${seeded} sphere-macro countries for ${preset}`);
  return seeded;
}
