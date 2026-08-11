import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { CountryAlignment } from "../types/countryAlignment";

/** Each country's standing between the era's alignment poles. */
export async function getCountryAlignmentsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<CountryAlignment>("countryAlignments");
}
