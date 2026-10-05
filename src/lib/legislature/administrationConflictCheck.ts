import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { EnactedLaw } from "@/lib/db/types/budget";
import type { LegislationType } from "@/lib/db/types/legislation";
import { nationalLawCountryQuery } from "@/lib/policy/nationalPolicyRecords";
import {
  resolveAdministrationConflicts,
  type AdministrationConflict,
} from "./administrationConflicts";

/**
 * Database shell for the pure conflict rule. The shared country query retains
 * compatibility with legacy US enacted-law rows that predate `countryId`.
 */
export async function findAdministrationConflict(
  db: Db,
  countryId: CountryId,
  proposed: Array<Pick<LegislationType, "_id" | "administration">>
): Promise<AdministrationConflict | undefined> {
  if (proposed.length === 0) return undefined;
  const activeLaws = await db
    .collection<EnactedLaw>("enactedLaws")
    .find(
      {
        scope: "national",
        ...nationalLawCountryQuery(countryId),
        repealedAt: { $exists: false },
      },
      { projection: { legislationTypeId: 1 } }
    )
    .toArray();
  const activeTypeIds = [...new Set(activeLaws.map((law) => law.legislationTypeId))];
  const activeTypes =
    activeTypeIds.length === 0
      ? []
      : await db
          .collection<LegislationType>("legislationTypes")
          .find({ _id: { $in: activeTypeIds } }, { projection: { _id: 1, administration: 1 } })
          .toArray();
  return resolveAdministrationConflicts({ proposed, existing: activeTypes }).conflicts[0];
}
