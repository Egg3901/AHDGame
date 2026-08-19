/**
 * Targeted repair: give East Germany the 8 state enterprises it never got,
 * without resetting the economy underneath them.
 *
 * On the live world DD's 102 producing `corporateSectors` (6 regions x 17
 * sector types) are split across three generations of the SOE id layout:
 *
 *   - chemical_industries, agriculture, extraction sit on the CURRENT
 *     `SOE_ID_BASE_BY_COUNTRY.DD` band (0x1500 + ordinal * 8);
 *   - financial, retail, construction, defense, entertainment sit on an
 *     orphaned 0x600 band;
 *   - energy sits at 0xc10;
 *   - media, healthcare, technology, real_estate, telecommunications,
 *     logistics, manufacturing and automobiles have NO enterprise at all. All
 *     48 of those sectors hang off the bare sovereign issuer
 *     `700000000000000000000091`, which carries no `soe` overlay. That is the
 *     same shape the USSR was in before 2026-08-13-repoint-ru-soes.ts, and it
 *     has the same consequence: `loadCommandEconomyDashboard` queries
 *     `{countryId, soe: {$exists: true}}`, so those 8 sectors appear in no
 *     enterprise table and there is no director seat for a DD player to claim.
 *     Private founding is banned in a planned economy, so there is no other way
 *     in.
 *
 * This migration fixes ONLY the third case. It:
 *   - creates the 8 missing SOE corporations, using the canonical ids, names
 *     and sequential ids from `generateCountryOwnedSeedData` so a later seed
 *     run matches them rather than duplicating them;
 *   - RE-POINTS the existing sector documents by `sectorType` with
 *     `updateMany`, so revenue, capital stock, workers and every other
 *     accumulated field survive;
 *   - leaves the primary corporation in place as the sovereign issuer, because
 *     the DDM 3B of seeded bond tranches reference it.
 *
 * It deliberately does NOT renumber the 6 enterprises already on the 0x600 /
 * 0xc10 bands. Their ids are cosmetically wrong and functionally fine:
 * `natcorpIds` treats every `countryOwnerId` corporation alike, and each one
 * already carries its `soe` overlay, so the dashboard, the plan, and the
 * director seat all work. Renumbering them would mean creating a replacement
 * corporation and abandoning the old `_id`, which is referenced by
 * `corporationHistory`, the defence contract book (0x660 is DD's arms
 * supplier), supply agreements, union rosters and the financial ledger. None of
 * those follow a corporation id change, so the trade is real accumulated
 * history for a tidier hex number. Fresh worlds already seed all 17 on the
 * 0x1500 band, so the drift ends on its own.
 *
 * Nothing is deleted. No player holds any of this: every DD enterprise has
 * `soe.directorId: null`, `shareholders: []` and `totalShares: 0`, so there is
 * no seat and no equity to take away.
 *
 * Idempotent: re-running finds the SOEs already present and no sectors left on
 * the primary corporation, and does nothing. "Already present" means matching
 * on `soe.sector` OR `assignedSectorTypes`, so an enterprise that a player
 * carved out through `POST /national-corporation/split` (random id, no
 * overlay) is adopted and given its overlay rather than duplicated at the
 * canonical
 * id. That is not hypothetical: it is exactly what DD looked like by the time
 * this migration was due to run.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-08-19-repoint-dd-soes.ts --dry-run
 *   npx tsx scripts/migrations/2026-08-19-repoint-dd-soes.ts
 */

import { ObjectId, type Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";
import type { Corporation, CorporateSector, State } from "../../src/lib/db/types";
import type { CorporationType } from "../../src/lib/constants/corporations";
import type { MigrationResult } from "../../src/lib/migrations/types";
import { NUMERIC_BSON_TYPE } from "../../src/lib/db/queryHelpers";
import { attachSoeOverlayIfPlanned } from "../../src/lib/nationalization/restructure";

const COUNTRY = "DD" as const;

export async function runRepointDdSoes(
  db: Db,
  opts: { dryRun?: boolean; log?: (msg: string) => void } = {}
): Promise<MigrationResult> {
  const { dryRun = false, log = () => {} } = opts;
  const notes: string[] = [];

  const { generateCountryOwnedSeedData } = await import("../../src/lib/seeds/reference/budgets");
  const { loadWorldPreset } = await import("../../src/lib/currency/gdpAnchorRate");
  const preset = await loadWorldPreset(db);
  notes.push(`preset=${preset}`);

  const primary = await db
    .collection<Corporation>("corporations")
    .findOne(
      { countryId: COUNTRY, isPrimaryNationalCorporation: true },
      { projection: { _id: 1 } }
    );
  if (!primary) {
    notes.push("no primary national corporation for DD, nothing to re-point, aborting");
    return {
      documentsScanned: 0,
      documentsInserted: 0,
      documentsUpdated: 0,
      documentsDeleted: 0,
      notes,
    };
  }

  const states = await db
    .collection<State>("states")
    .find({ countryId: COUNTRY }, { projection: { countryId: 1, population: 1, gdp: 1 } })
    .toArray();
  const statesForSeed = states.map((s) => ({
    id: String(s._id),
    population: s.population,
    gdp: s.gdp,
    countryId: COUNTRY,
  }));

  // `true` for commandEconomyEnabled: this migration exists precisely because
  // part of the world was built without the split, so the live flag is not the
  // authority here.
  const entries = generateCountryOwnedSeedData(statesForSeed as never, preset, true).filter(
    (e) => e.corporation.soe && e.corporation.countryOwnerId === COUNTRY
  );
  notes.push(`seedEntries=${entries.length}`);

  let inserted = 0;
  let updated = 0;
  let scanned = 0;
  let adopted = 0;

  for (const entry of entries) {
    const sectorType = (entry.corporation.assignedSectorTypes?.[0] ??
      entry.corporation.type) as CorporationType;

    // An enterprise on a legacy id band, OR one a player carved out through
    // `POST /national-corporation/split`, is still THIS sector's enterprise:
    // match on what the corporation CLAIMS, never on its id, so the 0x600 /
    // 0xc10 corporations and any random-id split-off are reused rather than
    // duplicated at their canonical id.
    //
    // `assignedSectorTypes` is the load-bearing half of that. Matching on
    // `soe.sector` alone was not enough: on 2026-08-19 a DD player split off
    // all 8 of the sector types this migration was written to create, and
    // `splitOffSectorType` did not attach an `soe` overlay at the time. Those
    // enterprises were therefore invisible to a `soe.sector` probe, so a run
    // would have created 8 duplicates on the canonical ids and stranded the
    // real ones, one of which a player is CEO of.
    const existing = await db.collection<Corporation>("corporations").findOne(
      {
        countryId: COUNTRY,
        $or: [{ "soe.sector": sectorType }, { assignedSectorTypes: sectorType }],
      },
      { projection: { _id: 1, soe: 1 } }
    );

    let corpId = existing?._id ?? (entry.corporation._id as ObjectId);

    // An enterprise that exists but carries no overlay is adopted, not
    // replaced: give it the overlay so the command-economy dashboard and the
    // director seat find it. Runs after any re-point below would be pointless,
    // so it is deliberately ordered after the sector move (see end of loop).

    if (!existing) {
      // Never claim an id another corporation already owns.
      const idTaken = await db
        .collection<Corporation>("corporations")
        .findOne({ _id: corpId }, { projection: { _id: 1 } });
      if (idTaken) corpId = new ObjectId();

      const { _id: _seedId, sequentialId: seedSequentialId, ...corpData } = entry.corporation;
      let sequentialId = seedSequentialId;
      if (sequentialId != null) {
        const clash = await db
          .collection<Corporation>("corporations")
          .findOne({ sequentialId }, { projection: { _id: 1 } });
        if (clash && !clash._id.equals(corpId)) {
          const [maxRow] = await db
            .collection<Corporation>("corporations")
            .find({ sequentialId: { $type: NUMERIC_BSON_TYPE } })
            .project({ sequentialId: 1 })
            .sort({ sequentialId: -1 })
            .limit(1)
            .toArray();
          sequentialId = ((maxRow?.sequentialId as number) ?? sequentialId) + 1;
        }
      }

      if (!dryRun) {
        await db
          .collection<Corporation>("corporations")
          .updateOne(
            { _id: corpId },
            { $set: { ...corpData, ...(sequentialId != null ? { sequentialId } : {}) } },
            { upsert: true }
          );
      }
      inserted++;
      log(
        `[DD] ${dryRun ? "would create" : "created"} SOE ${entry.corporation.name} (${sectorType})`
      );
    }

    // Re-point, never re-seed: the live sector rows keep their revenue.
    const filter = {
      countryId: COUNTRY,
      sectorType,
      corporationId: primary._id,
    };
    const matched = await db.collection<CorporateSector>("corporateSectors").countDocuments(filter);
    scanned += matched;
    if (matched > 0) {
      if (!dryRun) {
        await db
          .collection<CorporateSector>("corporateSectors")
          .updateMany(filter, { $set: { corporationId: corpId } });
      }
      updated += matched;
      log(`[DD] ${dryRun ? "would re-point" : "re-pointed"} ${matched} ${sectorType} sector(s)`);
    }

    // Adopt an overlay-less enterprise (a player split-off, or anything else
    // created outside the seed). Done after the re-point so the overlay is
    // derived from the full set of sectors the corp ends up holding.
    if (existing && !existing.soe) {
      if (dryRun) {
        adopted++;
        log(`[DD] would attach soe overlay to existing ${sectorType} enterprise`);
      } else if (await attachSoeOverlayIfPlanned(db, COUNTRY, corpId, sectorType)) {
        adopted++;
        log(`[DD] attached soe overlay to existing ${sectorType} enterprise`);
      }
    }
  }

  const leftOnPrimary = await db
    .collection<CorporateSector>("corporateSectors")
    .countDocuments({ countryId: COUNTRY, corporationId: primary._id });
  notes.push(`sectorsRemainingOnPrimary=${dryRun ? "(dry-run, unchanged) " : ""}${leftOnPrimary}`);
  notes.push(
    `soesCreated=${inserted}`,
    `sectorsRepointed=${updated}`,
    `overlaysAdopted=${adopted}`
  );

  return {
    documentsScanned: scanned,
    documentsInserted: inserted,
    documentsUpdated: updated + adopted,
    documentsDeleted: 0,
    notes,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await connectDb();
  try {
    const result = await runRepointDdSoes(db, { dryRun, log: (m) => console.log(m) });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
