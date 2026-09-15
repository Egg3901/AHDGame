/**
 * Stateful `electionCandidates` stub for withdrawal-path tests.
 *
 * Every withdrawal path marks its rows `withdrawn` and THEN archives the
 * matching campaigns, and `archiveCampaignsForCandidates` re-reads the rows
 * that are STILL `active` so it never archives a candidate who holds a second,
 * valid candidacy in the same race. A stub that replays one fixed array to
 * every `find()` would hand that re-read the very rows the caller just
 * withdrew, and the archive would look like a no-op in the test while working
 * fine in production.
 *
 * So this stub behaves like the collection: `updateMany` mutates the rows and
 * `find` honours a `status` filter.
 */
import type { ObjectId } from "mongodb";
import type { MockDb } from "./mockDb";

export interface StubbedCandidateRow extends Record<string, unknown> {
  _id: ObjectId;
  status?: string;
}

/**
 * Install the stub on `db`'s `electionCandidates` collection.
 *
 * @returns the live row array, so a test can assert on the mutated state.
 */
export function stubElectionCandidates(
  db: MockDb,
  docs: StubbedCandidateRow[]
): StubbedCandidateRow[] {
  const rows: StubbedCandidateRow[] = docs.map((d) => ({ ...d }));
  const collection = db.collection("electionCandidates");

  collection.find.mockImplementation((filter: Record<string, unknown> = {}) => {
    const wanted = filter.status;
    const matched = typeof wanted === "string" ? rows.filter((r) => r.status === wanted) : rows;
    const cursor = {
      project: () => cursor,
      sort: () => cursor,
      limit: () => cursor,
      toArray: async () => matched,
    };
    return cursor as never;
  });

  collection.updateMany.mockImplementation(
    async (filter: Record<string, unknown> = {}, update: Record<string, unknown> = {}) => {
      const ids = (filter._id as { $in?: ObjectId[] } | undefined)?.$in;
      const nextStatus = (update.$set as { status?: string } | undefined)?.status;
      let modifiedCount = 0;
      for (const row of rows) {
        if (ids && !ids.some((id) => id.toString() === row._id.toString())) continue;
        if (nextStatus) row.status = nextStatus;
        modifiedCount++;
      }
      return { modifiedCount } as never;
    }
  );

  return rows;
}
