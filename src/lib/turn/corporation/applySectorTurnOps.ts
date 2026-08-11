import type { SectorBuildOrder } from "@/lib/db/types";
import type { SectorUpdateOp } from "./types";

/**
 * Apply the sector ops a turn emitted to a plain document, the way Mongo's
 * ordered `bulkWrite` would.
 *
 * C4: the turn no longer persists `buildQueue` with a whole-array `$set` — it
 * emits the delta it owns (`$pull` of the orders that landed, `$inc` of the CIP
 * they released, and a `$push` for the flip-turn growth credit). A test can
 * therefore no longer read the post-turn queue off `$set`, and asserting on the
 * raw ops would pin the encoding rather than the behaviour.
 *
 * This is a deliberately tiny interpreter of exactly the operators the turn
 * uses. It is also what makes the race tests meaningful: a COMMAND write can be
 * applied to the same document part-way through, which is precisely the
 * interleaving that used to lose a player's charged build order.
 *
 * Test-support only — nothing in the engine calls it.
 */
export function applySectorTurnOps(
  doc: Record<string, unknown>,
  ops: readonly SectorUpdateOp[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...doc,
    buildQueue: Array.isArray(doc.buildQueue) ? [...(doc.buildQueue as SectorBuildOrder[])] : [],
  };
  for (const op of ops) {
    const u = op.updateOne.update;
    if (u.$set) Object.assign(out, u.$set);
    const pull = u.$pull?.buildQueue as { onlineTurn?: { $lte?: number } } | undefined;
    const lte = pull?.onlineTurn?.$lte;
    if (lte != null) {
      out.buildQueue = (out.buildQueue as SectorBuildOrder[]).filter((o) => !(o.onlineTurn <= lte));
    }
    if (u.$inc) {
      for (const [key, delta] of Object.entries(u.$inc)) {
        out[key] = ((out[key] as number) ?? 0) + delta;
      }
    }
    const pushed = u.$push?.buildQueue as SectorBuildOrder | undefined;
    if (pushed) {
      out.buildQueue = [...(out.buildQueue as SectorBuildOrder[]), pushed];
    }
  }
  return out;
}
