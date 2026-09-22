/**
 * Minimal in-memory Mongo stand-in for #860 Commons by-election tests.
 *
 * Supports the filter operators the vacancy/recall shells, the watcher, the
 * seat commands, and the lifecycle hooks use ($in/$nin/$ne/$exists/comparison
 * ops, $or/$and, null-means-missing matching) and the update operators they
 * write ($set/$unset/$push/$pull/$inc, findOneAndUpdate). Anything else throws
 * so a test fails loudly instead of passing against a silent no-op.
 */

import { ObjectId } from "mongodb";
import { vi } from "vitest";
import type { Db } from "mongodb";

type Doc = Record<string, unknown>;

function isObjectId(value: unknown): value is ObjectId {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { equals?: unknown }).equals === "function" &&
    typeof (value as { toString?: unknown }).toString === "function" &&
    (value as { _bsontype?: unknown })._bsontype === "ObjectId"
  );
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (isObjectId(a) || isObjectId(b)) {
    try {
      if (isObjectId(a) && isObjectId(b)) return a.equals(b);
      return String(a) === String(b);
    } catch {
      return false;
    }
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  return a === b;
}

function getPath(doc: Doc, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = doc;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Doc)[part];
  }
  return current;
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Doc = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const existing = current[parts[i]];
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Doc;
  }
  current[parts[parts.length - 1]] = value;
}

function deletePath(doc: Doc, path: string): void {
  const parts = path.split(".");
  let current: unknown = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof current !== "object" || current === null) return;
    current = (current as Doc)[parts[i]];
  }
  if (typeof current === "object" && current !== null) {
    delete (current as Doc)[parts[parts.length - 1]];
  }
}

function matchesOperator(value: unknown, ops: Record<string, unknown>): boolean {
  for (const [op, operand] of Object.entries(ops)) {
    switch (op) {
      case "$in":
        if (!Array.isArray(operand) || !operand.some((v) => valuesEqual(value, v))) return false;
        break;
      case "$nin":
        if (Array.isArray(operand) && operand.some((v) => valuesEqual(value, v))) return false;
        break;
      case "$ne":
        if (valuesEqual(value, operand)) return false;
        break;
      case "$exists":
        if ((value !== undefined) !== Boolean(operand)) return false;
        break;
      case "$gt":
        if (!((value as number) > (operand as number))) return false;
        break;
      case "$gte":
        if (!((value as number) >= (operand as number))) return false;
        break;
      case "$lt":
        if (!((value as number) < (operand as number))) return false;
        break;
      case "$lte":
        if (!((value as number) <= (operand as number))) return false;
        break;
      default:
        throw new Error(`fakeDb: unsupported query operator ${op}`);
    }
  }
  return true;
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || isObjectId(value) || value instanceof Date) {
    return false;
  }
  return Object.keys(value as Doc).some((k) => k.startsWith("$"));
}

export function matchesFilter(doc: Doc, filter: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    if (key === "$or") {
      if (
        !Array.isArray(expected) ||
        !expected.some((f) => matchesFilter(doc, f as Record<string, unknown>))
      ) {
        return false;
      }
      continue;
    }
    if (key === "$and") {
      if (
        !Array.isArray(expected) ||
        !expected.every((f) => matchesFilter(doc, f as Record<string, unknown>))
      ) {
        return false;
      }
      continue;
    }
    const value = getPath(doc, key);
    if (isOperatorObject(expected)) {
      if (!matchesOperator(value, expected)) return false;
    } else if (expected === null) {
      if (value !== null && value !== undefined) return false;
    } else {
      if (!valuesEqual(value, expected)) return false;
    }
  }
  return true;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => cloneValue(v)) as unknown as T;
  if (
    typeof value === "object" &&
    value !== null &&
    !isObjectId(value) &&
    !(value instanceof Date)
  ) {
    const out: Doc = {};
    for (const [k, v] of Object.entries(value as Doc)) out[k] = cloneValue(v);
    return out as T;
  }
  return value;
}

function applyUpdate(doc: Doc, update: Record<string, unknown>): boolean {
  let touched = false;
  for (const [op, clause] of Object.entries(update)) {
    const fields = clause as Record<string, unknown>;
    switch (op) {
      case "$set":
        for (const [path, value] of Object.entries(fields)) {
          setPath(doc, path, cloneValue(value));
          touched = true;
        }
        break;
      case "$unset":
        for (const path of Object.keys(fields)) {
          deletePath(doc, path);
          touched = true;
        }
        break;
      case "$push":
        for (const [path, value] of Object.entries(fields)) {
          const arr = getPath(doc, path);
          if (!Array.isArray(arr)) setPath(doc, path, []);
          (getPath(doc, path) as unknown[]).push(cloneValue(value));
          touched = true;
        }
        break;
      case "$pull":
        for (const [path, value] of Object.entries(fields)) {
          const arr = getPath(doc, path);
          if (Array.isArray(arr)) {
            setPath(
              doc,
              path,
              arr.filter((v) => !valuesEqual(v, value))
            );
            touched = true;
          }
        }
        break;
      case "$inc":
        for (const [path, value] of Object.entries(fields)) {
          const current = getPath(doc, path);
          setPath(doc, path, (typeof current === "number" ? current : 0) + (value as number));
          touched = true;
        }
        break;
      case "$addToSet":
        for (const [path, value] of Object.entries(fields)) {
          const arr = getPath(doc, path);
          if (!Array.isArray(arr)) setPath(doc, path, []);
          const target = getPath(doc, path) as unknown[];
          if (!target.some((v) => valuesEqual(v, value))) target.push(cloneValue(value));
          touched = true;
        }
        break;
      default:
        throw new Error(`fakeDb: unsupported update operator ${op}`);
    }
  }
  return touched;
}

interface CursorOptions {
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
}

class FakeCursor {
  private options: CursorOptions = {};
  constructor(
    private readonly rows: Doc[],
    private readonly filter: Record<string, unknown>
  ) {}

  private results(): Doc[] {
    let out = this.rows.filter((d) => matchesFilter(d, this.filter));
    if (this.options.sort) {
      const entries = Object.entries(this.options.sort);
      out = [...out].sort((a, b) => {
        for (const [path, dir] of entries) {
          const av = getPath(a, path);
          const bv = getPath(b, path);
          if (av === bv) continue;
          if (av == null) return 1;
          if (bv == null) return -1;
          return (av < bv ? -1 : 1) * (dir as number);
        }
        return 0;
      });
    }
    if (this.options.skip) out = out.slice(this.options.skip);
    if (this.options.limit !== undefined) out = out.slice(0, this.options.limit);
    return out;
  }

  toArray = vi.fn(async (): Promise<Doc[]> => this.results().map((d) => d));
  sort = vi.fn((spec: Record<string, 1 | -1>): FakeCursor => {
    this.options.sort = spec;
    return this;
  });
  limit = vi.fn((n: number): FakeCursor => {
    this.options.limit = n;
    return this;
  });
  skip = vi.fn((n: number): FakeCursor => {
    this.options.skip = n;
    return this;
  });
  project = vi.fn((): FakeCursor => this);
}

class FakeCollection {
  readonly docs: Doc[] = [];

  find = vi.fn(
    (filter: Record<string, unknown> = {}): FakeCursor => new FakeCursor(this.docs, filter)
  );

  findOne = vi.fn(async (filter: Record<string, unknown> = {}): Promise<Doc | null> => {
    return this.docs.find((d) => matchesFilter(d, filter)) ?? null;
  });

  insertOne = vi.fn(async (doc: Doc): Promise<{ insertedId: unknown }> => {
    const stored = cloneValue(doc);
    if ((stored as Doc)._id === undefined) (stored as Doc)._id = new ObjectId();
    this.docs.push(stored as Doc);
    return { insertedId: (stored as Doc)._id };
  });

  insertMany = vi.fn(async (rows: Doc[]): Promise<{ insertedIds: unknown[] }> => {
    const ids: unknown[] = [];
    for (const row of rows) {
      const stored = cloneValue(row);
      if ((stored as Doc)._id === undefined) (stored as Doc)._id = new ObjectId();
      this.docs.push(stored as Doc);
      ids.push((stored as Doc)._id);
    }
    return { insertedIds: ids };
  });

  updateOne = vi.fn(
    async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>
    ): Promise<{ matchedCount: number; modifiedCount: number }> => {
      const doc = this.docs.find((d) => matchesFilter(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      const changed = applyUpdate(doc, update);
      return { matchedCount: 1, modifiedCount: changed ? 1 : 0 };
    }
  );

  updateMany = vi.fn(
    async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>
    ): Promise<{ matchedCount: number; modifiedCount: number }> => {
      let matched = 0;
      let modified = 0;
      for (const doc of this.docs) {
        if (!matchesFilter(doc, filter)) continue;
        matched++;
        if (applyUpdate(doc, update)) modified++;
      }
      return { matchedCount: matched, modifiedCount: modified };
    }
  );

  deleteOne = vi.fn(async (filter: Record<string, unknown>): Promise<{ deletedCount: number }> => {
    const index = this.docs.findIndex((d) => matchesFilter(d, filter));
    if (index < 0) return { deletedCount: 0 };
    this.docs.splice(index, 1);
    return { deletedCount: 1 };
  });

  deleteMany = vi.fn(async (filter: Record<string, unknown>): Promise<{ deletedCount: number }> => {
    const before = this.docs.length;
    for (let i = this.docs.length - 1; i >= 0; i--) {
      if (matchesFilter(this.docs[i], filter)) this.docs.splice(i, 1);
    }
    return { deletedCount: before - this.docs.length };
  });

  countDocuments = vi.fn(async (filter: Record<string, unknown> = {}): Promise<number> => {
    return this.docs.filter((d) => matchesFilter(d, filter)).length;
  });

  findOneAndUpdate = vi.fn(
    async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options?: { returnDocument?: "after" | "before" }
    ): Promise<Doc | null> => {
      const doc = this.docs.find((d) => matchesFilter(d, filter));
      if (!doc) return null;
      applyUpdate(doc, update);
      return options?.returnDocument === "before" ? doc : doc;
    }
  );

  findOneAndDelete = vi.fn(async (filter: Record<string, unknown>): Promise<Doc | null> => {
    const index = this.docs.findIndex((d) => matchesFilter(d, filter));
    if (index < 0) return null;
    const [doc] = this.docs.splice(index, 1);
    return doc;
  });

  aggregate = vi.fn(() => ({ toArray: vi.fn(async () => []) }));
  distinct = vi.fn(async () => []);
  bulkWrite = vi.fn(async () => ({ matchedCount: 0, modifiedCount: 0 }));
  createIndex = vi.fn(async () => "index");
  listIndexes = vi.fn(() => ({ toArray: vi.fn(async () => []) }));
}

export interface FakeCommonsDb {
  db: Db;
  collections: Map<string, FakeCollection>;
  collection(name: string): FakeCollection;
  seed(name: string, rows: Doc[]): void;
  read<T = Doc>(name: string): T[];
}

export function createFakeCommonsDb(): FakeCommonsDb {
  const collections = new Map<string, FakeCollection>();
  const collection = (name: string): FakeCollection => {
    let coll = collections.get(name);
    if (!coll) {
      coll = new FakeCollection();
      collections.set(name, coll);
    }
    return coll;
  };
  return {
    db: { collection: ((name: string) => collection(name)) as unknown as Db["collection"] } as Db,
    collections,
    collection,
    seed(name: string, rows: Doc[]): void {
      const coll = collection(name);
      for (const row of rows) coll.docs.push(cloneValue(row));
    },
    read<T = Doc>(name: string): T[] {
      return (collections.get(name)?.docs ?? []) as T[];
    },
  };
}
