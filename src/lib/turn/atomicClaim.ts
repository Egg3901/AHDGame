import type { Db, Document, Filter, ObjectId, UpdateFilter } from "mongodb";

/**
 * Atomically claim a document's state transition.
 *
 * Issues a single guarded `updateOne(filter, update)` and returns `true` only
 * when THIS call matched the pre-state and flipped it. Callers gate their
 * non-idempotent side effects (Discord posts, treasury/legislation effects) on
 * the return value, so two concurrent invocations — a turn phase racing a
 * real-time action route, or two containers overlapping during a rolling
 * deploy — can never both fire the side effect.
 *
 * The `filter` MUST include the pre-state field(s) the `update` changes (e.g.
 * `status: "voting"`). MongoDB applies concurrent `updateOne`s serially, so the
 * first caller flips the doc out of the pre-state and every later caller's
 * filter matches zero documents — `matchedCount === 1` is the unique winner.
 */
export async function claimStatusTransition(
  db: Db,
  collectionName: string,
  filter: { _id: ObjectId | string } & Document,
  update: UpdateFilter<Document>
): Promise<boolean> {
  // Boundary cast: this helper is deliberately schema-agnostic (collection
  // name is a runtime string) and several claimed collections use string
  // `_id`s (e.g. "current", leadership role keys), which the driver's
  // Filter<Document> forbids. The parameter type above still requires an
  // explicit `_id` so every claim stays keyed to a single document.
  const res = await db.collection(collectionName).updateOne(filter as Filter<Document>, update);
  return res.matchedCount === 1;
}
