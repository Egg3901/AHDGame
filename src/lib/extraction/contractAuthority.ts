import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { EnactedLaw } from "@/lib/db/types/budget";
import { nationalLawCountryQuery } from "@/lib/policy/nationalPolicyRecords";

/** Which level of government may issue extraction contracts in a country. */
export type ContractAuthority = "national" | "both" | "state";

/**
 * Legislation type id for the Resource Extraction Authority Act. Seeded in
 * src/lib/seeds/reference/legislationTypes.ts; policyOptionIndex maps:
 *   0 Federal licensing   → national only (DEFAULT when no law is enacted)
 *   1 Concurrent licensing → both national and state
 *   2 State licensing     → state only
 */
export const RESOURCE_EXTRACTION_AUTHORITY_LAW_ID = "resource_extraction_authority";

const AUTHORITY_BY_OPTION_INDEX: Record<number, ContractAuthority> = {
  0: "national",
  1: "both",
  2: "state",
};

/**
 * Resolve which government level(s) may issue extraction contracts for a
 * country, based on its most recently enacted (un-repealed) Resource Extraction
 * Authority Act. Defaults to "national" when no such law is in force — federal
 * licensing is the baseline. Uses the standard national-enactedLaw idiom (see
 * src/lib/budget/spending.ts): scope national, country filter, not repealed.
 */
export async function getResourceContractAuthority(
  db: Db,
  countryId: CountryId
): Promise<ContractAuthority> {
  const law = await db
    .collection<EnactedLaw>("enactedLaws")
    .find({
      scope: "national",
      legislationTypeId: RESOURCE_EXTRACTION_AUTHORITY_LAW_ID,
      ...nationalLawCountryQuery(countryId),
      repealedAt: { $exists: false },
    })
    // Latest enactment wins if more than one un-repealed row exists.
    .sort({ enactedAt: -1 })
    .limit(1)
    .next();

  if (!law || law.policyOptionIndex == null) return "national";
  return AUTHORITY_BY_OPTION_INDEX[law.policyOptionIndex] ?? "national";
}
