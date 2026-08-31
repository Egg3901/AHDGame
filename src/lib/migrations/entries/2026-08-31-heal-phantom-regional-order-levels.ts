import type { AnyBulkWriteOperation, Db, ObjectId } from "mongodb";
import type { Migration, MigrationResult } from "../types";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import type { GovernorExecutiveOrder } from "@/lib/db/types";
import { getLaw } from "@/lib/politicalLegislation/catalog";
import { projectLawToLegislationType } from "@/lib/politicalLegislation/project";
import {
  REGIONAL_DEFAULT_LEVEL,
  regionalDefaultLaws,
} from "@/lib/politicalLegislation/regionalDefaults";
import { LAW_COUNTRY_IDS } from "@/lib/politicalLegislation/types";

/**
 * Reset the regional levels an expired executive order invented.
 *
 * `issueOrder` resolved a missing prior policy to the ladder CENTRE, so an
 * order issued on a `both` law in a region that had never legislated it
 * recorded `policyOptionIndexBefore` as 2 (five-option ladder) or 3 (the legacy
 * 0-6 bounds `ladderBounds` returns when the type doc has no options), never
 * the region's real level 0. When the order expired,
 * `buildOrderRevertPolicyFields` restored that invented `before` — leaving the
 * region permanently holding a programme it never passed, which
 * `politicalMetricsDynamics` then reads into the regional supplement every turn
 * at REGIONAL_SUPPLEMENT_FACTOR × 12.5 points per level.
 *
 * Found on live: 208 orders on `both` laws, 158 of them against a region with
 * no prior row. 102 expiry-reverted rows sat above the default; 81 of those
 * traced to an order with no prior row and were reset (1 at level 1, 8 at 2,
 * 72 at 3). The other 21 reverted to a level the region really had held — the
 * per-row join below is what tells them apart, and a coarser join on
 * (region, law) had put the figure 20 too high.
 *
 * THE FINGERPRINT IS EXACT, not a guess from the level. `issueOrder` writes
 * `policyOptionIdBefore` only when a prior row existed:
 *
 *     ...(priorPolicy?.policyOptionId ? { policyOptionIdBefore: ... } : {})
 *
 * so an order missing that field is precisely one issued against a region with
 * no row. The reverted statePolicies row points back at its own order through
 * `enactedBy.id`, so the join is per-row rather than per (region, law) — a
 * region that has had several orders on the same law is resolved correctly.
 *
 * DELIBERATELY NARROW. Only `enactedBy.kind === "expiry"` rows are touched:
 * a `bill` row is a real enactment, and an `order` row is a live effect the
 * region is currently paying for. Neither is this bug's doing.
 *
 * The healed row is written to look exactly like the regional default the
 * backfill migration writes — level 0, and no `enactedBy`, because after the
 * correction nobody enacted it.
 */
async function healPhantomRegionalOrderLevels(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];
  const lawIds = LAW_COUNTRY_IDS.flatMap((cc) => regionalDefaultLaws(cc).map((law) => law.id));

  const rows = await db
    .collection<StatePolicy>("statePolicies")
    .find({
      scope: "state",
      legislationTypeId: { $in: lawIds },
      "enactedBy.kind": "expiry",
      policyOptionIndex: { $gt: REGIONAL_DEFAULT_LEVEL },
    })
    .project<{
      stateId: string;
      legislationTypeId: string;
      policyOptionIndex: number;
      enactedBy: { kind: string; id: ObjectId };
    }>({ stateId: 1, legislationTypeId: 1, policyOptionIndex: 1, enactedBy: 1 })
    .toArray();

  if (rows.length === 0) {
    notes.push("nothing to heal — no expiry-reverted rows above the region default");
    return { documentsScanned: 0, documentsUpdated: 0, notes };
  }

  const orders = await db
    .collection<GovernorExecutiveOrder>("governorExecutiveOrders")
    .find({ _id: { $in: rows.map((r) => r.enactedBy.id) } })
    .project<{ _id: ObjectId; policyOptionIdBefore?: string }>({ policyOptionIdBefore: 1 })
    .toArray();
  const hadNoPriorRow = new Set(
    orders.filter((o) => o.policyOptionIdBefore == null).map((o) => String(o._id))
  );

  const phantom = rows.filter((r) => hadNoPriorRow.has(String(r.enactedBy.id)));
  notes.push(
    `${rows.length} expiry-reverted row(s) above the default, ` +
      `${phantom.length} from an order with no prior row`
  );

  if (phantom.length === 0) {
    notes.push("nothing to heal — every revert target was a real prior level");
    return { documentsScanned: rows.length, documentsUpdated: 0, notes };
  }

  const byLevel = new Map<number, number>();
  for (const r of phantom)
    byLevel.set(r.policyOptionIndex, (byLevel.get(r.policyOptionIndex) ?? 0) + 1);
  notes.push(
    `levels being reset: ${[...byLevel]
      .sort((a, b) => a[0] - b[0])
      .map(([level, n]) => `${n}×level ${level}`)
      .join(", ")}`
  );

  if (dryRun) {
    notes.push(`dry run: no writes performed (${phantom.length} row(s) would be reset to level 0)`);
    return { documentsScanned: rows.length, notes };
  }

  const now = new Date();
  const ops: AnyBulkWriteOperation<StatePolicy>[] = [];
  for (const row of phantom) {
    const law = getLaw(row.legislationTypeId);
    // A row whose law has left the catalog is not this migration's to guess at.
    if (!law) continue;
    const option = projectLawToLegislationType(law).policyOptions![REGIONAL_DEFAULT_LEVEL];
    ops.push({
      updateOne: {
        filter: { stateId: row.stateId, legislationTypeId: row.legislationTypeId, scope: "state" },
        update: {
          $set: {
            policyOptionIndex: REGIONAL_DEFAULT_LEVEL,
            policyOptionId: option.id,
            economic: option.economic,
            social: option.social,
            effectDirection: option.effectDirection,
            updatedAt: now,
          },
          $unset: { enactedBy: "", enactedByBillId: "" },
        },
      },
    });
  }

  if (ops.length === 0) {
    notes.push("nothing to heal — every phantom row referenced a law no longer in the catalog");
    return { documentsScanned: rows.length, documentsUpdated: 0, notes };
  }

  const result = await db
    .collection<StatePolicy>("statePolicies")
    .bulkWrite(ops, { ordered: false });
  return {
    documentsScanned: rows.length,
    documentsUpdated: result.modifiedCount ?? 0,
    notes,
  };
}

export const migration: Migration = {
  id: "2026-08-31-heal-phantom-regional-order-levels",
  description:
    "Reset regional policy levels invented by an expired executive order that had no prior row to revert to, so a region stops supplying a regional supplement for a programme it never passed",
  idempotent: true,
  execute: (db, ctx) => healPhantomRegionalOrderLevels(db, ctx.dryRun),
};
