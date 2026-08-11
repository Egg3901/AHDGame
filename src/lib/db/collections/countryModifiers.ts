import type { Db } from "mongodb";
import type { CountryModifier } from "@/lib/db/types/events";

export function getCountryModifiersCollection(db: Db) {
  return db.collection<CountryModifier>("countryModifiers");
}
