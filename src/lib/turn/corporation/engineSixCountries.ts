/**
 * Countries whose NPP-run corporations follow NPP engine 6 this turn
 * (autonomy v6). Resolved once per country for the corporation turn.
 */
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { nppAutonomyAtLeast } from "@/lib/nppAutonomy/featureFlag";
import { NPP_ENGINE_LEVEL } from "@/lib/nppAutonomy/engineVersion";

export async function loadEngineSixCountries(
  db: Db,
  corporations: readonly Pick<Corporation, "ceoType" | "countryId">[]
): Promise<Set<string>> {
  const countries = new Set<string>();
  for (const countryId of new Set(
    corporations.filter((c) => c.ceoType === "npp").map((c) => c.countryId)
  )) {
    if (await nppAutonomyAtLeast(db, countryId, NPP_ENGINE_LEVEL)) countries.add(countryId);
  }
  return countries;
}
