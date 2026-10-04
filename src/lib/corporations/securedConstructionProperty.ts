import type { Db } from "mongodb";
import type { CorporateSector } from "@/lib/db/types";
import {
  hasProtectedConstructionClaim,
  hasProtectedConstructionProperty,
} from "@/lib/banking/rules/constructionProperty";
export {
  hasProtectedConstructionClaim,
  hasProtectedConstructionProperty,
  hasProtectedConstructionPropertyIn,
  unprotectedConstructionPropertyFilter,
} from "@/lib/banking/rules/constructionProperty";

/** Claim an already-loaded property row before a multi-write disposition. */
export async function acquireConstructionPropertyTransition(
  db: Db,
  sector: Pick<
    CorporateSector,
    "_id" | "corporationId" | "constructionFinancing" | "constructionPropertyTransition"
  >,
  key: string,
  kind: string,
  resumeSameKind = false,
  allowSameKeyResume = false
): Promise<boolean> {
  const marker = sector.constructionPropertyTransition;
  if (
    hasProtectedConstructionProperty(sector) &&
    !(allowSameKeyResume && marker?.key === key) &&
    !(resumeSameKind && marker?.kind === kind)
  )
    return false;

  const result = await db.collection<CorporateSector>("corporateSectors").updateOne(
    {
      _id: sector._id,
      corporationId: sector.corporationId,
      $and: [
        {
          $or: [
            { constructionPropertyTransition: { $exists: false } },
            ...(allowSameKeyResume ? [{ "constructionPropertyTransition.key": key }] : []),
            ...(resumeSameKind ? [{ "constructionPropertyTransition.kind": kind }] : []),
          ],
        },
        {
          $or: [
            { constructionFinancing: { $exists: false } },
            {
              $and: [
                { "constructionFinancing.status": { $in: ["released", "cancelled"] } },
                { "constructionFinancing.escrowLocal": 0 },
                {
                  $or: [
                    { "constructionFinancing.cancellation": { $exists: false } },
                    { "constructionFinancing.cancellation.cleanupCompleted": true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    { $set: { constructionPropertyTransition: { key, kind } } }
  );
  return result.matchedCount === 1;
}

export async function reserveSectorsForRestore(
  db: Db,
  sectors: Array<
    Pick<
      CorporateSector,
      "_id" | "corporationId" | "constructionFinancing" | "constructionPropertyTransition"
    >
  >
): Promise<boolean> {
  if (
    sectors.some(
      (sector) =>
        hasProtectedConstructionClaim(sector) ||
        (sector.constructionPropertyTransition &&
          sector.constructionPropertyTransition.kind !== "restore")
    )
  ) {
    return false;
  }

  const acquired: Array<{ sectorId: CorporateSector["_id"]; key: string }> = [];
  for (const sector of sectors) {
    const key = `restore:${sector._id.toHexString()}`;
    if (!(await acquireConstructionPropertyTransition(db, sector, key, "restore", true))) {
      await Promise.all(
        acquired.map(({ sectorId, key: acquiredKey }) =>
          releaseConstructionPropertyTransition(db, sectorId, acquiredKey)
        )
      );
      return false;
    }
    acquired.push({ sectorId: sector._id, key });
  }
  return true;
}

export async function reserveSectorsForTransition(
  db: Db,
  sectors: Array<
    Pick<
      CorporateSector,
      "_id" | "corporationId" | "constructionFinancing" | "constructionPropertyTransition"
    >
  >,
  kind: string,
  keyPrefix: string,
  allowSameKeyResume = false
): Promise<string[] | null> {
  if (
    sectors.some((sector) => {
      const key = `${keyPrefix}:${sector._id.toHexString()}`;
      return (
        hasProtectedConstructionProperty(sector) &&
        !(allowSameKeyResume && sector.constructionPropertyTransition?.key === key)
      );
    })
  )
    return null;
  const keys: Array<{ key: string; newlyAcquired: boolean }> = [];
  for (const sector of sectors) {
    const key = `${keyPrefix}:${sector._id.toHexString()}`;
    const alreadyOwned = sector.constructionPropertyTransition?.key === key;
    if (
      !(await acquireConstructionPropertyTransition(
        db,
        sector,
        key,
        kind,
        false,
        allowSameKeyResume
      ))
    ) {
      await Promise.all(
        sectors
          .slice(0, keys.length)
          .map((prior, index) =>
            keys[index]!.newlyAcquired
              ? releaseConstructionPropertyTransition(db, prior._id, keys[index]!.key)
              : Promise.resolve()
          )
      );
      return null;
    }
    keys.push({ key, newlyAcquired: !alreadyOwned });
  }
  return keys.map(({ key }) => key);
}

export async function releaseConstructionPropertyTransition(
  db: Db,
  sectorId: CorporateSector["_id"],
  key: string
): Promise<void> {
  await db
    .collection<CorporateSector>("corporateSectors")
    .updateOne(
      { _id: sectorId, "constructionPropertyTransition.key": key },
      { $unset: { constructionPropertyTransition: "" } }
    );
}
