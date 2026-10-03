/**
 * Split one large bulkWrite into a few concurrent ordered bulkWrites that
 * touch disjoint documents.
 *
 * The corporation turn rewrites every live supply agreement and every sector
 * each turn. A single ordered bulkWrite sends those as back-to-back batches
 * that the server applies one after another; the documents do not depend on
 * each other, so the batches can be applied side by side instead.
 *
 * The final state is the same as one ordered bulkWrite because:
 * - every op is keyed by a plain `{ _id }` filter, and all ops for one `_id`
 *   land in the same partition in their original relative order, and each
 *   partition is itself an ordered bulkWrite; and
 * - an update/replace/delete keyed by `_id` reads and writes that one
 *   document only, so ops on different documents commute.
 * Anything else (inserts, filters on other fields, an `_id` operator query)
 * falls back to the single ordered bulkWrite this replaces.
 *
 * The one behavioural difference is on failure: an ordered bulkWrite stops at
 * the first failing op, while here the other partitions still run. Every
 * caller lets the error abort the turn either way.
 */

import { ObjectId, type AnyBulkWriteOperation, type Collection, type Document } from "mongodb";

/** Below this many ops one round of batches is already cheap. */
const MIN_OPS_TO_PARTITION = 2000;
const DEFAULT_PARTITIONS = 4;

function idKeyOf(op: AnyBulkWriteOperation<Document>): string | null {
  const body =
    "updateOne" in op
      ? op.updateOne
      : "replaceOne" in op
        ? op.replaceOne
        : "deleteOne" in op
          ? op.deleteOne
          : null;
  if (!body) return null;
  const filter = body.filter as Record<string, unknown> | undefined;
  if (!filter) return null;
  const keys = Object.keys(filter);
  if (keys.length !== 1 || keys[0] !== "_id") return null;
  const id = filter._id;
  if (id instanceof ObjectId) return `o:${id.toHexString()}`;
  if (typeof id === "string") return `s:${id}`;
  return null;
}

/**
 * Group ops into at most `partitions` lists such that all ops on one document
 * share a list and keep their original order. Returns null when an op cannot
 * be keyed by `_id`, meaning the caller must not split the write.
 */
export function partitionBulkOpsById<T extends Document>(
  ops: readonly AnyBulkWriteOperation<T>[],
  partitions: number
): AnyBulkWriteOperation<T>[][] | null {
  const keys: string[] = [];
  const firstSeen = new Map<string, number>();
  for (const op of ops) {
    const key = idKeyOf(op as AnyBulkWriteOperation<Document>);
    if (key === null) return null;
    keys.push(key);
    if (!firstSeen.has(key)) firstSeen.set(key, firstSeen.size);
  }
  const count = Math.max(1, Math.min(partitions, firstSeen.size));
  const groups: AnyBulkWriteOperation<T>[][] = Array.from({ length: count }, () => []);
  for (let index = 0; index < ops.length; index++) {
    // Contiguous ranges of documents, by first appearance.
    const group = Math.floor((firstSeen.get(keys[index]!)! * count) / firstSeen.size);
    groups[group]!.push(ops[index]!);
  }
  return groups;
}

export async function partitionedBulkWrite<T extends Document>(
  collection: Collection<T>,
  ops: AnyBulkWriteOperation<T>[],
  partitions: number = DEFAULT_PARTITIONS
): Promise<void> {
  if (ops.length === 0) return;
  const groups =
    ops.length >= MIN_OPS_TO_PARTITION && partitions > 1
      ? partitionBulkOpsById(ops, partitions)
      : null;
  if (!groups || groups.length <= 1) {
    await collection.bulkWrite(ops);
    return;
  }
  // allSettled, so a failure is not reported while sibling writes are still
  // in flight.
  const results = await Promise.allSettled(groups.map((group) => collection.bulkWrite(group)));
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw (failed as PromiseRejectedResult).reason;
}
