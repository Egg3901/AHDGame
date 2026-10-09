/**
 * Strategic-sector designation store (spec §6.3, §8). A (countryId, sectorType)
 * marked strategic makes a corp operating that sector type in that country a
 * candidate for the strategic nationalization trigger. One doc per
 * (countryId, sectorType) via upsert.
 */
import type { Db } from "mongodb";
import type { StrategicSectorDesignation } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { OperatingSectorType } from "@/lib/constants/corporations";
import { getOperatingSectorType } from "@/lib/constants/sectorStrategies";

const COLLECTION = "strategicSectorDesignations";

export async function designateStrategicSector(
  db: Db,
  args: {
    countryId: CountryId;
    sectorType: OperatingSectorType;
    turn: number;
    source: "legislation" | "executive" | "seed";
    sourceRef?: string;
  }
): Promise<void> {
  await db.collection<StrategicSectorDesignation>(COLLECTION).updateOne(
    { countryId: args.countryId, sectorType: args.sectorType },
    {
      $set: {
        designatedAtTurn: args.turn,
        source: args.source,
        ...(args.sourceRef ? { sourceRef: args.sourceRef } : {}),
      },
      $setOnInsert: {
        countryId: args.countryId,
        sectorType: args.sectorType,
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
}

export async function removeStrategicSectorDesignation(
  db: Db,
  countryId: CountryId,
  sectorType: OperatingSectorType
): Promise<void> {
  await db.collection<StrategicSectorDesignation>(COLLECTION).deleteOne({ countryId, sectorType });
}

/** The set of sector types designated strategic for a country. */
export async function getDesignatedSectorTypes(
  db: Db,
  countryId: CountryId
): Promise<Set<OperatingSectorType>> {
  const docs = await db
    .collection<StrategicSectorDesignation>(COLLECTION)
    .find({ countryId }, { projection: { sectorType: 1 } })
    .toArray();
  return new Set(docs.map((d) => d.sectorType));
}

/** True if the corp operates a sector of a designated type IN the given country. */
export function corpHasStrategicSector(
  designatedTypes: ReadonlySet<OperatingSectorType>,
  countryId: CountryId,
  corpSectors: {
    countryId: CountryId;
    sectorType: OperatingSectorType;
    industryModel?: string | null;
    mediaDiscriminator?: string | null;
  }[]
): boolean {
  return corpSectors.some(
    (s) =>
      s.countryId === countryId &&
      (designatedTypes.has(s.sectorType) ||
        designatedTypes.has(
          getOperatingSectorType(s.sectorType, s.industryModel, s.mediaDiscriminator)
        ))
  );
}
