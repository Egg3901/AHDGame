import type { Db } from "mongodb";
import type { DemographicCategory } from "@/lib/db/types/demographics";

// The demographic-category catalog is a small, effectively static collection
// that 15+ hot paths (polls, election enrichment, primary resolution, region
// pages) each reloaded per call. One process-level 60s memo serves them all;
// admin edits (admin/demographics routes) surface within a minute, and those
// routes keep reading the collection directly.
const TTL_MS = 60_000;
let cache: { at: number; docs: DemographicCategory[] } | null = null;

export async function loadDemographicCategories(db: Db): Promise<DemographicCategory[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.docs;
  const docs = await db.collection<DemographicCategory>("demographicCategories").find({}).toArray();
  cache = { at: Date.now(), docs };
  return docs;
}

/** Test/admin hook: drop the memo so the next load re-reads the collection. */
export function invalidateDemographicCategoryCache(): void {
  cache = null;
}
