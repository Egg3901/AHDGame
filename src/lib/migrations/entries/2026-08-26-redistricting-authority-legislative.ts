import type { Db } from "mongodb";
import type { Migration, MigrationResult } from "../types";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import type { CongressionalDistrict } from "@/lib/db/types";
import { REDISTRICT_AUTHORITY_LAW } from "@/lib/redistricting/caps";
import { legislativeAuthorityPolicy } from "@/lib/redistricting/seedRedistrictingAuthority";

/**
 * Backfill the redistricting-authority law to "Legislature-drawn" for every US
 * state that has congressional districts.
 *
 * The feature has been live (redistrictingEnabled) with no state ever able to
 * redraw: `us_state_redistricting_authority` was authored against the old
 * legislation catalog and never ported to the v2 typed catalog, so it is not a
 * proposable bill and no statePolicies row is ever written for it. Every state
 * therefore falls to the code default (index 1, bipartisan commission,
 * canDraw:false). That default is also historically wrong for the 1953/1960
 * eras, where legislatures drew the maps.
 *
 * Insert-only via `$setOnInsert`: a state that already carries an authority row
 * (a future player/SCOTUS change) is left untouched.
 */
async function backfillRedistrictingAuthority(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];

  const stateIds = (await db
    .collection<CongressionalDistrict>("congressionalDistricts")
    .distinct("stateId")) as string[];
  notes.push(`${stateIds.length} state(s) with congressional districts`);

  if (stateIds.length === 0) {
    notes.push("no districted states — nothing to backfill");
    return { documentsScanned: 0, notes };
  }

  const existing = await db
    .collection<StatePolicy>("statePolicies")
    .find({ legislationTypeId: REDISTRICT_AUTHORITY_LAW, stateId: { $in: stateIds } })
    .project<{ stateId: string }>({ stateId: 1 })
    .toArray();
  const existingIds = new Set(existing.map((r) => r.stateId));
  const missing = stateIds.filter((s) => !existingIds.has(s));
  notes.push(`${existingIds.size} already set, ${missing.length} to backfill (legislature-drawn)`);

  if (dryRun || missing.length === 0) {
    if (dryRun) notes.push("dry run: no writes performed");
    return { documentsScanned: stateIds.length, notes };
  }

  const now = new Date();
  const result = await db.collection<StatePolicy>("statePolicies").bulkWrite(
    missing.map((stateId) => ({
      updateOne: {
        filter: { stateId, legislationTypeId: REDISTRICT_AUTHORITY_LAW },
        update: { $setOnInsert: legislativeAuthorityPolicy(stateId, now) },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  const documentsInserted = result.upsertedCount ?? 0;
  if (documentsInserted !== missing.length) {
    notes.push(
      `${missing.length - documentsInserted} row(s) appeared between scan and write; left untouched`
    );
  }

  return { documentsScanned: stateIds.length, documentsInserted, notes };
}

export const migration: Migration = {
  id: "2026-08-26-redistricting-authority-legislative",
  description:
    "Backfill US states' redistricting-authority law to legislature-drawn so trifectas can redraw (insert-only; never overwrites an existing authority row)",
  idempotent: true,
  execute: (db, ctx) => backfillRedistrictingAuthority(db, ctx.dryRun),
};
