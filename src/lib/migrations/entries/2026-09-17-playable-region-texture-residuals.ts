import type { Db } from "mongodb";
import type { AnyBulkWriteOperation } from "mongodb";
import type { Migration, MigrationResult } from "../types";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { REGIONAL_TEXTURE_1953 } from "@/lib/politicalMetrics/seeds/regionalTexture1953";
import { POLITICAL_METRIC_COUNTRY_IDS, type PoliticalMetricId } from "@/lib/politicalMetrics/types";

const PRESET = "1953-default";
const STARTING_YEAR = 1953;

const MIGRATION_ID = "2026-09-17-playable-region-texture-residuals";

/**
 * Backfill the issue-#704 playable-region texture into live 1953 worlds.
 *
 * New seeds write baseline + texture + modifier into `values`, but a running
 * world must NOT have its values rewritten: the dynamics phase drifts values
 * toward composeTarget(national + supplement + residual), so the backfill
 * writes to `residuals` instead and each region glides to its new equilibrium
 * over ~20 turns instead of lurching mid-campaign.
 *
 * residual_new = residual_old + texture: the law book (and therefore the
 * day-one target the old residual was measured against) is unchanged, so the
 * permanent character gap is exactly the texture deviation. Residuals are
 * fixed at reset and moved by nothing in the turn phase, which is what makes
 * a delta-add the honest operation here.
 *
 * Safety rules, all enforced below and covered by the sibling test:
 * - strict world/preset guards: runs only when gameState says 1953-default
 *   with startingYear 1953; every other world is skipped with a note.
 * - US/UK/RU/DD regions present in the texture table only; non-playables and
 *   drifted rosters are untouched.
 * - docs WITHOUT a residuals map are skipped, never invented: the dynamics
 *   phase's lazy self-heal owns those, and fabricating equilibrium here would
 *   fork its derivation.
 * - updates $set the WHOLE residuals map, never a dotted per-family path and
 *   never $unset. Board maps are keyed by literal dotted strings
 *   ("economy.stability"), so "residuals.<family>" would nest instead of
 *   landing (local/no-dotted-board-path). Siblings are preserved by spreading
 *   the read doc, so event-driven movement in other families survives.
 * - idempotent via the playableTexture1953MigrationId stamp: a re-run skips
 *   stamped docs instead of adding the delta twice. Dry runs read only.
 */
async function backfillPlayableTextureResiduals(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const gameState = await db
    .collection<{ _id: string; preset?: string; startingYear?: number }>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1, startingYear: 1 } });
  if (gameState?.preset !== PRESET) {
    return { notes: [`skipped: active preset is ${String(gameState?.preset ?? "unknown")}`] };
  }
  if (gameState.startingYear !== undefined && gameState.startingYear !== STARTING_YEAR) {
    return {
      notes: [`skipped: startingYear is ${String(gameState.startingYear)}, not ${STARTING_YEAR}`],
    };
  }

  const docs = await db
    .collection<PoliticalMetricsDoc>("politicalMetrics")
    .find({ countryId: { $in: [...POLITICAL_METRIC_COUNTRY_IDS] } })
    .toArray();

  const notes: string[] = [];
  let scanned = 0;
  let withoutResiduals = 0;
  let alreadyApplied = 0;
  let noTexture = 0;
  const ops: AnyBulkWriteOperation<PoliticalMetricsDoc>[] = [];
  const perCountry = new Map<string, number>();

  for (const doc of docs) {
    scanned++;
    const regionId = String(doc._id);
    const countryId = String(doc.countryId);
    const texture =
      REGIONAL_TEXTURE_1953[countryId as keyof typeof REGIONAL_TEXTURE_1953]?.[regionId];
    if (!texture || Object.keys(texture).length === 0) {
      noTexture++;
      continue;
    }
    const prior = doc.residuals;
    if (!prior) {
      withoutResiduals++;
      continue;
    }
    if (doc.playableTexture1953MigrationId === MIGRATION_ID) {
      alreadyApplied++;
      continue;
    }
    // Whole-map rewrite with the delta folded in: dotted per-family $set
    // paths would nest under "residuals" instead of landing on the literal
    // dotted key. Siblings spread forward untouched.
    const residuals: Record<PoliticalMetricId, number> = { ...prior };
    let touched = 0;
    for (const [familyId, delta] of Object.entries(texture)) {
      if (typeof delta !== "number" || delta === 0) continue;
      const id = familyId as PoliticalMetricId;
      residuals[id] = (prior[id] ?? 0) + delta;
      touched++;
    }
    if (touched === 0) {
      noTexture++;
      continue;
    }
    perCountry.set(countryId, (perCountry.get(countryId) ?? 0) + 1);
    if (dryRun) continue;
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            residuals,
            playableTexture1953MigrationId: MIGRATION_ID,
            lastUpdated: new Date(),
          },
        },
      },
    });
  }

  const wouldWrite = [...perCountry.values()].reduce((n, c) => n + c, 0);
  for (const [countryId, count] of [...perCountry.entries()].sort()) {
    notes.push(`${countryId}: ${dryRun ? "would texture" : "textured"} ${count} region(s)`);
  }
  if (withoutResiduals > 0) {
    notes.push(
      `${withoutResiduals} doc(s) have no residuals map — skipped for the dynamics self-heal`
    );
  }
  if (alreadyApplied > 0) notes.push(`${alreadyApplied} doc(s) already stamped — skipped`);
  if (noTexture > 0) notes.push(`${noTexture} doc(s) carry no texture — skipped`);

  if (dryRun) {
    notes.push(`dry run: no writes performed (${wouldWrite} doc(s) would be updated)`);
    return { documentsScanned: scanned, documentsUpdated: 0, notes };
  }
  if (ops.length === 0) {
    notes.push("nothing to backfill");
    return { documentsScanned: scanned, documentsUpdated: 0, notes };
  }

  const result = await db
    .collection<PoliticalMetricsDoc>("politicalMetrics")
    .bulkWrite(ops, { ordered: false });
  const documentsUpdated = result.modifiedCount ?? 0;
  if (documentsUpdated !== ops.length) {
    notes.push(
      `${ops.length - documentsUpdated} doc(s) did not report a modification; left untouched`
    );
  }
  return { documentsScanned: scanned, documentsUpdated, notes };
}

export const migration: Migration = {
  id: MIGRATION_ID,
  description:
    "Backfill the 1953 playable-region texture into live residuals (in-place per-family adds; 1953 worlds only).",
  idempotent: true,
  execute: (db, ctx) => backfillPlayableTextureResiduals(db, ctx.dryRun),
};
