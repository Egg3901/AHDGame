import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { CountryHistoryEvent } from "../types/countryHistoryEvent";

/**
 * Typed `countryHistory` collection — append-only event log of notable
 * country-level events (leader changes, bill enactments). Written by turn
 * processor hooks, read by country wiki widgets.
 */
export async function getCountryHistoryCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<CountryHistoryEvent>("countryHistory");
}
