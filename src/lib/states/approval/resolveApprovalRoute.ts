import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { UK_REGIONS } from "@/lib/constants/uk";
import type { State } from "@/lib/db/types";

export interface ResolvedApprovalRoute {
  countryId: CountryId;
  stateId: string;
}

/**
 * Resolve a legacy `/approval/[id]` path segment to a country + region.
 * Handles the historical `UK_<region>` prefix and falls back to a states
 * collection lookup for all other IDs.
 */
export async function resolveApprovalRoute(
  db: Db,
  rawId: string
): Promise<ResolvedApprovalRoute | null> {
  const upper = rawId.toUpperCase();

  if (upper.startsWith("UK_")) {
    const stateId = upper.slice(3);
    if (!UK_REGIONS.some((r) => r.id === stateId)) return null;
    return { countryId: "UK", stateId };
  }

  if (UK_REGIONS.some((r) => r.id === upper)) {
    return { countryId: "UK", stateId: upper };
  }

  const matches = await db
    .collection<State>("states")
    .find({ _id: upper })
    .project<{ _id: string; countryId: CountryId }>({ countryId: 1 })
    .toArray();

  if (matches.length === 0) return null;
  if (matches.length === 1) {
    return { countryId: matches[0].countryId, stateId: upper };
  }

  // Ambiguous bare ID shared across countries — callers must use country-scoped URLs.
  return null;
}
