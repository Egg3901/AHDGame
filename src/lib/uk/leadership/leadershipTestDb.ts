import { ObjectId, type Db } from "mongodb";

/**
 * Minimal in-memory Mongo stand-in for UK leadership tests. Supports the
 * operators the leadership commands use: equality / $in / $exists / $ne /
 * $lte / $gte filters (including dotted paths), $set / $setOnInsert / $push /
 * $pull / $inc / $unset updates (dotted), findOneAndUpdate with
 * returnDocument "after", and the vote-tally aggregation-pipeline update
 * emitted by buildEmbeddedVoteTallyUpdate ($getField / $ifNull /
 * $mergeObjects / $add / $cond / $eq only — anything else throws so a
 * divergence surfaces loudly instead of silently passing).
 */

type Doc = Record<string, unknown>;

function getPath(doc: Doc, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = doc;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Doc)[part];
  }
  return cur;
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Doc = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cur[part] == null || typeof cur[part] !== "object") cur[part] = {};
    cur = cur[part] as Doc;
  }
  cur[parts[parts.length - 1]] = value;
}

function unsetPath(doc: Doc, path: string): void {
  const parts = path.split(".");
  let cur: Doc = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cur[part] == null || typeof cur[part] !== "object") return;
    cur = cur[part] as Doc;
  }
  delete cur[parts[parts.length - 1]];
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function matches(doc: Doc, query: Doc): boolean {
  for (const [key, cond] of Object.entries(query)) {
    const docVal = getPath(doc, key);
    if (
      cond != null &&
      typeof cond === "object" &&
      !(cond instanceof ObjectId) &&
      !(cond instanceof Date) &&
      !Array.isArray(cond)
    ) {
      const ops = cond as Record<string, unknown>;
      for (const [op, arg] of Object.entries(ops)) {
        if (op === "$in") {
          const arr = arg as unknown[];
          if (!arr.some((v) => valuesEqual(docVal, v))) return false;
        } else if (op === "$exists") {
          if ((docVal !== undefined) !== (arg as boolean)) return false;
        } else if (op === "$ne") {
          if (valuesEqual(docVal, arg)) return false;
        } else if (op === "$lte") {
          if (!((docVal as number) <= (arg as number))) return false;
        } else if (op === "$gte") {
          if (!((docVal as number) >= (arg as number))) return false;
        } else {
          throw new Error(`fakeDb: unsupported query operator ${op}`);
        }
      }
    } else if (!valuesEqual(docVal, cond)) {
      return false;
    }
  }
  return true;
}

/** Evaluate the vote-tally pipeline expression subset. */
function evalExpr(expr: unknown, doc: Doc): unknown {
  if (expr == null || typeof expr !== "object" || Array.isArray(expr)) {
    if (typeof expr === "string" && expr.startsWith("$")) return getPath(doc, expr.slice(1));
    return expr;
  }
  const obj = expr as Record<string, unknown>;
  if ("$ifNull" in obj) {
    const [a, b] = obj.$ifNull as [unknown, unknown];
    const va = evalExpr(a, doc);
    return va == null ? evalExpr(b, doc) : va;
  }
  if ("$getField" in obj) {
    const { field, input } = obj.$getField as { field: string; input: unknown };
    const target = evalExpr(input, doc) as Doc;
    return target?.[field];
  }
  if ("$mergeObjects" in obj) {
    const out: Doc = {};
    for (const part of obj.$mergeObjects as unknown[]) {
      Object.assign(out, evalExpr(part, doc) as Doc);
    }
    return out;
  }
  if ("$add" in obj) {
    return (obj.$add as unknown[]).reduce<number>(
      (sum, part) => sum + (evalExpr(part, doc) as number),
      0
    );
  }
  if ("$cond" in obj) {
    const [cond, yes, no] = obj.$cond as [unknown, unknown, unknown];
    return evalExpr(cond, doc) ? evalExpr(yes, doc) : evalExpr(no, doc);
  }
  if ("$eq" in obj) {
    const [a, b] = obj.$eq as [unknown, unknown];
    return valuesEqual(evalExpr(a, doc), evalExpr(b, doc));
  }
  throw new Error(`fakeDb: unsupported pipeline expression ${JSON.stringify(obj).slice(0, 80)}`);
}

function applyUpdate(doc: Doc, update: Doc): void {
  for (const [op, arg] of Object.entries(update)) {
    // $setOnInsert is a no-op when the filter matched (server semantics).
    if (op === "$setOnInsert") continue;
    const fields = arg as Record<string, unknown>;
    if (op === "$set") {
      for (const [path, value] of Object.entries(fields)) setPath(doc, path, value);
    } else if (op === "$unset") {
      for (const path of Object.keys(fields)) unsetPath(doc, path);
    } else if (op === "$inc") {
      for (const [path, value] of Object.entries(fields)) {
        setPath(doc, path, ((getPath(doc, path) as number) ?? 0) + (value as number));
      }
    } else if (op === "$push") {
      for (const [path, value] of Object.entries(fields)) {
        const arr = getPath(doc, path) as unknown[];
        if (!Array.isArray(arr)) throw new Error(`fakeDb: $push target ${path} is not an array`);
        arr.push(value);
      }
    } else if (op === "$pull") {
      for (const [path, cond] of Object.entries(fields)) {
        const arr = getPath(doc, path) as Doc[];
        if (!Array.isArray(arr)) throw new Error(`fakeDb: $pull target ${path} is not an array`);
        const kept = arr.filter((item) => !matches(item, cond as Doc));
        setPath(doc, path, kept);
      }
    } else {
      throw new Error(`fakeDb: unsupported update operator ${op}`);
    }
  }
}

function applyPipeline(doc: Doc, pipeline: Doc[]): void {
  for (const stage of pipeline) {
    if (!("$set" in stage)) throw new Error("fakeDb: only $set pipeline stages are supported");
    const sets = (stage as { $set: Record<string, unknown> }).$set;
    // Evaluate against a snapshot so sibling fields read pre-stage values,
    // matching server $set semantics within a single stage.
    const snapshot: Doc = JSON.parse(
      JSON.stringify(doc, (_k, v) => (v instanceof ObjectId ? { $__oid: v.toString() } : v))
    );
    const revive = (v: unknown): unknown => {
      if (v != null && typeof v === "object" && !Array.isArray(v) && "$__oid" in (v as Doc)) {
        return new ObjectId((v as Doc).$__oid as string);
      }
      return v;
    };
    const snap: Doc = {};
    for (const [k, v] of Object.entries(snapshot)) snap[k] = revive(v);
    for (const [path, expr] of Object.entries(sets)) {
      setPath(doc, path, expr instanceof Date ? expr : evalExpr(expr, snap));
    }
  }
}

export interface FakeLeadershipSeed {
  [collection: string]: Doc[];
}

export function createFakeLeadershipDb(seed: FakeLeadershipSeed = {}): Db {
  const collections: Record<string, Doc[]> = {};
  for (const [name, docs] of Object.entries(seed)) {
    collections[name] = docs.map((d) => ({ ...d }));
  }
  const docsOf = (name: string): Doc[] => (collections[name] ??= []);

  const makeCursor = (rows: Doc[]) => {
    const cursor = {
      toArray: async () => rows.map((d) => ({ ...d })),
      sort: () => cursor,
      limit: () => cursor,
      skip: () => cursor,
      project: () => cursor,
    };
    return cursor;
  };

  const makeCollection = (name: string) => ({
    find: (query: Doc = {}) => makeCursor(docsOf(name).filter((d) => matches(d, query))),
    findOne: async (query: Doc = {}) => docsOf(name).find((d) => matches(d, query)) ?? null,
    insertOne: async (doc: Doc) => {
      docsOf(name).push({ ...doc });
      return { insertedId: doc._id };
    },
    updateOne: async (query: Doc, update: Doc | Doc[], _opts?: unknown) => {
      const doc = docsOf(name).find((d) => matches(d, query));
      if (!doc) {
        const opts = _opts as { upsert?: boolean } | undefined;
        if (opts?.upsert && !Array.isArray(update)) {
          const created: Doc = {};
          for (const [k, v] of Object.entries(query)) {
            if (typeof v !== "object" || v instanceof ObjectId || v instanceof Date)
              setPath(created, k, v);
          }
          const setOnInsert = (update as Doc).$setOnInsert as Doc | undefined;
          if (setOnInsert) {
            for (const [path, value] of Object.entries(setOnInsert)) setPath(created, path, value);
          }
          const rest = { ...(update as Doc) };
          delete rest.$setOnInsert;
          applyUpdate(created, rest);
          docsOf(name).push(created);
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
        }
        return { matchedCount: 0, modifiedCount: 0 };
      }
      if (Array.isArray(update)) applyPipeline(doc, update);
      else applyUpdate(doc, update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    findOneAndUpdate: async (query: Doc, update: Doc, opts?: { returnDocument?: string }) => {
      const doc = docsOf(name).find((d) => matches(d, query));
      if (!doc) return null;
      applyUpdate(doc, update);
      return opts?.returnDocument === "after" ? { ...doc } : { ...doc };
    },
    deleteOne: async (query: Doc) => {
      const idx = docsOf(name).findIndex((d) => matches(d, query));
      if (idx < 0) return { deletedCount: 0 };
      docsOf(name).splice(idx, 1);
      return { deletedCount: 1 };
    },
    countDocuments: async (query: Doc = {}) => docsOf(name).filter((d) => matches(d, query)).length,
  });

  return { collection: (name: string) => makeCollection(name) } as unknown as Db;
}
