import type { Db, ObjectId } from "mongodb";
import type { Suggestion } from "@/lib/db/types";
import { getSuggestionCommentsCollection } from "@/lib/db/collections/suggestionComments";
import { getSuggestionReadsCollection } from "@/lib/db/collections/suggestionReads";

export async function markSuggestionThreadRead(
  db: Db,
  userId: ObjectId,
  suggestionId: ObjectId
): Promise<void> {
  const coll = getSuggestionReadsCollection(db);
  const now = new Date();
  await coll.updateOne(
    { userId, suggestionId },
    { $set: { lastReadAt: now }, $setOnInsert: { userId, suggestionId } },
    { upsert: true }
  );
}

/** Load last-read timestamps for many suggestions for one viewer. */
export async function loadReadMapForSuggestions(
  db: Db,
  userId: ObjectId,
  suggestionIds: ObjectId[]
): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (suggestionIds.length === 0) return map;
  const coll = getSuggestionReadsCollection(db);
  const rows = await coll
    .find({ userId, suggestionId: { $in: suggestionIds } })
    .project({ suggestionId: 1, lastReadAt: 1 })
    .toArray();
  for (const r of rows) {
    map.set(r.suggestionId.toString(), r.lastReadAt);
  }
  return map;
}

export interface ViewerUnreadContext {
  userId: ObjectId;
  isAdmin: boolean;
}

/**
 * Count comments newer than last read per suggestion row.
 * — Authors & admins: if never read, all comments count as unread.
 * — Others: only after they have visited the thread (read row exists).
 *
 * Uses a single aggregation instead of one countDocuments per item to avoid N+1 queries.
 */
export async function computeUnreadCommentCounts(
  db: Db,
  viewer: ViewerUnreadContext | null,
  items: Suggestion[],
  readAtBySuggestionId: Map<string, Date>
): Promise<number[]> {
  if (!viewer || items.length === 0) return items.map(() => 0);

  const result: number[] = new Array(items.length).fill(0);

  // Separate items into those we can answer without a DB query vs those that need counting.
  const toQuery: { idx: number; suggestionId: ObjectId; readAt: Date }[] = [];

  for (let i = 0; i < items.length; i++) {
    const s = items[i];
    const readAt = readAtBySuggestionId.get(s._id.toString());
    const isAuthor = s.userId != null && s.userId.toString() === viewer.userId.toString();
    const eligible = viewer.isAdmin || isAuthor;

    if (!eligible) {
      if (readAt) toQuery.push({ idx: i, suggestionId: s._id, readAt });
      // else: never read + not eligible → 0 (default)
    } else {
      if (!readAt) {
        result[i] = s.commentCount ?? 0; // eligible + never read → all comments unread
      } else {
        toQuery.push({ idx: i, suggestionId: s._id, readAt });
      }
    }
  }

  if (toQuery.length === 0) return result;

  // One aggregation covers all suggestions. $switch injects each suggestion's cutoff date so
  // comments are filtered per-item without a separate roundtrip per suggestion.
  const commentColl = getSuggestionCommentsCollection(db);
  const aggResult = await commentColl
    .aggregate<{ _id: ObjectId; count: number }>([
      { $match: { suggestionId: { $in: toQuery.map((q) => q.suggestionId) } } },
      {
        $addFields: {
          _cutoff: {
            $switch: {
              branches: toQuery.map((q) => ({
                case: { $eq: ["$suggestionId", q.suggestionId] },
                then: q.readAt,
              })),
              default: null,
            },
          },
        },
      },
      { $match: { $expr: { $gt: ["$createdAt", "$_cutoff"] } } },
      { $group: { _id: "$suggestionId", count: { $sum: 1 } } },
    ])
    .toArray();

  const countMap = new Map(aggResult.map((r) => [r._id.toString(), r.count]));
  for (const { idx, suggestionId } of toQuery) {
    result[idx] = countMap.get(suggestionId.toString()) ?? 0;
  }

  return result;
}
