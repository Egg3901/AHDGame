import type { Db } from "mongodb";
import type { AnyBulkWriteOperation } from "mongodb";
import type { Migration, MigrationResult } from "../types";
import type { StatePolicyRecord } from "@/lib/db/types/legislation";
import { projectLawToLegislationType } from "@/lib/politicalLegislation/project";
import {
  REGIONAL_DEFAULT_LEVEL,
  regionalDefaultLaws,
} from "@/lib/politicalLegislation/regionalDefaults";
import { LAW_COUNTRY_IDS } from "@/lib/politicalLegislation/types";
import { DD_LAND_STATE_IDS } from "@/lib/politicalLegislation/laws/ddLandLaws";

/**
 * Backfill the level-0 regional default law for every new-generation `both`
 * law in every region of US / UK / RU / DD.
 *
 * `seedPoliticalLegislationBaseline` wrote regional `statePolicies` rows only
 * for the `regional` sidecars (the DD Land laws), but
 * `projectLawToLegislationType` passes `allowedScope: "both"` through and
 * `/api/game/legislation-types?scope=state` offers exactly that. Every `both`
 * law was therefore proposable in a region that had no current law for it, and
 * `LawProvisionComparison` bails on `currentIndex === undefined` — taking the
 * fiscal comparison and the political-metric chips down with the "Current law"
 * box. Live worlds seeded before the seeder fix need these rows written.
 *
 * Level 0, not the national baseline: `getEnactedLevel` already reports 0 for a
 * region with no record, and `seedPoliticalMetricsResiduals` composes day-one
 * equilibrium from the national book plus the SIDECAR baselines only. Writing 0
 * changes nothing any engine path reads; writing `baselineLevelFor` would
 * double-count every `both` law into every region's target.
 *
 * Insert-only via `$setOnInsert`: a region that has already legislated one of
 * these (through play, a governor order, or an earlier run) keeps its row
 * untouched. No `both` law carries an era `window`, so the catalog needs no
 * year filter here.
 */
async function backfillRegionalDefaultLaws(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];
  const now = new Date();
  const ops: AnyBulkWriteOperation<StatePolicyRecord>[] = [];
  let scanned = 0;

  for (const countryId of LAW_COUNTRY_IDS) {
    const laws = regionalDefaultLaws(countryId);
    if (laws.length === 0) continue;

    // Same guard the seeder uses: a drifted world must not invent Bezirke.
    const allowed = countryId === "DD" ? new Set<string>(DD_LAND_STATE_IDS) : null;
    const states = await db
      .collection<{ _id: string }>("states")
      .find({ countryId })
      .project<{ _id: string }>({ _id: 1 })
      .toArray();
    const regionIds = states
      .map((s) => String(s._id))
      .filter((id) => (allowed ? allowed.has(id) : true));
    if (regionIds.length === 0) {
      notes.push(`${countryId}: no regions found`);
      continue;
    }

    const lawIds = laws.map((law) => law.id);
    // Scope-blind on purpose. `StatePolicy.scope` is optional on reads —
    // pre-migration documents lack it — so filtering on it here would miss an
    // existing row and, since `statePolicies` carries no unique index, insert a
    // silent duplicate beside it. The upsert filter below still WRITES a scoped
    // row; only the existence check is permissive.
    const existing = await db
      .collection<StatePolicyRecord>("statePolicies")
      .find({ stateId: { $in: regionIds }, legislationTypeId: { $in: lawIds } })
      .project<{ stateId: string; legislationTypeId: string }>({
        stateId: 1,
        legislationTypeId: 1,
      })
      .toArray();
    const have = new Set(existing.map((r) => `${r.stateId}|${r.legislationTypeId}`));

    let countryMissing = 0;
    for (const stateId of regionIds) {
      for (const law of laws) {
        scanned++;
        if (have.has(`${stateId}|${law.id}`)) continue;
        countryMissing++;
        const option = projectLawToLegislationType(law).policyOptions![REGIONAL_DEFAULT_LEVEL];
        ops.push({
          updateOne: {
            filter: { scope: "state", stateId, legislationTypeId: law.id },
            update: {
              $setOnInsert: {
                scope: "state" as const,
                stateId,
                legislationTypeId: law.id,
                economic: option.economic,
                social: option.social,
                policyOptionId: option.id,
                policyOptionIndex: REGIONAL_DEFAULT_LEVEL,
                effectDirection: option.effectDirection,
                updatedAt: now,
              },
            },
            upsert: true,
          },
        });
      }
    }
    notes.push(
      `${countryId}: ${regionIds.length} region(s) x ${laws.length} law(s), ` +
        `${countryMissing} missing`
    );
  }

  if (ops.length === 0) {
    notes.push("nothing to backfill");
    return { documentsScanned: scanned, documentsInserted: 0, notes };
  }
  if (dryRun) {
    notes.push(`dry run: no writes performed (${ops.length} row(s) would be inserted)`);
    return { documentsScanned: scanned, notes };
  }

  const result = await db
    .collection<StatePolicyRecord>("statePolicies")
    .bulkWrite(ops, { ordered: false });
  const documentsInserted = result.upsertedCount ?? 0;
  if (documentsInserted !== ops.length) {
    notes.push(
      `${ops.length - documentsInserted} row(s) appeared between scan and write; left untouched`
    );
  }

  return { documentsScanned: scanned, documentsInserted, notes };
}

export const migration: Migration = {
  id: "2026-08-31-regional-default-laws-newgen",
  description:
    "Backfill the level-0 regional default law for every new-generation `both` law in every US/UK/RU/DD region, so region bills render a current law, a fiscal comparison and metric chips (insert-only)",
  idempotent: true,
  execute: (db, ctx) => backfillRegionalDefaultLaws(db, ctx.dryRun),
};
