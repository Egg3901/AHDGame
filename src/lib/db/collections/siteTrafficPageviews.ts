import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { SiteTrafficPageview } from "../types/siteTrafficPageview";

/**
 * Typed `siteTrafficPageviews` collection.
 *
 * Indexes (see `scripts/migrations/deprecated/add-site-traffic-indexes.ts`):
 *   { recordedAt: 1 }  expireAfterSeconds ~180d (TTL)
 *   { recordedAt: -1, path: 1 }  range + top-path aggregations
 */
export async function getSiteTrafficPageviewsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<SiteTrafficPageview>("siteTrafficPageviews");
}
