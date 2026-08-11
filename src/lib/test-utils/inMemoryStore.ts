import type { Db } from "mongodb";

/**
 * A compact in-memory Mongo-like store for migration tests that need to read
 * back state the repo's spy-based `MockDb` can't persist. Supports the subset of
 * operators the secession/transfer migrations use ($in, $ne, dot-path $set).
 */
export type Doc = Record<string, unknown>;

/**
 * Extra operators, OFF by default.
 *
 * The base matcher silently ignores any operator it does not know: an unknown
 * `{ field: { $exists: false } }` falls through to an object identity compare
 * and never matches. Several election-entry suites now depend on that leniency,
 * so honouring `$exists` for everyone changes their behaviour. Opt in with
 * `makeInMemoryStore(seed, { strictOperators: true })` when your code under test
 * actually issues these, and leave the default alone.
 */
export interface StoreOptions {
  strictOperators?: boolean;
}

function matches(doc: Doc, filter: Doc, opts: StoreOptions = {}): boolean {
  for (const [k, v] of Object.entries(filter)) {
    if (opts.strictOperators && k === "$and") {
      if (!(v as Doc[]).every((sub) => matches(doc, sub, opts))) return false;
    } else if (opts.strictOperators && k === "$or") {
      if (!(v as Doc[]).some((sub) => matches(doc, sub, opts))) return false;
    } else if (opts.strictOperators && k === "$nor") {
      if ((v as Doc[]).some((sub) => matches(doc, sub, opts))) return false;
    } else if (v && typeof v === "object" && "$in" in (v as object)) {
      if (!(v as { $in: unknown[] }).$in.includes(doc[k])) return false;
    } else if (v && typeof v === "object" && "$ne" in (v as object)) {
      if (doc[k] === (v as { $ne: unknown }).$ne) return false;
    } else if (opts.strictOperators && v && typeof v === "object" && "$nin" in (v as object)) {
      if ((v as { $nin: unknown[] }).$nin.includes(doc[k])) return false;
    } else if (opts.strictOperators && v && typeof v === "object" && "$exists" in (v as object)) {
      const present = k in doc && doc[k] !== undefined;
      if (present !== (v as { $exists: boolean }).$exists) return false;
    } else if (opts.strictOperators && v && typeof v === "object" && "$gt" in (v as object)) {
      if (!(typeof doc[k] === "number" && doc[k] > (v as { $gt: number }).$gt)) return false;
    } else if (doc[k] !== v) {
      return false;
    }
  }
  return true;
}

function applySet(doc: Doc, set: Doc): void {
  for (const [k, v] of Object.entries(set)) {
    if (k.includes(".")) {
      const parts = k.split(".");
      let cur = doc;
      for (let i = 0; i < parts.length - 1; i++) cur = (cur[parts[i]] ??= {}) as Doc;
      cur[parts[parts.length - 1]] = v;
    } else {
      doc[k] = v;
    }
  }
}

export interface InMemoryStore {
  db: Db;
  cols: Record<string, Doc[]>;
}

/** `makeInMemoryStore` with `$exists`, `$nin` and `$gt` honoured. See StoreOptions. */
export function makeStrictInMemoryStore(seed: Record<string, Doc[]> = {}): InMemoryStore {
  return makeInMemoryStore(seed, { strictOperators: true });
}

export function makeInMemoryStore(
  seed: Record<string, Doc[]> = {},
  options: StoreOptions = {}
): InMemoryStore {
  const cols: Record<string, Doc[]> = {};
  for (const [name, docs] of Object.entries(seed)) cols[name] = docs.map((d) => structuredClone(d));
  const col = (name: string) => (cols[name] ??= []);

  const collection = (name: string) => ({
    find: (filter: Doc = {}) => ({
      sort: () => collection(name).find(filter),
      limit: () => collection(name).find(filter),
      skip: () => collection(name).find(filter),
      project: () => collection(name).find(filter),
      toArray: async () => col(name).filter((d) => matches(d, filter, options)),
      // `find().sort().limit(1).next()` is the idiomatic single-most-recent
      // query. Without it the chain throws and the caller reports a generic
      // failure that names neither the method nor the mock.
      next: async () => col(name).find((d) => matches(d, filter, options)) ?? null,
    }),
    findOne: async (filter: Doc = {}) => col(name).find((d) => matches(d, filter, options)) ?? null,
    insertOne: async (doc: Doc) => {
      col(name).push(doc);
      return { insertedId: doc._id };
    },
    insertMany: async (docs: Doc[]) => {
      for (const d of docs) col(name).push(d);
      return { insertedIds: {} };
    },
    updateOne: async (filter: Doc, update: Doc, opts?: { upsert?: boolean }) => {
      const hit = col(name).find((d) => matches(d, filter, options));
      if (hit) {
        if (update.$set) applySet(hit, update.$set as Doc);
        if (update.$unset) for (const k of Object.keys(update.$unset as Doc)) delete hit[k];
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (opts?.upsert) {
        const doc: Doc = { ...(filter._id != null ? { _id: filter._id } : {}) };
        if (update.$set) applySet(doc, update.$set as Doc);
        col(name).push(doc);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    },
    updateMany: async (filter: Doc, update: Doc) => {
      let n = 0;
      for (const d of col(name))
        if (matches(d, filter, options)) {
          if (update.$set) applySet(d, update.$set as Doc);
          if (update.$unset) for (const k of Object.keys(update.$unset as Doc)) delete d[k];
          n++;
        }
      return { matchedCount: n, modifiedCount: n };
    },
    deleteOne: async (filter: Doc) => {
      const i = col(name).findIndex((d) => matches(d, filter, options));
      if (i >= 0) {
        col(name).splice(i, 1);
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    },
    deleteMany: async (filter: Doc) => {
      const before = col(name).length;
      cols[name] = col(name).filter((d) => !matches(d, filter, options));
      return { deletedCount: before - cols[name].length };
    },
    countDocuments: async (filter: Doc = {}) =>
      col(name).filter((d) => matches(d, filter, options)).length,
    replaceOne: async (filter: Doc, doc: Doc, opts?: { upsert?: boolean }) => {
      const i = col(name).findIndex((d) => matches(d, filter, options));
      if (i >= 0) {
        col(name)[i] = structuredClone(doc);
        return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
      }
      if (opts?.upsert) {
        col(name).push(structuredClone(doc));
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    },
    createIndex: async () => "index",
  });

  return { db: { collection } as unknown as Db, cols };
}
