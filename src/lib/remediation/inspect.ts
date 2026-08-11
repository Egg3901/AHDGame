// Read-only database inspection.
//
// Half the reason people open mongosh against prod is not to change anything —
// it is to look. If looking requires a shell, the shell is already open when
// the urge to fix something arrives, and the next command is an unlogged
// updateMany. Giving the ledger a first-class read tool closes that door.
//
// Strictly read-only: find, count and distinct. No aggregation pipelines
// (`$merge` and `$out` write), no `$where`, no eval.

import type { Db, Filter, Document, Sort } from "mongodb";

export const MAX_QUERY_LIMIT = 200;

export interface QuerySpec {
  collection: string;
  filter?: Record<string, unknown>;
  projection?: Record<string, 0 | 1>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
}

export interface QueryResult {
  collection: string;
  matched: number;
  returned: number;
  docs: Document[];
  truncated: boolean;
}

/** `$where` and `$function` execute JavaScript server-side. Never accept them. */
function assertNoCodeExecution(filter: Record<string, unknown>): void {
  const serialized = JSON.stringify(filter ?? {});
  for (const banned of ["$where", "$function", "$accumulator", "$expr.$function"]) {
    if (serialized.includes(banned)) {
      throw new Error(`[remediation] "${banned}" is not permitted in a query filter`);
    }
  }
}

export async function runQuery(db: Db, spec: QuerySpec): Promise<QueryResult> {
  if (!spec.collection) throw new Error("[remediation] query needs a collection");
  const filter = (spec.filter ?? {}) as Filter<Document>;
  assertNoCodeExecution(spec.filter ?? {});

  const limit = Math.min(spec.limit ?? 25, MAX_QUERY_LIMIT);
  const matched = await db.collection(spec.collection).countDocuments(filter);

  let cursor = db.collection(spec.collection).find(filter).limit(limit);
  if (spec.projection) cursor = cursor.project(spec.projection) as typeof cursor;
  if (spec.sort) cursor = cursor.sort(spec.sort as Sort);
  const docs = await cursor.toArray();

  return {
    collection: spec.collection,
    matched,
    returned: docs.length,
    docs,
    truncated: matched > docs.length,
  };
}

export async function runCount(
  db: Db,
  collection: string,
  filter: Record<string, unknown> = {}
): Promise<number> {
  assertNoCodeExecution(filter);
  return db.collection(collection).countDocuments(filter as Filter<Document>);
}

export async function runDistinct(
  db: Db,
  collection: string,
  field: string,
  filter: Record<string, unknown> = {}
): Promise<unknown[]> {
  assertNoCodeExecution(filter);
  const values = await db.collection(collection).distinct(field, filter as Filter<Document>);
  return values.slice(0, MAX_QUERY_LIMIT);
}

/** Collection names plus document counts. The "what is even in here" call. */
export async function listCollections(db: Db): Promise<Array<{ name: string; count: number }>> {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system."))
    .sort();
  const rows = [];
  for (const name of names) {
    rows.push({ name, count: await db.collection(name).estimatedDocumentCount() });
  }
  return rows;
}
