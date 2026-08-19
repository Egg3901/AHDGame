import type { AnyBulkWriteOperation, Db, ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { CountryOwnedSeedData } from "@/lib/seeds/reference/budgets";

export interface CountryOwnedCorpUpsertResult {
  /** Corporations upserted by canonical `_id`. */
  corporations: number;
  /** Producing sectors upserted at their canonical owner. */
  sectors: number;
  /**
   * Existing producing sectors moved off a STALE country-owned corporation onto
   * the canonical one, instead of being duplicated beside it.
   */
  repointed: number;
}

/**
 * Upsert a country's country-owned corporations and their producing
 * `corporateSectors`, tolerating SOE ids from an EARLIER id layout.
 *
 * Why this exists. Command-economy SOE ids are derived from a per-country hex
 * base plus the sector's `CORPORATION_TYPES` ordinal (`SOE_ID_BASE_BY_COUNTRY`
 * in `seeds/reference/budgets.ts`). That base has moved twice: legacy 3-digit
 * suffixes, then the 0x1000+ 4-digit bands introduced with ticket #1014. A
 * fresh world only ever sees the current layout, so the seed output is right.
 * A world that was seeded under an older layout and then re-seeded is not: its
 * sectors still hang off the OLD corporation ids, or off the bare sovereign
 * issuer from before the SOE split existed. East Germany on the live world is
 * all three at once: 3 sector types on the current 0x1500 base, 5 on an
 * orphaned 0x600 base, energy at 0xc10, and 8 more still on the primary
 * national corporation with no enterprise of their own.
 *
 * Every call site used to upsert sectors on
 * `{ corporationId, stateId, sectorType }`. That filter can never match a
 * sector living under a stale owner, so a re-seed INSERTED a second producing
 * document for the same region and sector type. Two rows for one real sector
 * double-count supply, capacity, and workers for the whole country.
 *
 * So: re-point first, then upsert. A sector is only ever moved when its current
 * owner is another COUNTRY-OWNED corporation of the SAME country, which is why
 * the stale-owner set is read back from the database rather than guessed. A
 * player-founded or nationalised corporation is never a candidate, so this can
 * not take a sector away from anyone who holds one.
 *
 * Re-pointing is skipped when the canonical owner already has that
 * (region, sector type) row, because moving the stale row on top of it would
 * recreate the duplicate this exists to prevent. Such a stale leftover is
 * reported by `verifyCommandEconomySeed` rather than deleted here: the seeder
 * does not destroy producing history.
 */
export async function upsertCountryOwnedCorpEntries(
  db: Db,
  countryId: CountryId,
  entries: CountryOwnedSeedData[]
): Promise<CountryOwnedCorpUpsertResult> {
  const result: CountryOwnedCorpUpsertResult = { corporations: 0, sectors: 0, repointed: 0 };
  if (entries.length === 0) return result;

  const corpOps: AnyBulkWriteOperation<Corporation>[] = [];
  for (const entry of entries) {
    const { _id: corpId, ...corpData } = entry.corporation;
    corpOps.push({
      updateOne: { filter: { _id: corpId }, update: { $set: corpData }, upsert: true },
    });
  }
  // Corporations before sectors: a sector's owning corporation always exists first.
  await db.collection<Corporation>("corporations").bulkWrite(corpOps, { ordered: true });
  result.corporations = corpOps.length;

  // Only a corporation this seed run gives producing sectors to is a legitimate
  // sector owner. The bare sovereign issuer is emitted with `sectors: []`, so it
  // counts as a stale owner here even though its id is current: sectors sitting
  // on it are the pre-SOE-split shape, exactly what `verifyCommandEconomySeed`
  // reports as `sectorsOnPrimaryCorp`.
  const canonicalSectorOwnerIds = new Set(
    entries
      .filter((entry) => entry.sectors.length > 0)
      .map((entry) => String(entry.corporation._id))
  );
  // Read back AFTER the corporation upsert so the canonical ids are present and
  // anything else still flagged as country-owned is, by definition, from an
  // older id layout.
  const countryOwnedIds = (
    await db
      .collection<Corporation>("corporations")
      .find({ countryOwnerId: countryId }, { projection: { _id: 1 } })
      .toArray()
  ).map((corp) => corp._id as ObjectId);
  const staleOwnerIds = countryOwnedIds.filter((id) => !canonicalSectorOwnerIds.has(String(id)));

  const sectors = db.collection<CorporateSector>("corporateSectors");
  const sectorOps: AnyBulkWriteOperation<CorporateSector>[] = [];

  for (const entry of entries) {
    const corpId = entry.corporation._id;
    for (const sector of entry.sectors) {
      if (staleOwnerIds.length > 0) {
        const canonicalExists = await sectors.countDocuments(
          { corporationId: corpId, stateId: sector.stateId, sectorType: sector.sectorType },
          { limit: 1 }
        );
        if (canonicalExists === 0) {
          const moved = await sectors.updateOne(
            {
              countryId,
              stateId: sector.stateId,
              sectorType: sector.sectorType,
              corporationId: { $in: staleOwnerIds },
            },
            { $set: { corporationId: corpId } }
          );
          result.repointed += moved.modifiedCount;
        }
      }

      const { _id: _sectorId, ...sectorData } = sector;
      sectorOps.push({
        updateOne: {
          filter: { corporationId: corpId, stateId: sector.stateId, sectorType: sector.sectorType },
          update: { $set: sectorData },
          upsert: true,
        },
      });
    }
  }

  if (sectorOps.length > 0) {
    await sectors.bulkWrite(sectorOps, { ordered: true });
    result.sectors = sectorOps.length;
  }

  return result;
}
