/**
 * Counts database round trips made through an in-memory db, per collection and
 * method, so a test can assert a round-trip budget instead of timing a run.
 *
 * One `find` call counts as one round trip regardless of how many documents the
 * cursor streams back, which matches how the production profile counts them.
 */
import type { InMemoryDb } from "./inMemoryDb";

const COUNTED = [
  "find",
  "findOne",
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "deleteOne",
  "deleteMany",
  "countDocuments",
  "distinct",
  "bulkWrite",
  "aggregate",
] as const;

export interface RoundTripCounter {
  total(): number;
  byCollection(): Record<string, number>;
  byMethod(): Record<string, number>;
  /** Round trips for one collection, optionally narrowed to one method. */
  count(collection: string, method?: string): number;
  reset(): void;
  /** Largest per-collection counts first, for failure messages. */
  summary(limit?: number): string;
}

export function countRoundTrips(db: InMemoryDb): RoundTripCounter {
  const counts = new Map<string, number>();
  const wrapped = new WeakSet<object>();
  // The in-memory db implements bulk calls on top of its single-document ones.
  // Count only the outermost call so one `insertMany` is one round trip.
  let depth = 0;
  const originalCollection = db.collection.bind(db);
  const wrap = (name: string): void => {
    const collection = originalCollection(name);
    if (wrapped.has(collection)) return;
    wrapped.add(collection);
    for (const method of COUNTED) {
      const original = Reflect.get(collection, method);
      if (typeof original !== "function") continue;
      Reflect.set(collection, method, (...args: unknown[]) => {
        if (depth === 0) {
          const key = `${name}.${method}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        depth++;
        let result: unknown;
        try {
          result = original.apply(collection, args);
        } catch (error) {
          depth--;
          throw error;
        }
        if (result instanceof Promise) return result.finally(() => void depth--);
        depth--;
        return result;
      });
    }
  };
  // Collections are created lazily, so wrap on every access too.
  db.collection = (name: string) => {
    wrap(name);
    return originalCollection(name);
  };
  for (const name of db.collections.keys()) wrap(name);

  const sumBy = (pick: (key: string) => string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [key, n] of counts) out[pick(key)] = (out[pick(key)] ?? 0) + n;
    return out;
  };
  return {
    total: () => [...counts.values()].reduce((a, b) => a + b, 0),
    byCollection: () => sumBy((k) => k.split(".")[0]),
    byMethod: () => sumBy((k) => k.split(".")[1]),
    count: (collection, method) =>
      method
        ? (counts.get(`${collection}.${method}`) ?? 0)
        : (sumBy((k) => k.split(".")[0])[collection] ?? 0),
    reset: () => counts.clear(),
    summary: (limit = 12) =>
      [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([k, n]) => `${k}=${n}`)
        .join(", "),
  };
}
