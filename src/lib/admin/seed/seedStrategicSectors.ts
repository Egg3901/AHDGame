import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { designateStrategicSector } from "@/lib/nationalization/strategicSectors";
import { DEFAULT_STRATEGIC_SECTORS } from "@/lib/seeds/reference/strategicSectors";

/**
 * Idempotent seed of per-country default strategic sectors. Upserts one
 * designation per (countryId, sectorType) at turn 0 with source "seed". Safe to
 * re-run; a head-of-government designation later overwrites the same row.
 */
export async function seedStrategicSectors(
  db: Db,
  log: (msg: string) => void = console.log
): Promise<number> {
  let count = 0;
  for (const [countryId, sectors] of Object.entries(DEFAULT_STRATEGIC_SECTORS)) {
    for (const sectorType of sectors ?? []) {
      await designateStrategicSector(db, {
        countryId: countryId as CountryId,
        sectorType,
        turn: 0,
        source: "seed",
      });
      count++;
    }
  }
  log(`Seeded ${count} default strategic-sector designations`);
  return count;
}
