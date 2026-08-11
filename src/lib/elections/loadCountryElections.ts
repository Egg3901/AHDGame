import { getDb } from "@/lib/mongodb";
import type { Election, ElectionDisplay } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { resolveElections } from "@/lib/elections/resolveElection";
import { toElectionDisplay } from "./electionDisplay";

export interface ElectionsViewerContext {
  userId: string | null;
  isAdmin: boolean;
  activeCharacterId: string | null;
}

/**
 * Load all upcoming/active summary elections for a country, resolved for the
 * given viewer. Mirrors GET /api/elections (country + view=summary) but without
 * pagination — the page requested every page anyway. Shared by the route and the
 * server component that seeds the page (direct DB call, no client self-fetch).
 */
export async function loadCountryElections(
  countryId: CountryId,
  viewer: ElectionsViewerContext
): Promise<ElectionDisplay[]> {
  const db = await getDb();
  const query: Record<string, unknown> = { status: { $in: ["upcoming", "active"] } };
  // Match explicit countryId, or legacy US docs that predate the field.
  if (countryId === COUNTRY_CONFIGS.US.id) {
    query.$or = [{ countryId: COUNTRY_CONFIGS.US.id }, { countryId: { $exists: false } }];
  } else {
    query.countryId = countryId;
  }
  const elections = await db
    .collection<Election>("elections")
    .find(query)
    .sort({ state: 1, electionType: 1, senateClass: 1 })
    .toArray();
  const resolved = await resolveElections(db, elections, {
    view: "summary",
    userId: viewer.userId,
    isAdmin: viewer.isAdmin,
    activeCharacterId: viewer.activeCharacterId,
  });
  return resolved.map(toElectionDisplay);
}
