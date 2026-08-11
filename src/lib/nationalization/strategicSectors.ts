/**
 * Strategic-sector designation store (spec §6.3, §8). A (countryId, sectorType)
 * marked strategic makes a corp operating that sector type in that country a
 * candidate for the strategic nationalization trigger. One doc per
 * (countryId, sectorType) via upsert.
 */
import type { Db } from "mongodb";
import type { StrategicSectorDesignation } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";

const COLLECTION = "strategicSectorDesignations";

export async function designateStrategicSector(
  db: Db,
  args: {
    countryId: CountryId;
    sectorType: CorporationType;
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
  sectorType: CorporationType
): Promise<void> {
  await db.collection<StrategicSectorDesignation>(COLLECTION).deleteOne({ countryId, sectorType });
}

/** The set of sector types designated strategic for a country. */
export async function getDesignatedSectorTypes(
  db: Db,
  countryId: CountryId
): Promise<Set<CorporationType>> {
  const docs = await db
    .collection<StrategicSectorDesignation>(COLLECTION)
    .find({ countryId }, { projection: { sectorType: 1 } })
    .toArray();
  return new Set(docs.map((d) => d.sectorType));
}

/** True if the corp operates a sector of a designated type IN the given country. */
export function corpHasStrategicSector(
  designatedTypes: ReadonlySet<CorporationType>,
  countryId: CountryId,
  corpSectors: { countryId: CountryId; sectorType: CorporationType }[]
): boolean {
  return corpSectors.some((s) => s.countryId === countryId && designatedTypes.has(s.sectorType));
}
