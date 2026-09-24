/**
 * Live alignment topology combines the era's built-in poles with every
 * player-founded Bloc. Callers load it once and pass the plain result to rules.
 */
import type { Db } from "mongodb";
import { ALIGNMENT_POLES, isCustomAlignmentPoleToken } from "@/lib/constants/alignmentEras";
import { getCustomInternationalOrganizationsCollection } from "@/lib/db/collections";
import {
  buildAlignmentTopology,
  type AlignmentTopology,
  type CustomBlocTopologyInput,
} from "@/lib/alignment/rules/customBlocs";

export async function loadAlignmentTopology(db: Db, year: number): Promise<AlignmentTopology> {
  const custom = await (
    await getCustomInternationalOrganizationsCollection(db)
  )
    .find({ category: "bloc", alignment: { $exists: true } })
    .project({
      id: 1,
      name: 1,
      shortName: 1,
      creatorCountryId: 1,
      createdOnTurn: 1,
      alignment: 1,
    })
    .toArray();

  // Mongo's natural order is not a contract. Keep the ledger and influence
  // bars in founding order across reads and across deployments.
  custom.sort((a, b) => a.createdOnTurn - b.createdOnTurn || a.id.localeCompare(b.id));

  const blocs: CustomBlocTopologyInput[] = custom.flatMap((org) => {
    const token = org.alignment?.accentToken;
    if (!token || !isCustomAlignmentPoleToken(token)) return [];
    return [
      {
        organizationId: org.id,
        name: org.name,
        shortName: org.shortName,
        founderCountryId: org.creatorCountryId,
        accentToken: token,
      },
    ];
  });

  return buildAlignmentTopology(year, Object.values(ALIGNMENT_POLES), blocs);
}
