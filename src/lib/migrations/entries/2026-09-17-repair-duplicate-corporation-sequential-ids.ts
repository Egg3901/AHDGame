import { ObjectId, type Db } from "mongodb";
import {
  findDuplicateCorporationSequentialIds,
  formatSequentialIdCollisions,
  type SeededCorporationIdentity,
} from "@/lib/admin/seed/indexes/assertUniqueCorporationIds";
import type { Migration, MigrationContext, MigrationResult } from "../types";

export interface SovereignIssuerRepair {
  countryId: string;
  name: string;
  /** Deterministic sovereign-issuer corporation _id (see generateCountryOwnedSeedData). */
  oidHex: string;
  /** Post-fix sequentialId in the dedicated 900_019-900_026 block. */
  sequentialId: number;
}

/**
 * The eight sovereign issuers issue #2028 renumbered. Hardcoded (not derived
 * from the seed module) so the repair stays stable forever even if the seed
 * moves on: _ids are the deterministic `00000000000000000000aXXX` sovereign
 * series, targets are the dedicated 900_019-900_026 block that is disjoint
 * from the sovereign sequence (US 900_001-DD 900_010), the 1953 market
 * state-enterprise block (900_011-900_018), and the command SOE bases
 * (900_100+).
 */
export const DUPLICATE_SOVEREIGN_ISSUER_REPAIRS: readonly SovereignIssuerRepair[] = [
  { countryId: "FR", name: "France", oidHex: "00000000000000000000a001", sequentialId: 900_019 },
  { countryId: "IT", name: "Italy", oidHex: "00000000000000000000a004", sequentialId: 900_020 },
  { countryId: "ES", name: "Spain", oidHex: "00000000000000000000a007", sequentialId: 900_021 },
  { countryId: "SE", name: "Sweden", oidHex: "00000000000000000000a00a", sequentialId: 900_022 },
  { countryId: "TR", name: "Turkey", oidHex: "00000000000000000000a00d", sequentialId: 900_023 },
  { countryId: "GR", name: "Greece", oidHex: "00000000000000000000a010", sequentialId: 900_024 },
  { countryId: "AT", name: "Austria", oidHex: "00000000000000000000a013", sequentialId: 900_025 },
  { countryId: "FI", name: "Finland", oidHex: "00000000000000000000a016", sequentialId: 900_026 },
];

interface RepairCorporationDoc {
  _id: ObjectId;
  sequentialId?: number | null;
  name?: string | null;
}

/**
 * Repair worlds seeded while the FR/IT/ES/SE/TR/GR/AT/FI sovereign issuers
 * reused 900_009-900_016 (issue #2028): move each issuer to its dedicated id
 * by deterministic _id, then create the corporations_sequentialId unique
 * guard. Fresh/reset worlds never need this (their seed already emits the
 * fixed ids and bootstrap creates the index), but any persistent world
 * bootstrapped from the buggy seed keeps ambiguous URLs and an unprotected
 * collection until something renumbers it in place.
 *
 * Idempotent: issuers already on their target id are skipped, worlds without
 * the issuers (other presets/eras) only get the index ensured, and
 * createIndex with the same name/key/options is a no-op on re-run. Fails
 * loudly (no marker written, retried next deploy) if an unexpected extra
 * claimant still shares an id after the repair, instead of tripping over a
 * bare E11000 during index creation.
 */
export async function repairDuplicateCorporationSequentialIds(
  db: Db,
  ctx: MigrationContext
): Promise<MigrationResult> {
  const corporations = db.collection<RepairCorporationDoc>("corporations");
  const notes: string[] = [];
  let updated = 0;
  let alreadyCorrect = 0;
  let missing = 0;
  // Planned renumbers by corporation _id. Overlaid onto the residual scan so
  // a dry run (which writes nothing) still answers whether the repair would
  // converge, instead of tripping over the very duplicates it would fix.
  const planned = new Map<string, number>();

  for (const row of DUPLICATE_SOVEREIGN_ISSUER_REPAIRS) {
    const doc = await corporations.findOne(
      { _id: new ObjectId(row.oidHex) },
      { projection: { sequentialId: 1, name: 1 } }
    );
    if (!doc) {
      missing += 1;
      continue;
    }
    if (doc.sequentialId === row.sequentialId) {
      alreadyCorrect += 1;
      continue;
    }
    notes.push(
      `"${row.name}" [${row.countryId}]: ${String(doc.sequentialId)} -> ${row.sequentialId}`
    );
    planned.set(String(doc._id), row.sequentialId);
    if (!ctx.dryRun) {
      await corporations.updateOne({ _id: doc._id }, { $set: { sequentialId: row.sequentialId } });
    }
    updated += 1;
  }

  const all = (
    (await corporations
      .find({}, { projection: { sequentialId: 1, name: 1, countryId: 1 } })
      .toArray()) as SeededCorporationIdentity[]
  ).map((doc) => {
    const next = planned.get(String(doc._id));
    return next === undefined ? doc : { ...doc, sequentialId: next };
  });
  const collisions = findDuplicateCorporationSequentialIds(all);
  if (collisions.length > 0) {
    throw new Error(
      `corporations still contain ${collisions.length} duplicate sequentialId(s) after ` +
        `sovereign-issuer repair; refusing to create corporations_sequentialId:\n` +
        formatSequentialIdCollisions(collisions)
    );
  }

  if (!ctx.dryRun) {
    await corporations.createIndex(
      { sequentialId: 1 },
      { unique: true, sparse: true, name: "corporations_sequentialId" }
    );
  }
  notes.unshift(
    `${ctx.dryRun ? "DRY RUN, no writes. " : ""}${DUPLICATE_SOVEREIGN_ISSUER_REPAIRS.length} sovereign issuers; ` +
      `${updated} renumbered, ${alreadyCorrect} already correct, ${missing} absent; ` +
      `unique index ${ctx.dryRun ? "would be ensured" : "ensured"}`
  );

  return {
    documentsScanned: all.length,
    documentsUpdated: ctx.dryRun ? 0 : updated,
    notes,
  };
}

export const migration: Migration = {
  id: "2026-09-17-repair-duplicate-corporation-sequential-ids",
  description:
    "Renumber the eight issue-#2028 sovereign issuers to 900_019-900_026 by deterministic _id and create the corporations_sequentialId unique index",
  idempotent: true,
  execute: repairDuplicateCorporationSequentialIds,
};
