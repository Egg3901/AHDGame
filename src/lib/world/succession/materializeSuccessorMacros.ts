import type { ClientSession, Db } from "mongodb";
import type { WorldEntityManifestEntry } from "@/lib/world/worldEntityManifest";
import type { MacroCountryState } from "@/lib/world/macro/types";

/** Insert the aggregate economies for newly sovereign background successors.
 * This is part of the same settlement transaction that archives their former
 * detailed territory and publishes the applied receipt. */
export async function materializeFederationSuccessorMacros(input: {
  db: Db;
  session: ClientSession;
  successors: readonly WorldEntityManifestEntry[];
  countries: readonly MacroCountryState[];
}): Promise<number> {
  const { db, session, successors, countries } = input;
  const byId = new Map(successors.map((entry) => [entry.entityId, entry]));
  if (
    countries.length === 0 ||
    countries.length !== successors.length ||
    byId.size !== successors.length ||
    new Set(countries.map((country) => country.entityId)).size !== countries.length ||
    countries.some((country) => {
      const entry = byId.get(country.entityId);
      return (
        !entry ||
        entry.status !== "sovereign" ||
        entry.simulationTier !== "background-macro" ||
        country._id !== entry.entityId ||
        country.presetId !== entry.presetId ||
        country.simulationTier !== "background-macro" ||
        country.dataQuality.provenance !== "succession-derived" ||
        country.retiredAt != null
      );
    })
  )
    throw new Error("Federation successor macro inventory is incomplete or invalid");
  await db.collection<MacroCountryState>("macroCountries").insertMany([...countries], { session });
  return countries.length;
}
