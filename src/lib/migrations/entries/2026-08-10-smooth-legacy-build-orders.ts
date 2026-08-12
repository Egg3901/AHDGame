import type { Db } from "mongodb";
import type { Migration, MigrationContext, MigrationResult } from "../types";

/**
 * Make already-placed plant build orders deliver progressively.
 *
 * Smooth (per-turn) capacity delivery shipped gated on a per-order `smooth`
 * flag, so only orders placed AFTER the deploy ramp; orders already in flight
 * kept all-at-once landing (deliberately — see buildDelivery.ts). This converts
 * those grandfathered orders so players see progressive delivery on builds they
 * placed before the feature landed.
 *
 * Why `startTurn` is reset to the current turn, not left alone: delivery is a
 * stateless ramp from `startTurn`. Flipping `smooth` on an order that is already
 * part-way through its window would only deliver the REMAINING fraction and
 * silently lose the elapsed, already-paid capacity. Re-anchoring `startTurn` to
 * now makes the order ramp its FULL `unitsOrdered` linearly over the remaining
 * window and still finish on its original `onlineTurn`. Nothing is lost; if
 * anything the player receives capacity slightly earlier than the old lump.
 *
 * Only orders still under construction (`onlineTurn > currentTurn`) and not
 * already smooth are touched. `costPaidAnchor` is never modified, so no money
 * moves: CIP simply drains a slice per turn instead of all at landing, exactly
 * as it already does for post-deploy orders.
 *
 * World-aware: reads the world's live `currentTurn` at run time, so it is
 * correct whenever it runs and on whichever world it runs against.
 */
async function run(db: Db, ctx: MigrationContext): Promise<MigrationResult> {
  // Keyed by the string "current"; see the note in the 1953 heal migration.
  const gs = await db
    .collection<{ _id: string; currentTurn?: number }>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
  const currentTurn = gs?.currentTurn;
  if (typeof currentTurn !== "number" || !Number.isFinite(currentTurn)) {
    throw new Error("smooth-legacy-build-orders: gameState.currentTurn is missing or not a number");
  }

  const sectors = db.collection("corporateSectors");
  // A sector holding at least one grandfathered (non-smooth) order still under
  // construction. `$ne: true` matches both "smooth absent" and "smooth false".
  const filter = {
    buildQueue: { $elemMatch: { smooth: { $ne: true }, onlineTurn: { $gt: currentTurn } } },
  } as const;

  const matched = await sectors.countDocuments(filter);

  if (ctx.dryRun) {
    return {
      documentsScanned: matched,
      notes: [
        `dry run: would smooth legacy in-flight build orders in ${matched} sectors at turn ${currentTurn}`,
      ],
    };
  }

  const res = await sectors.updateMany(
    filter,
    {
      $set: {
        // Positional-all-matching update: only the elements the arrayFilter
        // selects (legacy + still building) are rewritten; already-smooth and
        // already-landed orders in the same queue are untouched.
        "buildQueue.$[o].smooth": true,
        "buildQueue.$[o].startTurn": currentTurn,
      },
    },
    {
      arrayFilters: [{ "o.smooth": { $ne: true }, "o.onlineTurn": { $gt: currentTurn } }],
    }
  );

  return {
    documentsScanned: matched,
    documentsUpdated: res.modifiedCount,
    notes: [`smoothed legacy in-flight build orders, re-anchored startTurn to turn ${currentTurn}`],
  };
}

export const migration: Migration = {
  id: "2026-08-10-smooth-legacy-build-orders",
  description:
    "Convert grandfathered (pre-smooth) in-flight plant build orders to progressive per-turn delivery, re-anchoring startTurn to the current turn so full ordered capacity is delivered over the remaining window.",
  idempotent: true,
  execute: run,
};
