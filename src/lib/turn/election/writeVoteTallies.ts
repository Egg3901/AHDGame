/**
 * General-election ballot batches preserve each tally's counted-turn receipt.
 * writeVoteTallies refuses stale ranked-ballot batches so the turn can retry.
 */
import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { ElectionVoteTally } from "@/lib/db/types";
import { logger } from "@/lib/observability/logger";

export async function writeVoteTallies(
  db: Db,
  writes: AnyBulkWriteOperation<ElectionVoteTally>[],
  hasPrStv: boolean
): Promise<void> {
  if (writes.length === 0) return;
  try {
    const result = await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .bulkWrite(writes, { ordered: false });
    if (hasPrStv && result.matchedCount !== writes.length)
      throw new Error("PR-STV ballot batch lost a tally revision; retry the turn");
  } catch (err) {
    logger.error("Turn", `Error writing ${writes.length} election vote tallies`, err);
    if (hasPrStv) throw err;
  }
}
