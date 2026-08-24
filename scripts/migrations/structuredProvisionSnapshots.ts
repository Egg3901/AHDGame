/**
 * Migration — rewrite combined provision snapshots into structured name +
 * explanation fields.
 *
 * The old `formatPolicyOptionLabel` stored ONE combined "Name: explanation"
 * string, and dropped `option.name` entirely whenever the explanation already
 * contained ": " (33 of the 2502 seeded options). Bill history therefore showed
 * a fragment of the explanation where the option's title should be.
 *
 * This re-resolves each provision from its PERSISTED option ids —
 * `policyOptionId` for the proposal, `currentPolicyOptionIdSnapshot` for the
 * current law — so nothing is reconstructed from history or guessed at.
 *
 * Provisions with no persisted id are left untouched: the read path splits their
 * legacy string and renders them exactly as before.
 *
 * Idempotent: a provision already carrying the correct structured pair is
 * skipped, so a second run reports zero updates.
 *
 * Usage:
 *   npx tsx scripts/migrations/structuredProvisionSnapshots.ts --dry-run
 *   npx tsx scripts/migrations/structuredProvisionSnapshots.ts --apply
 */

import type { Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";
import type { LegislationType } from "../../src/lib/db/types/legislation";
import { canonicalizeLegislationTypeId } from "../../src/lib/legislationTypeAliases";
import { resolveOptionLabel } from "../../src/lib/legislature/provisionEnrichment/optionLabel";

const COLLECTIONS = ["bills", "stateBills"] as const;

export interface MigrationResult {
  /** Policy provisions examined (subsidy rows are not policy provisions). */
  scanned: number;
  /** Provisions whose stored snapshot differed from the re-resolved one. */
  updated: number;
  /** Provisions with no resolvable option id, left exactly as they were. */
  skipped: number;
}

type ProvisionDoc = Record<string, unknown>;

/**
 * An allowlist, not a denylist. `db/types/legislation.isPolicyProvision` names
 * the types that are NOT policy provisions, which means a newly added type is
 * treated as one until someone extends the list. A migration walking raw
 * documents must refuse anything it does not recognise instead.
 */
function isPolicyProvision(provision: ProvisionDoc): boolean {
  const type = provision.type;
  if (type !== undefined && type !== "policy") return false;
  return typeof provision.legislationTypeId === "string";
}

export async function migrateProvisionSnapshots(
  db: Db,
  opts: { dryRun: boolean }
): Promise<MigrationResult> {
  const legislationTypes = await db
    .collection<LegislationType>("legislationTypes")
    .find({})
    .toArray();
  const byId = new Map<string, LegislationType>();
  for (const lt of legislationTypes) {
    const key = canonicalizeLegislationTypeId(lt._id);
    if (!key) continue;
    if (!byId.has(key) || lt._id === key) byId.set(key, lt);
  }

  const result: MigrationResult = { scanned: 0, updated: 0, skipped: 0 };

  for (const collection of COLLECTIONS) {
    // Streamed, and projected to just the provisions. Loading whole bill
    // documents would pull fullText and the vote maps along with them, which on
    // a live database is a large and needless memory spike.
    const cursor = db
      .collection(collection)
      .find({ provisions: { $exists: true, $ne: [] } }, { projection: { provisions: 1 } });

    for await (const doc of cursor) {
      const provisions = ((doc as { provisions?: ProvisionDoc[] }).provisions ??
        []) as ProvisionDoc[];
      const set: Record<string, string> = {};

      provisions.forEach((provision, index) => {
        if (!isPolicyProvision(provision)) return;
        result.scanned++;

        const key = canonicalizeLegislationTypeId(provision.legislationTypeId as string);
        const lt = key ? byId.get(key) : undefined;
        if (!lt?.policyOptions?.length) {
          result.skipped++;
          return;
        }

        const proposedId = provision.policyOptionId;
        const proposedOption =
          typeof proposedId === "string"
            ? lt.policyOptions.find((option) => option.id === proposedId)
            : undefined;

        const currentId = provision.currentPolicyOptionIdSnapshot;
        const currentOption =
          typeof currentId === "string"
            ? lt.policyOptions.find((option) => option.id === currentId)
            : undefined;

        // Nothing identifies which option this provision refers to, so there is
        // nothing to re-resolve. The legacy string stays and the read path
        // splits it.
        if (!proposedOption && !currentOption) {
          result.skipped++;
          return;
        }

        let changed = false;

        if (proposedOption) {
          const label = resolveOptionLabel(proposedOption);
          if (provision.policyOptionNameSnapshot !== label.name) {
            set[`provisions.${index}.policyOptionNameSnapshot`] = label.name;
            changed = true;
          }
          if (
            label.explanation &&
            provision.policyOptionExplanationSnapshot !== label.explanation
          ) {
            set[`provisions.${index}.policyOptionExplanationSnapshot`] = label.explanation;
            changed = true;
          }
        }

        if (currentOption) {
          const label = resolveOptionLabel(currentOption);
          if (provision.currentPolicyOptionNameSnapshot !== label.name) {
            set[`provisions.${index}.currentPolicyOptionNameSnapshot`] = label.name;
            changed = true;
          }
          if (
            label.explanation &&
            provision.currentPolicyOptionExplanationSnapshot !== label.explanation
          ) {
            set[`provisions.${index}.currentPolicyOptionExplanationSnapshot`] = label.explanation;
            changed = true;
          }
        }

        if (changed) result.updated++;
      });

      if (Object.keys(set).length > 0 && !opts.dryRun) {
        await db.collection(collection).updateOne({ _id: doc._id }, { $set: set });
      }
    }
  }

  return result;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply;
  if (dryRun) {
    console.log("[dry-run] No writes will be made. Pass --apply to write.");
  }
  const db = await connectDb();
  try {
    const result = await migrateProvisionSnapshots(db, { dryRun });
    console.log(
      `${dryRun ? "[dry-run] " : ""}scanned=${result.scanned} updated=${result.updated} skipped=${result.skipped}`
    );
  } finally {
    await closeDb();
  }
}

if (process.argv[1]?.includes("structuredProvisionSnapshots")) {
  void main();
}
