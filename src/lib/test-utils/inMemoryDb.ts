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
type Update = Doc | Doc[];

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

/** A container a dotted path can descend into: a plain object, or an array by index. */
type Container = Doc | unknown[];

function isContainer(value: unknown): value is Container {
  return isPlainObject(value) || Array.isArray(value);
}

function readPart(cur: Container, part: string): unknown {
  if (Array.isArray(cur)) {
    return /^\d+$/.test(part) ? cur[Number(part)] : undefined;
  }
  return cur[part];
}

function writePart(cur: Container, part: string, value: unknown): void {
  if (Array.isArray(cur)) {
    if (!/^\d+$/.test(part)) {
      throw new Error(`inMemoryDb: cannot set non-numeric key "${part}" on an array`);
    }
    cur[Number(part)] = value;
    return;
  }
  cur[part] = value;
}

function getPath(doc: Doc, path: string): unknown {
  let cur: unknown = doc;
  for (const part of safePathParts(path)) {
    if (!isContainer(cur)) return undefined;
    cur = readPart(cur, part);
  }
  return cur;
}

/**
 * Mongo semantics for dotted paths: `a.0.b` descends into an array element,
 * as it does on the server. The first version replaced any array on the path
 * with an empty object, which silently corrupted a journal record's
 * projection list and made "projection 1 applied" vanish.
 */
function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = safePathParts(path);
  let cur: Container = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    let next = readPart(cur, parts[i]);
    if (!isContainer(next)) {
      next = /^\d+$/.test(parts[i + 1]) ? [] : {};
      writePart(cur, parts[i], next);
    }
    cur = next as Container;
  }
  writePart(cur, parts[parts.length - 1], value);
}

function unsetPath(doc: Doc, path: string): void {
  const parts = safePathParts(path);
  let cur: Container = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = readPart(cur, parts[i]);
    if (!isContainer(next)) return;
    cur = next;
  }
  if (Array.isArray(cur)) {
    if (/^\d+$/.test(parts[parts.length - 1])) cur[Number(parts[parts.length - 1])] = null;
    return;
  }
  delete cur[parts[parts.length - 1]];
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  if (a instanceof ObjectId && typeof b === "string") return a.toString() === b;
  if (b instanceof ObjectId && typeof a === "string") return b.toString() === a;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === b) return true;
  // Mongo matches an embedded document or array by VALUE, which is what a
  // compare-and-swap filter (`{ lineOfCredit: <the doc we read> }`) relies on.
  // Reference equality here silently matched nothing and made every such
  // guarded write look like a lost race.
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameValue(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => k in b && sameValue(a[k], (b as Doc)[k]));
  }
  return false;
}

/**
 * Equality the way Mongo reads it against an array field: the whole array, or
 * any one element. `{ tags: "x" }` matches `{ tags: ["x", "y"] }`, and
 * `{ tags: { $ne: "x" } }` does not.
 */
function equalsAny(value: unknown, operand: unknown): boolean {
  if (Array.isArray(value) && !Array.isArray(operand)) {
    return value.some((item) => sameValue(item, operand));
  }
  return sameValue(value, operand);
}

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (isPlainObject(condition)) {
    const keys = Object.keys(condition);
    if (keys.some((k) => k.startsWith("$"))) {
      return keys.every((op) => {
        const operand = condition[op];
        switch (op) {
          case "$eq":
            return equalsAny(value, operand);
          case "$ne":
            return !equalsAny(value, operand);
          case "$gte":
            return typeof value === "number" && value >= (operand as number);
          case "$gt":
            return typeof value === "number" && value > (operand as number);
          case "$lte":
            return typeof value === "number" && value <= (operand as number);
          case "$lt":
            return typeof value === "number" && value < (operand as number);
          case "$in":
            return (operand as unknown[]).some((o) => equalsAny(value, o));
          case "$elemMatch":
            return (
              Array.isArray(value) &&
              value.some((item) => isPlainObject(item) && matchesFilter(item, operand as Doc))
            );
          case "$nin":
            return !(operand as unknown[]).some((o) => equalsAny(value, o));
          case "$exists":
            return (value !== undefined) === Boolean(operand);
          case "$regex": {
            if (typeof value !== "string") return false;
            const flags = typeof condition["$options"] === "string" ? condition["$options"] : "";
            const source = operand instanceof RegExp ? operand.source : String(operand);
            return new RegExp(source, flags).test(value);
          }
          // A modifier consumed by $regex above, never a test in its own right.
          // Returning true here is correct rather than permissive: `every` still
          // requires the sibling $regex to match.
          case "$options":
            return true;
          case "$not":
            return !matchesCondition(value, operand);
          case "$type": {
            const aliases = Array.isArray(operand) ? operand : [operand];
            return aliases.some((alias) => {
              switch (alias) {
                case "number":
                case 1:
                case 16:
                case 18:
                  return typeof value === "number";
                case "string":
                case 2:
                  return typeof value === "string";
                case "bool":
                case 8:
                  return typeof value === "boolean";
                case "array":
                case 4:
                  return Array.isArray(value);
                case "date":
                case 9:
                  return value instanceof Date;
                case "null":
                case 10:
                  return value === null;
                case "object":
                case 3:
                  return isPlainObject(value);
                default:
                  throw new Error(`inMemoryDb: unsupported $type alias ${String(alias)}`);
              }
            });
          }
          default:
            throw new Error(`inMemoryDb: unsupported operator ${op}`);
        }
      });
    }
  }
  return equalsAny(value, condition);
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

/**
 * Every value a dotted path can resolve to, expanding arrays Mongo-style: a
 * segment against an array fans out to each element's traversal. Without this
 * a filter like `{ "shareholders.corporationId": id }` silently matched
 * nothing (the path dead-ended at the array), which is exactly the
 * match-nothing-while-lying failure mode this harness exists to prevent.
 */
function getPathValues(doc: Doc, path: string): unknown[] {
  let values: unknown[] = [doc];
  for (const part of safePathParts(path)) {
    const next: unknown[] = [];
    for (const value of values) {
      if (Array.isArray(value)) {
        if (/^\d+$/.test(part)) {
          const element = value[Number(part)];
          if (element !== undefined) next.push(element);
        } else {
          for (const element of value) {
            if (!isContainer(element)) continue;
            const resolved = readPart(element, part);
            if (resolved !== undefined) next.push(resolved);
          }
        }
      } else if (isContainer(value)) {
        const resolved = readPart(value, part);
        if (resolved !== undefined) next.push(resolved);
      }
    }
    values = next;
  }
  return values;
}

function matchesFilter(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === "$or") return (condition as Doc[]).some((sub) => matchesFilter(doc, sub));
    if (key === "$and") return (condition as Doc[]).every((sub) => matchesFilter(doc, sub));
    if (key === "$nor") return !(condition as Doc[]).some((sub) => matchesFilter(doc, sub));
    if (key === "$expr") return Boolean(evalExpr(condition, doc));
    // The unexpanded read first, so whole-array equality keeps its current
    // meaning; then every array-expanded traversal, so dotted paths into
    // arrays match when ANY element does.
    if (matchesCondition(getPath(doc, key), condition)) return true;
    return getPathValues(doc, key).some((value) => matchesCondition(value, condition));
  });
}

function applyUpdate(doc: Doc, update: Update): void {
  if (Array.isArray(update)) {
    for (const stage of update) {
      const entries = Object.entries(stage);
      if (entries.length !== 1 || entries[0][0] !== "$set") {
        throw new Error(`inMemoryDb: unsupported update pipeline stage ${entries[0]?.[0]}`);
      }
      for (const [path, expression] of Object.entries(entries[0][1] as Doc)) {
        setPath(doc, path, evalExpr(expression, doc));
      }
    }
    return;
  }
  for (const [op, fields] of Object.entries(update)) {
    if (op === "$set") {
      for (const [path, value] of Object.entries(fields as Doc)) setPath(doc, path, value);
    } else if (op === "$inc") {
      for (const [path, value] of Object.entries(fields as Doc)) {
        const current = getPath(doc, path);
        setPath(doc, path, (typeof current === "number" ? current : 0) + (value as number));
      }
    } else if (op === "$mul") {
      for (const [path, value] of Object.entries(fields as Doc)) {
        const current = getPath(doc, path);
        // Mongo treats a missing field as 0 for $mul, not as 1.
        setPath(doc, path, (typeof current === "number" ? current : 0) * (value as number));
      }
    } else if (op === "$unset") {
      for (const path of Object.keys(fields as Doc)) unsetPath(doc, path);
    } else if (op === "$setOnInsert") {
      // Only meaningful on upsert, handled by the caller below.
    } else if (op === "$push") {
      for (const [path, value] of Object.entries(fields as Doc)) {
        const current = getPath(doc, path);
        const base = Array.isArray(current) ? [...current] : [];
        if (isPlainObject(value) && "$each" in value) {
          const spec = value as { $each: unknown[]; $slice?: number };
          let next = [...base, ...spec.$each];
          if (typeof spec.$slice === "number") {
            next = spec.$slice < 0 ? next.slice(spec.$slice) : next.slice(0, spec.$slice);
          }
          setPath(doc, path, next);
        } else {
          setPath(doc, path, [...base, value]);
        }
      }
    } else if (op === "$pull") {
      // Selector form only (`$pull: { path: { field: value } }`): drop every
      // array element matching ALL selector fields. Pulling an absent element
      // is a no-op, which is what makes pull-then-credit legs replay-safe.
      for (const [path, selector] of Object.entries(fields as Doc)) {
        const current = getPath(doc, path);
        if (current === undefined) continue;
        if (!Array.isArray(current)) {
          throw new Error(`inMemoryDb: $pull target "${path}" is not an array`);
        }
        if (!isPlainObject(selector)) {
          throw new Error(`inMemoryDb: $pull selector for "${path}" is not supported`);
        }
        setPath(
          doc,
          path,
          current.filter(
            (item) =>
              !Object.entries(selector).every(([key, want]) =>
                sameValue(isPlainObject(item) ? (item as Doc)[key] : undefined, want)
              )
          )
        );
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
/**
 * Build the starting document for an upsert from its filter, the way the server
 * does: every top-level equality condition becomes a field, and a document that
 * named no `_id` gets one assigned, because readers that key on `_id` must see
 * the same thing they would against a real driver.
 *
 * Shared by `updateOne`, `findOneAndUpdate` and `replaceOne` so the three cannot
 * drift apart on what an upserted document starts out as.
 */
function seedFromFilter(filter: Doc): Doc {
  const seed: Doc = {};
  for (const [key, condition] of Object.entries(filter)) {
    if (!key.startsWith("$") && !isPlainObject(condition)) setPath(seed, key, condition);
  }
  if (seed._id === undefined) seed._id = new ObjectId();
  return seed;
}

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
  private indexDescriptions: Doc[] = [];

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
      // Driver cursors are async-iterable, and seed code streams large
      // collections with `for await (const doc of col.find(...))` rather than
      // materialising them. Read `rows` lazily so a `.limit()` chained after
      // this still applies.
      async *[Symbol.asyncIterator]() {
        for (const row of rows) yield row;
      },
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
    update: Update,
    options: { upsert?: boolean } = {}
  ): Promise<{ matchedCount: number; modifiedCount: number; upsertedCount: number }> {
    const target = this.docs.find((d) => matchesFilter(d, filter));
    if (!target) {
      if (options.upsert) {
        if (Array.isArray(update)) {
          throw new Error("inMemoryDb: pipeline upserts are not supported");
        }
        const seed = seedFromFilter(filter);
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
    update: Update
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    const targets = this.docs.filter((d) => matchesFilter(d, filter));
    for (const doc of targets) applyUpdate(doc, update);
    return { matchedCount: targets.length, modifiedCount: targets.length };
  }

  async findOneAndUpdate(
    filter: Doc,
    update: Update,
    options: { returnDocument?: "before" | "after"; upsert?: boolean } = {}
  ): Promise<Doc | null> {
    const target = this.docs.find((d) => matchesFilter(d, filter));
    if (!target) {
      // Without upsert this is the ONLY path `getNextSequentialId` can take on a
      // fresh world — it calls with `{ upsert: true }` against an empty
      // `counters` collection, gets null back, and throws. That made a real
      // `bootstrapGameWorld` impossible to run here.
      if (!options.upsert) return null;
      const seed = seedFromFilter(filter);
      const u = update as Doc;
      applyUpdate(seed, {
        ...u,
        ...((u.$setOnInsert as Doc)
          ? { $set: { ...(u.$set as Doc), ...(u.$setOnInsert as Doc) } }
          : {}),
      });
      this.docs.push(seed);
      // Mongo returns null for `before` on an upsert: there was no prior doc.
      return options.returnDocument === "before" ? null : clone(seed);
    }
    const before = clone(target);
    applyUpdate(target, update);
    return options.returnDocument === "before" ? before : clone(target);
  }

  async replaceOne(
    filter: Doc,
    replacement: Doc,
    options: { upsert?: boolean } = {}
  ): Promise<{ matchedCount: number; modifiedCount: number; upsertedCount: number }> {
    const index = this.docs.findIndex((d) => matchesFilter(d, filter));
    if (index < 0) {
      if (!options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      this.docs.push({ ...seedFromFilter(filter), ...clone(replacement) });
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    // A replace keeps `_id` and discards every other previous field — unlike
    // `$set`, which merges.
    const id = this.docs[index]!._id;
    this.docs[index] = { ...clone(replacement), _id: id };
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
  }

  async distinct(field: string, filter: Doc = {}): Promise<unknown[]> {
    const seen = new Set<unknown>();
    for (const doc of this.docs) {
      if (!matchesFilter(doc, filter)) continue;
      const value = getPath(doc, field);
      // Mongo flattens array values into the distinct set.
      if (Array.isArray(value)) value.forEach((v) => seen.add(v));
      else if (value !== undefined) seen.add(value);
    }
    return [...seen];
  }

  /** Whatever `createIndex` has recorded; empty until something creates one. */
  async indexes(): Promise<Doc[]> {
    return [...this.indexDescriptions];
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
      } else if (op.replaceOne) {
        const { filter, replacement, upsert } = op.replaceOne as {
          filter: Doc;
          replacement: Doc;
          upsert?: boolean;
        };
        const res = await this.replaceOne(filter, replacement, { upsert });
        modified += res.modifiedCount;
      } else if (op.updateMany) {
        const { filter, update } = op.updateMany as { filter: Doc; update: Update };
        const res = await this.updateMany(filter, update);
        modified += res.modifiedCount;
      } else if (op.deleteMany) {
        const { filter } = op.deleteMany as { filter: Doc };
        await this.deleteMany(filter);
      } else if (op.deleteOne) {
        const { filter } = op.deleteOne as { filter: Doc };
        const [target] = this.docs.filter((d) => matchesFilter(d, filter));
        if (target) this.docs = this.docs.filter((d) => d !== target);
      } else {
        // Still throws on anything it does not understand. Returning silently
        // would make a seeder that writes nothing look like one that worked.
        throw new Error(`inMemoryDb: unsupported bulk op ${Object.keys(op).join(",")}`);
      }
    }
    return { modifiedCount: modified };
  }

  /**
   * The pipeline subset the banking passes use: `$match`, `$group` with
   * `$sum` / `$min` / `$max` / `$avg` / `$first` / `$last` over a field or a
   * constant, `$project` with 1/0 and `"$field"` aliases, `$sort`, `$limit`,
   * `$count`. Anything else throws, so a test never passes on a stage the
   * adapter quietly ignored.
   */
  aggregate(pipeline: Doc[] = []) {
    const run = (): Doc[] => {
      let rows: Doc[] = this.docs.map((d) => ({ ...d }));
      for (const stage of pipeline) {
        const [op] = Object.keys(stage);
        const spec = stage[op] as Doc;
        switch (op) {
          case "$match":
            rows = rows.filter((row) => matchesFilter(row, spec));
            break;
          case "$group": {
            const groups = new Map<string, Doc>();
            for (const row of rows) {
              const idSpec = spec._id;
              const id =
                idSpec === null || idSpec === undefined
                  ? null
                  : typeof idSpec === "string" && idSpec.startsWith("$")
                    ? getPath(row, idSpec.slice(1))
                    : idSpec;
              const key = JSON.stringify(id === undefined ? null : id);
              let group = groups.get(key);
              if (!group) {
                group = { _id: id ?? null };
                for (const [field, acc] of Object.entries(spec)) {
                  if (field === "_id") continue;
                  const [accOp] = Object.keys(acc as Doc);
                  group[field] =
                    accOp === "$sum" ? 0 : accOp === "$avg" ? { sum: 0, n: 0 } : undefined;
                }
                groups.set(key, group);
              }
              for (const [field, acc] of Object.entries(spec)) {
                if (field === "_id") continue;
                const [accOp] = Object.keys(acc as Doc);
                const operand = (acc as Doc)[accOp];
                const value =
                  typeof operand === "string" && operand.startsWith("$")
                    ? getPath(row, operand.slice(1))
                    : operand;
                const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
                switch (accOp) {
                  case "$sum":
                    group[field] = (group[field] as number) + n;
                    break;
                  case "$min":
                    group[field] =
                      group[field] === undefined ? value : Math.min(group[field] as number, n);
                    break;
                  case "$max":
                    group[field] =
                      group[field] === undefined ? value : Math.max(group[field] as number, n);
                    break;
                  case "$avg": {
                    const state = group[field] as { sum: number; n: number };
                    state.sum += n;
                    state.n += 1;
                    break;
                  }
                  case "$first":
                    if (group[field] === undefined) group[field] = value;
                    break;
                  case "$last":
                    group[field] = value;
                    break;
                  default:
                    throw new Error(`inMemoryDb: $group accumulator ${accOp} is not implemented`);
                }
              }
            }
            rows = [...groups.values()].map((group) => {
              const out: Doc = {};
              for (const [field, value] of Object.entries(group)) {
                const acc = spec[field] as Doc | undefined;
                out[field] =
                  acc && Object.keys(acc)[0] === "$avg"
                    ? (value as { n: number }).n > 0
                      ? (value as { sum: number; n: number }).sum / (value as { n: number }).n
                      : null
                    : value;
              }
              return out;
            });
            break;
          }
          case "$project":
            rows = rows.map((row) => {
              const out: Doc = {};
              const includes = Object.values(spec).some((v) => v === 1 || v === true);
              if (!includes) {
                Object.assign(out, row);
                for (const [field, v] of Object.entries(spec))
                  if (v === 0 || v === false) delete out[field];
                return out;
              }
              if (spec._id !== 0 && spec._id !== false) out._id = row._id;
              for (const [field, v] of Object.entries(spec)) {
                if (v === 1 || v === true) out[field] = getPath(row, field);
                else if (typeof v === "string" && v.startsWith("$"))
                  out[field] = getPath(row, v.slice(1));
              }
              return out;
            });
            break;
          case "$sort": {
            const entries = Object.entries(spec) as Array<[string, number]>;
            rows = [...rows].sort((a, b) => {
              for (const [field, dir] of entries) {
                const av = getPath(a, field) as number | string;
                const bv = getPath(b, field) as number | string;
                if (av === bv) continue;
                if (av === undefined) return 1;
                if (bv === undefined) return -1;
                return (av < bv ? -1 : 1) * (dir < 0 ? -1 : 1);
              }
              return 0;
            });
            break;
          }
          case "$limit":
            rows = rows.slice(0, spec as unknown as number);
            break;
          case "$count":
            rows = [{ [spec as unknown as string]: rows.length }];
            break;
          default:
            throw new Error(`inMemoryDb: aggregate stage ${op} is not implemented`);
        }
      }
      return rows;
    };
    return {
      toArray: async () => run(),
      next: async () => run()[0] ?? null,
    };
  }

  /**
   * Record the index so `indexes()` and `listIndexes()` can report it back.
   *
   * ⚠ IT USED TO RETURN A STRING AND KEEP NOTHING. That was fine while every
   * caller only created indexes. `ensureProviderIdentityIndexes` both creates
   * one AND reads it back to confirm it exists, so a stub that forgets makes
   * the verification throw "Required provider identity index ... is
   * unavailable" -- a failure that looks like a broken index and is really a
   * gap in the double.
   */
  async createIndex(key: Doc = {}, options: Doc = {}): Promise<string> {
    const name =
      typeof options.name === "string"
        ? options.name
        : Object.keys(key)
            .map((field) => `${field}_${key[field] as string}`)
            .join("_") || "index";
    this.indexDescriptions = this.indexDescriptions.filter((index) => index.name !== name);
    this.indexDescriptions.push({ ...options, name, key });
    return name;
  }

  /** Mongo returns a cursor here, not an array. */
  listIndexes(): { toArray: () => Promise<Doc[]> } {
    return { toArray: async () => [...this.indexDescriptions] };
  }

  /**
   * Drop a recorded index by name.
   *
   * Real Mongo throws when the index is absent, and the seeders rely on that:
   * `indexes/helpers.ts` drops an existing index only after finding it in
   * `listIndexes()`, and the migrations guard on a name they just read. A stub
   * that silently succeeded would hide a seeder dropping something it never
   * checked for.
   */
  async dropIndex(name: string): Promise<void> {
    const before = this.indexDescriptions.length;
    this.indexDescriptions = this.indexDescriptions.filter((index) => index.name !== name);
    if (this.indexDescriptions.length === before) {
      throw new Error(`index not found with name [${name}]`);
    }
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
