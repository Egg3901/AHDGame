/**
 * Sum the face value of currently-active sovereign bonds for a country, held
 * by entities that qualify as "market demand."
 *
 * Excludes (per design Section 3 — Model B):
 * - IMF Corp holdings (institutional, not market)
 * - Defaulted or matured bonds (not active)
 * - Corporate bonds (only sovereign issuance counts as country-level demand)
 *
 * Includes (intentionally — captive-demand modeling):
 * - Domestic corp holders (e.g. domestic banks holding their country's debt)
 * - Foreign corp holders
 * - Player character holders
 * - Imperial character holders
 *
 * Future-compatibility: the foreign-reserves system, when built, would add
 * country-as-holder support; that integration belongs in Phase 7+ (cascade)
 * not here.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Bond } from "@/lib/db/types/bond";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { getImfCorporation } from "@/lib/imf/resolveImfCorporation";

export async function sumQualifyingEntitySovereignHoldings(
  db: Db,
  countryCode: string
): Promise<number> {
  const imfCorp = await getImfCorporation(db);
  const imfCorpIdStr = imfCorp?._id.toString();

  const bonds = await db
    .collection<Bond>("bonds")
    .find({
      issuerType: "sovereign",
      countryId: countryCode as CountryId,
      matured: false,
      defaulted: false,
    })
    .toArray();

  let totalUnits = 0;
  for (const bond of bonds) {
    for (const holder of bond.holders ?? []) {
      // Exclude IMF Corp holdings
      if (imfCorpIdStr && holder.corporationId?.toString() === imfCorpIdStr) {
        continue;
      }
      totalUnits += holder.units ?? 0;
    }
  }

  return totalUnits * BOND_UNIT_FACE_VALUE;
}
