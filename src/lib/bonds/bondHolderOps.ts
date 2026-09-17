import type { ClientSession, Db, ObjectId } from "mongodb";
import type { Bond } from "@/lib/db/types";
import {
  applyKeyedUpdate,
  deriveMoneyFlowKey,
  type MoneyFlowLegOutcome,
  type MoneyFlowStep,
} from "@/lib/db/nonAtomicMoneyFlow";

export type BondHolderTarget =
  | { field: "characterId"; id: ObjectId }
  | { field: "imperialCharacterId"; id: ObjectId }
  | { field: "corporationId"; id: ObjectId }
  | { field: "fundId"; id: ObjectId }
  | { field: "nppId"; id: ObjectId };

/**
 * Atomically move bond units from public float to a holder entry on the bond doc.
 */
export async function reserveBondUnitsForHolder(
  db: Db,
  bondId: ObjectId,
  target: BondHolderTarget,
  units: number,
  now: Date,
  options?: { avgCostPerUnit?: number }
): Promise<boolean> {
  const holderSet: Record<string, unknown> = { updatedAt: now };
  if (options?.avgCostPerUnit !== undefined) {
    holderSet["holders.$.avgCostPerUnit"] = options.avgCostPerUnit;
  }

  const existingHolderResult = await db.collection<Bond>("bonds").updateOne(
    {
      _id: bondId,
      publicFloat: { $gte: units },
      [`holders.${target.field}`]: target.id,
    },
    {
      $inc: { "holders.$.units": units, publicFloat: -units },
      $set: holderSet,
    }
  );
  if (existingHolderResult.modifiedCount > 0) return true;

  const newHolder: Record<string, unknown> = {
    [target.field]: target.id,
    units,
  };
  if (options?.avgCostPerUnit !== undefined) {
    newHolder.avgCostPerUnit = options.avgCostPerUnit;
  }

  const pushResult = await db.collection<Bond>("bonds").updateOne(
    {
      _id: bondId,
      publicFloat: { $gte: units },
      holders: {
        $not: { $elemMatch: { [target.field]: target.id } },
      },
    },
    {
      $push: { holders: newHolder },
      $inc: { publicFloat: -units },
      $set: { updatedAt: now },
    }
  );
  if (pushResult.modifiedCount > 0) return true;

  const retryExistingHolderResult = await db.collection<Bond>("bonds").updateOne(
    {
      _id: bondId,
      publicFloat: { $gte: units },
      [`holders.${target.field}`]: target.id,
    },
    {
      $inc: { "holders.$.units": units, publicFloat: -units },
      $set: holderSet,
    }
  );

  return retryExistingHolderResult.modifiedCount > 0;
}

/**
 * Crash-safe variant of {@link reserveBondUnitsForHolder} for keyed money
 * flows (issue #1672). Same economics (existing-holder `$inc`, else push a
 * new holder row, one last retry of the `$inc` for a row that appeared
 * mid-flight), but every write carries the flow's idempotency key, so a
 * crashed-and-retried flow converges to exactly one reservation instead of
 * reserving twice.
 *
 * Convergence note: the `$inc` variant runs first, so a retry after the push
 * variant applied reports `already-applied` (the key is on the document) and
 * stops — the second reservation never happens. The legacy unkeyed
 * {@link reserveBondUnitsForHolder} is unchanged; the bond buy route and the
 * NPP purchase paths keep using it until their own tranche.
 */
export async function reserveBondUnitsForHolderKeyed(
  db: Db,
  key: string,
  bondId: ObjectId,
  target: BondHolderTarget,
  units: number,
  now: Date,
  options?: { avgCostPerUnit?: number; session?: ClientSession }
): Promise<MoneyFlowLegOutcome> {
  if (!Number.isInteger(units) || units <= 0) {
    throw new RangeError("Keyed bond reservation needs a positive integer unit count");
  }
  const sessionOpts = options?.session ? { session: options.session } : {};
  const holderPath = `holders.${target.field}`;
  const costSet =
    options?.avgCostPerUnit !== undefined
      ? { "holders.$.avgCostPerUnit": options.avgCostPerUnit }
      : {};
  // Kept as a closure (not a hoisted const) so the computed holder-path key
  // stays an inline filter literal, matching the Filter<Bond> shape the
  // legacy reservation already compiles against.
  const applyIncVariant = () =>
    applyKeyedUpdate(
      key,
      {
        collection: db.collection<Bond>("bonds"),
        filter: {
          _id: bondId,
          publicFloat: { $gte: units },
          [holderPath]: target.id,
        },
        update: {
          $inc: { "holders.$.units": units, publicFloat: -units },
          $set: { updatedAt: now, ...costSet },
        },
      },
      sessionOpts
    );

  let outcome = await applyIncVariant();
  if (outcome === "applied" || outcome === "already-applied") return outcome;

  const newHolder: Record<string, unknown> = {
    [target.field]: target.id,
    units,
  };
  if (options?.avgCostPerUnit !== undefined) {
    newHolder.avgCostPerUnit = options.avgCostPerUnit;
  }
  outcome = await applyKeyedUpdate(
    key,
    {
      collection: db.collection<Bond>("bonds"),
      filter: {
        _id: bondId,
        publicFloat: { $gte: units },
        holders: { $not: { $elemMatch: { [target.field]: target.id } } },
      },
      update: {
        $push: { holders: newHolder },
        $inc: { publicFloat: -units },
        $set: { updatedAt: now },
      },
    },
    sessionOpts
  );
  if (outcome === "applied" || outcome === "already-applied") return outcome;

  // A holder row raced in between the two variants: retry the `$inc` once,
  // mirroring the legacy triple attempt.
  return applyIncVariant();
}

/**
 * A keyed holder reservation as a revertible money-flow step. The inverse
 * returns the units to the float; it never carries a guard, so compensation
 * is never blocked. When the push variant applied, the revert leaves a
 * zero-unit holder row behind: empty rows match no claim guard and the sell
 * paths sweep them post-commit, so they are harmless.
 */
export function makeReserveBondUnitsStep(
  key: string,
  db: Db,
  bondId: ObjectId,
  target: BondHolderTarget,
  units: number,
  now: Date,
  options?: { avgCostPerUnit?: number }
): MoneyFlowStep {
  return {
    name: "holder-reserve",
    apply: (stepOpts) =>
      reserveBondUnitsForHolderKeyed(db, key, bondId, target, units, now, {
        ...options,
        ...(stepOpts?.session ? { session: stepOpts.session } : {}),
      }),
    revert: (stepOpts) =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(key, "compensate", "holder-reserve"),
        {
          collection: db.collection<Bond>("bonds"),
          filter: { _id: bondId, [`holders.${target.field}`]: target.id },
          update: {
            $inc: { "holders.$.units": -units, publicFloat: units },
            $set: { updatedAt: now },
          },
        },
        stepOpts ?? {}
      ),
  };
}
