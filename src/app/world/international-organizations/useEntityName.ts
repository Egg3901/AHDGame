"use client";

import { useCallback } from "react";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";
import { entityName as compiledEntityName } from "@/lib/constants/entityDisplay";
import type { OrgMemberId } from "@/lib/db/types/internationalOrganization";

/**
 * Client-side display name for an organisation member.
 *
 * `entityLabel.ts` cannot host this: it is imported by a SERVER component (the
 * conflict page), and the org summary service reaches the same resolution
 * through `entityDisplay`. A React hook in either would drag a client context
 * into both.
 *
 * A member may be a playable country or a background-roster entity (NVN, SVN…).
 * Only the first can be renamed at runtime, so countries resolve through the
 * override-aware hook and everything else keeps the compiled roster name.
 */
export function useEntityName(): (id: OrgMemberId) => string {
  const countryName = useCountryDisplayName();
  return useCallback(
    (id: OrgMemberId) =>
      Object.hasOwn(COUNTRY_CONFIGS, id) ? countryName(id as CountryId) : compiledEntityName(id),
    [countryName]
  );
}
