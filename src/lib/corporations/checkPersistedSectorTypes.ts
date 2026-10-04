/**
 * Persisted sector diagnostics. Unknown types are counted at startup so stale
 * sectors can be found before turn processing uses the inert strategy fallback.
 */
import type { Db } from "mongodb";
import type { CorporateSector } from "@/lib/db/types";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";

export async function checkPersistedSectorTypes(db: Db): Promise<void> {
  const unknownTypes = await db
    .collection<CorporateSector>("corporateSectors")
    .aggregate<{ _id: string | null; count: number }>([
      { $match: { sectorType: { $nin: Object.keys(SECTOR_STRATEGIES) } } },
      { $group: { _id: "$sectorType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();

  if (unknownTypes.length > 0) {
    console.error("[sector-types] unknown persisted types in corporateSectors:", unknownTypes);
  }
}
