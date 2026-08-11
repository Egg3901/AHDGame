import type { Db } from "mongodb";
import type { CountryLeaderState } from "@/lib/db/types/countryLeaderState";

export function getCountryLeaderStatesCollection(db: Db) {
  return db.collection<CountryLeaderState>("countryLeaderStates");
}
