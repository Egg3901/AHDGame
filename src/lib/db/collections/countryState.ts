import type { Db } from "mongodb";
import type { CountryState } from "@/lib/db/types/countryState";

export function getCountryStateCollection(db: Db) {
  return db.collection<CountryState>("countryState");
}
