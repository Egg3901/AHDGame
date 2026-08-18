/**
 * A small in-memory stand-in for the driver, for tests that need STATE.
 *
 * `mockDb` returns stubs and lets a test assert on the calls that were made.
 * That is the right tool for "did this code write the field it said it would",
 * and the wrong one for "does money still add up after five operations", which
 * is the question the banking conservation test has to answer. Asserting on
 * calls cannot catch a leak: every individual write looks correct, and the hole
 * is in the arithmetic between them.
 *
 * So this stores documents and applies updates for real. It implements the
 * subset of the query language the banking flows actually use, and throws on
 * anything it does not understand rather than silently matching nothing, which
 * is the failure mode that would make a conservation test pass while lying.
 */

import { ObjectId } from "mongodb";

type Doc = Record<string, unknown>;

function isPlainObject(value: unknown): value is Doc {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof ObjectId)
  );
}

const UNSAFE_PATH_PARTS = new Set(["__proto__", "prototype", "constructor"]);

function safePathParts(path: string): string[] {
  const parts = path.split(".");
  if (parts.some((part) => UNSAFE_PATH_PARTS.has(part))) {
    throw new Error(`inMemoryDb: unsafe document path "${path}"`);
  }
  return parts;
}

function getPath(doc: Doc, path: string): unknown {
  let cur: unknown = doc;
  for (const part of safePathParts(path)) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = safePathParts(path);
  let cur: Doc = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = cur[parts[i]];
    if (!isPlainObject(next)) cur[parts[i]] = {};
    cur = cur[parts[i]] as Doc;
  }
  cur[parts[parts.length - 1]] = value;
}

function unsetPath(doc: Doc, path: string): void {
  const parts = safePathParts(path);
  let cur: Doc = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = cur[parts[i]];
    if (!isPlainObject(next)) return;
    cur = next;
  }
  delete cur[parts[parts.length - 1]];
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  if (a instanceof ObjectId && typeof b === "string") return a.toString() === b;
  if (b instanceof ObjectId && typeof a === "string") return b.toString() === a;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (isPlainObject(condition)) {
    const keys = Object.keys(condition);
    if (keys.some((k) => k.startsWith("$"))) {
      return keys.every((op) => {
        const operand = condition[op];
        switch (op) {
          case "$eq":
            return sameValue(value, operand);
          case "$ne":
            return !sameValue(value, operand);
          case "$gte":
            return typeof value === "number" && value >= (operand as number);
          case "$gt":
            return typeof value === "number" && value > (operand as number);
          case "$lte":
            return typeof value === "number" && value <= (operand as number);
          case "$lt":
            return typeof value === "number" && value < (operand as number);
          case "$in":
            return (operand as unknown[]).some((o) => sameValue(value, o));
          case "$nin":
            return !(operand as unknown[]).some((o) => sameValue(value, o));
          case "$exists":
            return (value !== undefined) === Boolean(operand);
          default:
            throw new Error(`inMemoryDb: unsupported operator ${op}`);
        }
      });
    }
  }
  return sameValue(value, condition);
}

/** Tiny aggregation-expression evaluator, enough for the `$expr` guards. */
function evalExpr(expr: unknown, doc: Doc): unknown {
  if (typeof expr === "string" && expr.startsWith("$")) return getPath(doc, expr.slice(1));
  if (!isPlainObject(expr)) return expr;
  const [op, rawArgs] = Object.entries(expr)[0];
  const args = Array.isArray(rawArgs)
    ? rawArgs.map((a) => evalExpr(a, doc))
    : [evalExpr(rawArgs, doc)];
  switch (op) {
    case "$and":
      return args.every(Boolean);
    case "$or":
      return args.some(Boolean);
    case "$gte":
      return (args[0] as number) >= (args[1] as number);
    case "$gt":
      return (args[0] as number) > (args[1] as number);
    case "$lte":
      return (args[0] as number) <= (args[1] as number);
    case "$lt":
      return (args[0] as number) < (args[1] as number);
    case "$eq":
      return sameValue(args[0], args[1]);
    case "$add":
      return args.reduce((sum: number, a) => sum + ((a as number) ?? 0), 0);
    case "$subtract":
      return ((args[0] as number) ?? 0) - ((args[1] as number) ?? 0);
    case "$multiply":
      return args.reduce((prod: number, a) => prod * ((a as number) ?? 0), 1);
    case "$max":
      return Math.max(...args.map((a) => (a as number) ?? 0));
    case "$min":
      return Math.min(...args.map((a) => (a as number) ?? 0));
    case "$ifNull":
      return args[0] === undefined || args[0] === null ? args[1] : args[0];
    default:
      throw new Error(`inMemoryDb: unsupported expression operator ${op}`);
  }
}

function matchesFilter(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === "$or") return (condition as Doc[]).some((sub) => matchesFilter(doc, sub));
    if (key === "$and") return (condition as Doc[]).every((sub) => matchesFilter(doc, sub));
    if (key === "$nor") return !(condition as Doc[]).some((sub) => matchesFilter(doc, sub));
    if (key === "$expr") return Boolean(evalExpr(condition, doc));
    return matchesCondition(getPath(doc, key), condition);
  });
}

function applyUpdate(doc: Doc, update: Doc): void {
  for (const [op, fields] of Object.entries(update)) {
    if (op === "$set") {
      for (const [path, value] of Object.entries(fields as Doc)) setPath(doc, path, value);
    } else if (op === "$inc") {
      for (const [path, value] of Object.entries(fields as Doc)) {
        const current = getPath(doc, path);
        setPath(doc, path, (typeof current === "number" ? current : 0) + (value as number));
      }
    } else if (op === "$unset") {
      for (const path of Object.keys(fields as Doc)) unsetPath(doc, path);
    } else if (op === "$setOnInsert") {
      // Only meaningful on upsert, handled by the caller below.
    } else if (op === "$push") {
      for (const [path, value] of Object.entries(fields as Doc)) {
        const current = getPath(doc, path);
        setPath(doc, path, Array.isArray(current) ? [...current, value] : [value]);
      }
    } else {
      throw new Error(`inMemoryDb: unsupported update operator ${op}`);
    }
  }
}

/**
 * Deep copy that preserves ObjectId and Date.
 *
 * `structuredClone` turns an ObjectId into a plain object, which silently makes
 * every id filter miss. A test harness that quietly matches nothing is worse
 * than no harness, so this is hand-rolled.
 */
function clone<T>(value: T): T {
  if (value instanceof ObjectId) return new ObjectId(value.toHexString()) as unknown as T;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => clone(v)) as unknown as T;
  if (isPlainObject(value)) {
    const out: Doc = {};
    for (const [key, inner] of Object.entries(value)) out[key] = clone(inner);
    return out as unknown as T;
  }
  return value;
}

class InMemoryCollection {
  docs: Doc[] = [];

  constructor(public name: string) {}

  async findOne(filter: Doc = {}): Promise<Doc | null> {
    const found = this.docs.find((d) => matchesFilter(d, filter));
    return found ? clone(found) : null;
  }

  find(filter: Doc = {}) {
    let rows = this.docs.filter((d) => matchesFilter(d, filter)).map(clone);
    const cursor = {
      project: () => cursor,
      sort: () => cursor,
      limit: (n: number) => {
        rows = rows.slice(0, n);
        return cursor;
      },
      skip: () => cursor,
      batchSize: () => cursor,
      toArray: async () => rows,
    };
    return cursor;
  }

  async insertOne(doc: Doc): Promise<{ insertedId: unknown }> {
    const id = doc._id ?? new ObjectId();
    if (this.docs.some((d) => sameValue(d._id, id))) {
      const err = new Error("E11000 duplicate key error") as Error & { code: number };
      err.code = 11000;
      throw err;
    }
    this.docs.push(clone({ ...doc, _id: id }));
    return { insertedId: id };
  }

  async insertMany(docs: Doc[]): Promise<{ insertedCount: number }> {
    for (const doc of docs) await this.insertOne(doc);
    return { insertedCount: docs.length };
  }

  async updateOne(
    filter: Doc,
    update: Doc,
    options: { upsert?: boolean } = {}
  ): Promise<{ matchedCount: number; modifiedCount: number; upsertedCount: number }> {
    const target = this.docs.find((d) => matchesFilter(d, filter));
    if (!target) {
      if (options.upsert) {
        const seed: Doc = {};
        for (const [key, condition] of Object.entries(filter)) {
          if (!key.startsWith("$") && !isPlainObject(condition)) setPath(seed, key, condition);
        }
        applyUpdate(seed, {
          ...update,
          ...((update.$setOnInsert as Doc)
            ? { $set: { ...(update.$set as Doc), ...(update.$setOnInsert as Doc) } }
            : {}),
        });
        this.docs.push(seed);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }
    applyUpdate(target, update);
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
  }

  async updateMany(
    filter: Doc,
    update: Doc
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    const targets = this.docs.filter((d) => matchesFilter(d, filter));
    for (const doc of targets) applyUpdate(doc, update);
    return { matchedCount: targets.length, modifiedCount: targets.length };
  }

  async findOneAndUpdate(
    filter: Doc,
    update: Doc,
    options: { returnDocument?: "before" | "after" } = {}
  ): Promise<Doc | null> {
    const target = this.docs.find((d) => matchesFilter(d, filter));
    if (!target) return null;
    const before = clone(target);
    applyUpdate(target, update);
    return options.returnDocument === "before" ? before : clone(target);
  }

  async deleteOne(filter: Doc): Promise<{ deletedCount: number }> {
    const index = this.docs.findIndex((d) => matchesFilter(d, filter));
    if (index < 0) return { deletedCount: 0 };
    this.docs.splice(index, 1);
    return { deletedCount: 1 };
  }

  async deleteMany(filter: Doc): Promise<{ deletedCount: number }> {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matchesFilter(d, filter));
    return { deletedCount: before - this.docs.length };
  }

  async countDocuments(filter: Doc = {}): Promise<number> {
    return this.docs.filter((d) => matchesFilter(d, filter)).length;
  }

  async bulkWrite(ops: Doc[]): Promise<{ modifiedCount: number }> {
    let modified = 0;
    for (const op of ops) {
      if (op.updateOne) {
        const { filter, update, upsert } = op.updateOne as {
          filter: Doc;
          update: Doc;
          upsert?: boolean;
        };
        const res = await this.updateOne(filter, update, { upsert });
        modified += res.modifiedCount;
      } else if (op.insertOne) {
        await this.insertOne((op.insertOne as { document: Doc }).document);
      } else {
        throw new Error("inMemoryDb: unsupported bulk op");
      }
    }
    return { modifiedCount: modified };
  }

  aggregate() {
    throw new Error("inMemoryDb: aggregate is not implemented");
  }

  async createIndex(): Promise<string> {
    return "index";
  }
}

export class InMemoryDb {
  collections = new Map<string, InMemoryCollection>();

  collection(name: string): InMemoryCollection {
    let existing = this.collections.get(name);
    if (!existing) {
      existing = new InMemoryCollection(name);
      this.collections.set(name, existing);
    }
    return existing;
  }

  /** Seed documents into a collection. Returns the collection for chaining. */
  seed(name: string, docs: Doc[]): InMemoryCollection {
    const col = this.collection(name);
    col.docs.push(...docs.map(clone));
    return col;
  }
}

export function createInMemoryDb(): InMemoryDb {
  return new InMemoryDb();
}
