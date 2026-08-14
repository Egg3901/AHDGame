/**
 * Targeted repair: give the USSR its 17 state-owned enterprises without
 * resetting the economy underneath them.
 *
 * On the live iteration-4 world RU came up with no SOEs at all. All 238 of its
 * producing `corporateSectors` (14 regions x 17 sector types) hang off the bare
 * sovereign issuer `700000000000000000000081`, which carries no `soe` overlay,
 * so `loadCommandEconomyDashboard` (which queries `{countryId, soe:{$exists:true}}`)
 * renders an empty table and there is no seat for any of the 44 RU players to
 * claim. Private founding is banned in a planned economy and RU has zero
 * `unownedSectors`, so there is no other way in either.
 *
 * `reconcileCommandEconomyUnowned` would fix this, but it is the wrong tool
 * here on two counts:
 *
 *   1. It is GLOBAL. It walks every command country and would delete and
 *      re-upsert all 1,283 of their producing sectors, resetting revenue for
 *      DD, PL, HU, CS, BG, RO, YU, CN, UKR, BLR and BAL — none of which are
 *      broken.
 *   2. It re-upserts sectors from SEED values, so even for RU it would throw
 *      away the revenue those sectors have accumulated since turn 74.
 *
 * This migration instead:
 *   - creates only RU's 17 SOE corporations, using the canonical ids, names and
 *     sequential ids from `generateCountryOwnedSeedData` so a later reconcile
 *     matches them rather than duplicating them;
 *   - RE-POINTS the existing sector documents by `sectorType` with `updateMany`,
 *     so revenue, market share and every other accumulated field survive;
 *   - leaves the primary corp in place as the sovereign issuer, because the bond
 *     tranches reference it.
 *
 * Nothing is deleted. Idempotent: re-running finds the SOEs already present and
 * no sectors left on the primary corp, and does nothing.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-08-13-repoint-ru-soes.ts --dry-run
 *   npx tsx scripts/migrations/2026-08-13-repoint-ru-soes.ts
 */

import { ObjectId, type Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";
import type { Corporation, CorporateSector, State } from "../../src/lib/db/types";
import type { CorporationType } from "../../src/lib/constants/corporations";
import type { MigrationResult } from "../../src/lib/migrations/types";
import { NUMERIC_BSON_TYPE } from "../../src/lib/db/queryHelpers";

const COUNTRY = "RU" as const;

export async function runRepointRuSoes(
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
    notes.push("no primary national corporation for RU — nothing to re-point, aborting");
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

  // `true` for commandEconomyEnabled: this migration exists precisely because the
  // world was built without the split, so the live flag is not the authority here.
  const entries = generateCountryOwnedSeedData(statesForSeed as never, preset, true).filter(
    (e) => e.corporation.soe && e.corporation.countryOwnerId === COUNTRY
  );
  notes.push(`seedEntries=${entries.length}`);

  let inserted = 0;
  let updated = 0;
  let scanned = 0;

  for (const entry of entries) {
    const sectorType = (entry.corporation.assignedSectorTypes?.[0] ??
      entry.corporation.type) as CorporationType;

    // Already healed (or a prior reconcile made it): reuse rather than duplicate.
    const existing = await db
      .collection<Corporation>("corporations")
      .findOne({ countryId: COUNTRY, "soe.sector": sectorType }, { projection: { _id: 1 } });

    let corpId = existing?._id ?? (entry.corporation._id as ObjectId);

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
        `[RU] ${dryRun ? "would create" : "created"} SOE ${entry.corporation.name} (${sectorType})`
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
      log(`[RU] ${dryRun ? "would re-point" : "re-pointed"} ${matched} ${sectorType} sector(s)`);
    }
  }

  const leftOnPrimary = await db
    .collection<CorporateSector>("corporateSectors")
    .countDocuments({ countryId: COUNTRY, corporationId: primary._id });
  notes.push(`sectorsRemainingOnPrimary=${dryRun ? "(dry-run, unchanged) " : ""}${leftOnPrimary}`);
  notes.push(`soesCreated=${inserted}`, `sectorsRepointed=${updated}`);

  return {
    documentsScanned: scanned,
    documentsInserted: inserted,
    documentsUpdated: updated,
    documentsDeleted: 0,
    notes,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await connectDb();
  try {
    const result = await runRepointRuSoes(db, { dryRun, log: (m) => console.log(m) });
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
