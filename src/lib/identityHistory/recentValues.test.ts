import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { loadRecentIdentityValues, IDENTITY_HISTORY_VALUE_CAP } from "./recentValues";
import { IDENTITY_HISTORY_MAX_AGE_MS } from "@/lib/db/types/identityObservation";

const USER = new ObjectId();
const OTHER = new ObjectId();
const NOW = new Date(Date.UTC(2026, 8, 16));
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ipsOf = (m: Map<string, { ips: string[] }>, id = USER) => m.get(id.toString())?.ips;

interface FakeRow {
  userId: ObjectId;
  track: string;
  value: string;
  lastSeen: Date;
}

type Doc = Record<string, unknown>;

/** Resolve a "$a.b" field path against a document. */
function path(doc: Doc, expr: string): unknown {
  return expr
    .slice(1)
    .split(".")
    .reduce<unknown>((acc, key) => (acc as Doc | undefined)?.[key], doc);
}

/**
 * A deliberately small interpreter for the exact stages `loadRecentIdentityValues`
 * uses ($match, $group with $max/$push, $sort, $project with $slice).
 *
 * It runs the REAL pipeline rather than reimplementing the function's intent,
 * so a wrong field path (`$userId` where `$_id.userId` is meant) fails here
 * instead of shipping. It is not a general aggregation engine.
 */
function runPipeline(rows: FakeRow[], stages: Doc[]): Doc[] {
  let docs: Doc[] = rows.map((r) => ({ ...r }));
  for (const stage of stages) {
    if (stage.$match) {
      const m = stage.$match as { userId?: { $in: ObjectId[] }; lastSeen?: { $gte: Date } };
      docs = docs.filter((d) => {
        const okUser = !m.userId || m.userId.$in.some((id) => id.equals(d.userId as ObjectId));
        const okDate = !m.lastSeen || (d.lastSeen as Date) >= m.lastSeen.$gte;
        return okUser && okDate;
      });
    } else if (stage.$group) {
      const g = stage.$group as Doc;
      const idSpec = g._id as Record<string, string>;
      const buckets = new Map<string, Doc>();
      for (const d of docs) {
        const id: Doc = {};
        for (const [k, expr] of Object.entries(idSpec)) id[k] = path(d, expr);
        const key = JSON.stringify(id, (_k, v) => (v instanceof ObjectId ? v.toHexString() : v));
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = { _id: id };
          buckets.set(key, bucket);
        }
        for (const [field, spec] of Object.entries(g)) {
          if (field === "_id") continue;
          const op = spec as Doc;
          if (op.$max !== undefined) {
            const v = path(d, op.$max as string) as Date;
            if (!bucket[field] || v > (bucket[field] as Date)) bucket[field] = v;
          } else if (op.$push !== undefined) {
            const list = (bucket[field] as unknown[]) ?? [];
            list.push(path(d, op.$push as string));
            bucket[field] = list;
          }
        }
      }
      docs = [...buckets.values()];
    } else if (stage.$sort) {
      const [[field, dir]] = Object.entries(stage.$sort as Record<string, number>);
      docs = [...docs].sort((a, b) => {
        const av = (a[field] as Date).getTime();
        const bv = (b[field] as Date).getTime();
        return dir === -1 ? bv - av : av - bv;
      });
    } else if (stage.$project) {
      const p = stage.$project as Doc;
      docs = docs.map((d) => {
        const out: Doc = { _id: d._id };
        for (const [field, spec] of Object.entries(p)) {
          if (field === "_id") continue;
          const op = spec as Doc;
          if (op.$slice) {
            const [expr, n] = op.$slice as [string, number];
            out[field] = ((path(d, expr) as unknown[]) ?? []).slice(0, n);
          }
        }
        return out;
      });
    } else {
      throw new Error(`unsupported stage: ${Object.keys(stage).join(",")}`);
    }
  }
  return docs;
}

function fakeDb(rows: FakeRow[]) {
  return {
    collection: () => ({
      aggregate: (stages: Doc[]) => ({ toArray: async () => runPipeline(rows, stages) }),
    }),
  } as unknown as Db;
}

describe("loadRecentIdentityValues", () => {
  it("splits values by track", async () => {
    const db = fakeDb([
      { userId: USER, track: "ip", value: "1.1.1.1", lastSeen: ago(DAY) },
      { userId: USER, track: "fingerprint", value: "abc", lastSeen: ago(DAY) },
    ]);
    const map = await loadRecentIdentityValues(db, [USER], NOW);
    expect(map.get(USER.toString())?.ips).toEqual(["1.1.1.1"]);
    expect(map.get(USER.toString())?.fingerprints).toEqual(["abc"]);
  });

  it("excludes runs older than the 90-day window", async () => {
    const db = fakeDb([
      { userId: USER, track: "ip", value: "old", lastSeen: ago(IDENTITY_HISTORY_MAX_AGE_MS + DAY) },
      { userId: USER, track: "ip", value: "new", lastSeen: ago(DAY) },
    ]);
    expect(ipsOf(await loadRecentIdentityValues(db, [USER], NOW))).toEqual(["new"]);
  });

  it("dedupes repeated values across runs, ordering by the most recent sighting", async () => {
    const db = fakeDb([
      { userId: USER, track: "ip", value: "1.1.1.1", lastSeen: ago(DAY) },
      { userId: USER, track: "ip", value: "2.2.2.2", lastSeen: ago(2 * DAY) },
      { userId: USER, track: "ip", value: "1.1.1.1", lastSeen: ago(3 * DAY) },
    ]);
    expect(ipsOf(await loadRecentIdentityValues(db, [USER], NOW))).toEqual(["1.1.1.1", "2.2.2.2"]);
  });

  it("caps at the 20 most recent DISTINCT values per track", async () => {
    const db = fakeDb(
      Array.from({ length: 30 }, (_, i) => ({
        userId: USER,
        track: "ip",
        value: `10.0.0.${i}`,
        lastSeen: ago((i + 1) * 60_000),
      }))
    );
    const map = await loadRecentIdentityValues(db, [USER], NOW);
    expect(IDENTITY_HISTORY_VALUE_CAP).toBe(20);
    expect(map.get(USER.toString())?.ips).toHaveLength(20);
    expect(map.get(USER.toString())?.ips[0]).toBe("10.0.0.0");
  });

  it("does not let repeat runs on one value consume the cap", async () => {
    // 100 rows, but only 3 distinct values: all 3 must survive.
    const db = fakeDb(
      Array.from({ length: 100 }, (_, i) => ({
        userId: USER,
        track: "ip",
        value: `10.0.0.${i % 3}`,
        lastSeen: ago((i + 1) * 60_000),
      }))
    );
    expect(ipsOf(await loadRecentIdentityValues(db, [USER], NOW))).toHaveLength(3);
  });

  it("caps each track independently rather than sharing one budget", async () => {
    const db = fakeDb([
      ...Array.from({ length: 25 }, (_, i) => ({
        userId: USER,
        track: "ip",
        value: `10.0.0.${i}`,
        lastSeen: ago((i + 1) * 60_000),
      })),
      ...Array.from({ length: 25 }, (_, i) => ({
        userId: USER,
        track: "fingerprint",
        value: `fp${i}`,
        lastSeen: ago((i + 1) * 60_000),
      })),
    ]);
    const bucket = (await loadRecentIdentityValues(db, [USER], NOW)).get(USER.toString());
    expect(bucket?.ips).toHaveLength(20);
    expect(bucket?.fingerprints).toHaveLength(20);
  });

  it("keys each user's values separately", async () => {
    const db = fakeDb([
      { userId: USER, track: "ip", value: "1.1.1.1", lastSeen: ago(DAY) },
      { userId: OTHER, track: "ip", value: "2.2.2.2", lastSeen: ago(DAY) },
    ]);
    const map = await loadRecentIdentityValues(db, [USER, OTHER], NOW);
    expect(ipsOf(map, USER)).toEqual(["1.1.1.1"]);
    expect(ipsOf(map, OTHER)).toEqual(["2.2.2.2"]);
  });

  it("returns an empty map for no users without touching the database", async () => {
    const db = {
      collection: () => {
        throw new Error("should not query");
      },
    } as unknown as Db;
    expect((await loadRecentIdentityValues(db, [], NOW)).size).toBe(0);
  });
});
