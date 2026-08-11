import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { MacroCountryState } from "@/lib/world/macro/types";

export const MACRO_COUNTRIES_COLLECTION = "macroCountries";

export async function getMacroCountriesCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<MacroCountryState>(MACRO_COUNTRIES_COLLECTION);
}
