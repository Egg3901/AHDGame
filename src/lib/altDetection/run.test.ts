import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

// `isAltScoringEnabled` (src/lib/altDetection/featureFlag.ts) reaches for its
// own `getDb()` when no preloaded config is passed. Mock it so that call
// never attempts a real network connection in tests — `runAltScoring` is
// exercised with `force: true` throughout, so the mocked (always-false)
// flag value doesn't affect what gets computed/written, only the reported
// `enabled` field.
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn().mockRejectedValue(new Error("no db in test")) }));

import { runAltScoring } from "./run";
import { getDb } from "@/lib/mongodb";
import { resetAltScoringFlagCache } from "./featureFlag";

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight in-memory Mongo-like stub (mirrors the pattern established in
// src/lib/elections/germanyLandesliste.test.ts) — enough query-language
// support (`$in`, `$gte`, `$exists`, `$or`, dot-path fields, bulkWrite
// upserts) to exercise `run.ts`'s real candidate-selection/facet/upsert
// logic end-to-end without booting mongodb-memory-server (not a project
// dependency).
// ─────────────────────────────────────────────────────────────────────────────

type Doc = Record<string, unknown>;

function getPath(doc: Doc, path: string): unknown {
  return path.split(".").reduce<unknown>((val, key) => {
    if (val == null || typeof val !== "object") return undefined;
    return (val as Doc)[key];
  }, doc);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  if (a instanceof ObjectId || b instanceof ObjectId) {
    try {
      return new ObjectId(a as never).equals(new ObjectId(b as never));
    } catch {
      return false;
    }
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function matchesQuery(doc: Doc, query: Doc): boolean {
  if (Array.isArray(query.$or)) {
    if (!(query.$or as Doc[]).some((clause) => matchesQuery(doc, clause))) return false;
  }
  for (const [key, cond] of Object.entries(query)) {
    if (key === "$or") continue;
    const docVal = getPath(doc, key);
    if (
      cond &&
      typeof cond === "object" &&
      !(cond instanceof ObjectId) &&
      !(cond instanceof Date)
    ) {
      const condObj = cond as Doc;
      if ("$in" in condObj) {
        const arr = condObj.$in as unknown[];
        if (Array.isArray(docVal)) {
          if (!docVal.some((dv) => arr.some((v) => valuesEqual(dv, v)))) return false;
        } else if (!arr.some((v) => valuesEqual(docVal, v))) {
          return false;
        }
        continue;
      }
      if ("$gte" in condObj) {
        const bound = condObj.$gte as Date | number;
        if (docVal instanceof Date && bound instanceof Date) {
          if (docVal.getTime() < bound.getTime()) return false;
        } else if (typeof docVal === "number" && typeof bound === "number") {
          if (docVal < bound) return false;
        } else {
          return false;
        }
        continue;
      }
      if ("$lt" in condObj) {
        const bound = condObj.$lt as Date | number;
        if (docVal instanceof Date && bound instanceof Date) {
          if (docVal.getTime() >= bound.getTime()) return false;
        } else if (typeof docVal === "number" && typeof bound === "number") {
          if (docVal >= bound) return false;
        } else {
          return false;
        }
        continue;
      }
      if ("$ne" in condObj) {
        if (valuesEqual(docVal, condObj.$ne)) return false;
        continue;
      }
      if ("$exists" in condObj) {
        if ((docVal !== undefined) !== Boolean(condObj.$exists)) return false;
        continue;
      }
    }
    if (!valuesEqual(docVal, cond)) return false;
  }
  return true;
}

interface FakeCursor<T> {
  toArray: () => Promise<T[]>;
  project: () => FakeCursor<T>;
  sort: () => FakeCursor<T>;
  limit: (n: number) => FakeCursor<T>;
}

function makeCursor<T>(docs: T[]): FakeCursor<T> {
  let rows = docs;
  const cursor: FakeCursor<T> = {
    toArray: async () => rows,
    project: () => cursor,
    sort: () => cursor,
    limit: (n: number) => {
      rows = rows.slice(0, n);
      return cursor;
    },
  };
  return cursor;
}

function makeFakeCollection(store: Doc[]) {
  return {
    find: (query: Doc = {}) => makeCursor(store.filter((d) => matchesQuery(d, query))),
    findOne: async (query: Doc = {}) => store.find((d) => matchesQuery(d, query)) ?? null,
    distinct: async (field: string, query: Doc = {}) => {
      const matched = store.filter((d) => matchesQuery(d, query));
      const seen = new Map<string, unknown>();
      for (const d of matched) {
        const v = getPath(d, field);
        if (v == null) continue;
        const key = v instanceof ObjectId ? v.toString() : String(v);
        if (!seen.has(key)) seen.set(key, v);
      }
      return [...seen.values()];
    },
    insertOne: async (doc: Doc) => {
      store.push({ ...doc });
      return { acknowledged: true, insertedId: doc._id };
    },
    deleteMany: async (query: Doc = {}) => {
      let deletedCount = 0;
      for (let i = store.length - 1; i >= 0; i--) {
        if (matchesQuery(store[i], query)) {
          store.splice(i, 1);
          deletedCount++;
        }
      }
      return { acknowledged: true, deletedCount };
    },
    bulkWrite: async (ops: any[]) => {
      let upsertedCount = 0;
      let modifiedCount = 0;
      let matchedCount = 0;
      for (const op of ops) {
        if (op.insertOne) {
          store.push({ ...op.insertOne.document });
          upsertedCount++;
        } else if (op.updateOne) {
          const idx = store.findIndex((d) => matchesQuery(d, op.updateOne.filter));
          const inc = (op.updateOne.update.$inc ?? {}) as Record<string, number>;
          if (idx === -1) {
            if (op.updateOne.upsert) {
              const doc: Doc = {
                ...(op.updateOne.update.$setOnInsert ?? {}),
                ...(op.updateOne.update.$set ?? {}),
              };
              // `$inc` on an upsert-insert starts the counter from 0, matching
              // Mongo — `run.ts` relies on this for `observationCount`.
              for (const [field, delta] of Object.entries(inc)) doc[field] = delta;
              store.push(doc);
              upsertedCount++;
            }
          } else {
            matchedCount++;
            Object.assign(store[idx], op.updateOne.update.$set ?? {});
            for (const [field, delta] of Object.entries(inc)) {
              store[idx][field] = ((store[idx][field] as number) ?? 0) + delta;
            }
            modifiedCount++;
          }
        }
      }
      return { upsertedCount, modifiedCount, matchedCount };
    },
  };
}

function makeFakeDb(seed: Record<string, Doc[]>): { db: Db; collections: Record<string, Doc[]> } {
  const collections: Record<string, Doc[]> = {};
  for (const [name, docs] of Object.entries(seed)) {
    collections[name] = docs.map((d) => ({ ...d }));
  }
  const db = {
    collection: (name: string) => {
      if (!collections[name]) collections[name] = [];
      return makeFakeCollection(collections[name]);
    },
  } as unknown as Db;
  return { db, collections };
}

// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-07-21T12:00:00Z");
const RECENT = new Date("2026-07-21T10:00:00Z");
const RECENT_ACCOUNT = new Date("2026-07-20T12:00:00Z");
const SHARED_FINGERPRINT = "fp-shared-hardware-hash-abc123";

const operatorId = new ObjectId();
const burnerId = new ObjectId();
const bystanderId = new ObjectId();

function baseSeed(): Record<string, Doc[]> {
  return {
    users: [
      {
        _id: operatorId,
        username: "operator",
        isBanned: false,
        createdAt: RECENT_ACCOUNT,
        registrationFingerprint: SHARED_FINGERPRINT,
        fingerprintHistory: [],
      },
      {
        _id: burnerId,
        username: "burner",
        isBanned: false,
        createdAt: RECENT_ACCOUNT,
        registrationFingerprint: SHARED_FINGERPRINT,
        fingerprintHistory: [],
      },
      {
        _id: bystanderId,
        username: "bystander",
        isBanned: false,
        createdAt: RECENT_ACCOUNT,
        registrationFingerprint: "fp-unrelated-hash-xyz789",
        fingerprintHistory: [],
      },
    ],
    characters: [],
    activityLog: [
      { type: "login", userId: operatorId, username: "operator", timestamp: RECENT },
      { type: "login", userId: burnerId, username: "burner", timestamp: RECENT },
      { type: "login", userId: bystanderId, username: "bystander", timestamp: RECENT },
    ],
    actionLogs: [],
    suspiciousCharacters: [],
    financialTxLog: [],
    gameConfig: [],
    gameState: [],
    altLinks: [],
    altClusters: [],
  };
}

describe("runAltScoring — scenario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The playtest harness shares an IP, a device and a tracking id with whatever
   * drives it, which is exactly the signature this scorer is built to find. Left
   * in the pool it would be reported as a ring, repeatedly, and the only way to
   * tell it from a real one is to already know. Excluding it at candidate
   * selection rather than at link-building also stops it sitting between two
   * real users and joining them into a cluster they do not belong in.
   */
  it("keeps a synthetic playtest account out of the candidate pool entirely", async () => {
    const seed = baseSeed();
    // The burner is the harness: same fingerprint as the operator, so without
    // the exclusion the pair links with high confidence.
    seed.characters = [
      { _id: new ObjectId(), userId: burnerId, name: "Harness", isSynthetic: true },
    ];

    const { db, collections } = makeFakeDb(seed);
    const result = await runAltScoring(db, { now: NOW, turn: 500, force: true });

    const involvesHarness = collections.altLinks.some((l) => {
      const ids = [
        String((l as { userA: ObjectId }).userA),
        String((l as { userB: ObjectId }).userB),
      ];
      return ids.includes(burnerId.toString());
    });
    expect(involvesHarness).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("writes a new, auto-opened cluster when two candidates share a strong signal", async () => {
    const { db, collections } = makeFakeDb(baseSeed());

    const result = await runAltScoring(db, { now: NOW, turn: 500, force: true });

    expect(result.candidateCount).toBeGreaterThanOrEqual(2);
    expect(result.linksComputed).toBeGreaterThan(0);
    expect(result.linksWritten).toBeGreaterThan(0);
    expect(result.clustersComputed).toBe(1);
    expect(result.clustersWritten).toBe(1);
    expect(result.clustersOpened).toBe(1);
    expect(result.error).toBeUndefined();

    // altLinks: the operator/burner pair should be linked with high
    // confidence (device_fingerprint_exact ~0.95); the bystander should not
    // appear in any persisted link at all (no shared signal).
    const links = collections.altLinks;
    expect(links.length).toBeGreaterThan(0);
    const opBurnerLink = links.find((l) => {
      const ids = [
        String((l as { userA: ObjectId }).userA),
        String((l as { userB: ObjectId }).userB),
      ];
      return ids.includes(operatorId.toString()) && ids.includes(burnerId.toString());
    });
    expect(opBurnerLink).toBeDefined();
    expect((opBurnerLink as { confidence: number }).confidence).toBeGreaterThan(0.6);
    const bystanderInvolved = links.some((l) => {
      const ids = [
        String((l as { userA: ObjectId }).userA),
        String((l as { userB: ObjectId }).userB),
      ];
      return ids.includes(bystanderId.toString());
    });
    expect(bystanderInvolved).toBe(false);

    // altClusters: one new cluster, auto-opened (confidence crossed the
    // default 0.6 threshold), containing exactly the operator+burner pair.
    const clusters = collections.altClusters;
    expect(clusters).toHaveLength(1);
    const cluster = clusters[0] as {
      status: string;
      confidence: number;
      memberUserIds: ObjectId[];
      reviewedBy?: ObjectId;
      reviewNote?: string;
    };
    expect(cluster.status).toBe("open");
    expect(cluster.confidence).toBeGreaterThan(0.6);
    const memberStrings = cluster.memberUserIds.map((id) => id.toString()).sort();
    expect(memberStrings).toEqual([operatorId.toString(), burnerId.toString()].sort());
    expect(cluster.reviewedBy).toBeUndefined();
  });

  it("preserves a moderator's status/reviewedBy/reviewNote across a recompute", async () => {
    const seed = baseSeed();
    const { db, collections } = makeFakeDb(seed);

    // First pass creates the cluster.
    await runAltScoring(db, { now: NOW, turn: 500, force: true });
    expect(collections.altClusters).toHaveLength(1);

    // Simulate a moderator reviewing and dismissing the ring as a false
    // positive (e.g. confirmed roommates) between compute runs.
    const adminId = new ObjectId();
    const existingCluster = collections.altClusters[0] as Doc;
    existingCluster.status = "dismissed";
    existingCluster.reviewedBy = adminId;
    existingCluster.reviewNote = "Confirmed roommates on a shared PC — not an alt ring.";
    const originalUpdatedAt = existingCluster.updatedAt as Date;

    // Recompute an hour later — same evidence, so the same cluster should
    // be reconciled (matched by member overlap), NOT duplicated, and its
    // moderator disposition must survive untouched.
    const laterNow = new Date(NOW.getTime() + 60 * 60 * 1000);
    const result = await runAltScoring(db, { now: laterNow, turn: 501, force: true });

    expect(result.clustersComputed).toBe(1);
    expect(result.clustersWritten).toBe(1);
    // Reconciled with the existing doc, not a fresh auto-open.
    expect(result.clustersOpened).toBe(0);

    expect(collections.altClusters).toHaveLength(1);
    const reconciled = collections.altClusters[0] as Doc & {
      status: string;
      reviewedBy: ObjectId;
      reviewNote: string;
      updatedAt: Date;
      confidence: number;
    };
    expect(reconciled.status).toBe("dismissed");
    expect(reconciled.reviewedBy.toString()).toBe(adminId.toString());
    expect(reconciled.reviewNote).toBe("Confirmed roommates on a shared PC — not an alt ring.");
    // Evidence fields DO refresh on a reconcile.
    expect(reconciled.confidence).toBeGreaterThan(0.6);
    expect((reconciled.updatedAt as Date).getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
  });

  it("computes but does not persist below the auto-open cluster threshold", async () => {
    // A single weak signal (email family match, default weight 0.30) stays
    // well under the noisy-OR confidence needed to clear the default 0.6
    // cluster threshold on its own, and the pair never crosses the 0.3 link
    // threshold either... use a signal just above the LINK threshold but
    // below the CLUSTER threshold: subnet share (0.15) alone won't even
    // clear the link threshold, so use two mid-weak signals that clear the
    // link threshold (>=0.3) but stay under 0.6 cluster threshold.
    const weakA = new ObjectId();
    const weakB = new ObjectId();
    const seed = baseSeed();
    seed.users.push(
      {
        _id: weakA,
        username: "weakA",
        isBanned: false,
        email: "person.one@example.com",
        fingerprintHistory: [],
      },
      {
        _id: weakB,
        username: "weakB",
        isBanned: false,
        email: "person.two@example.com",
        fingerprintHistory: [],
      }
    );
    seed.activityLog.push(
      { type: "login", userId: weakA, username: "weakA", timestamp: RECENT },
      { type: "login", userId: weakB, username: "weakB", timestamp: RECENT }
    );
    const { db, collections } = makeFakeDb(seed);

    const result = await runAltScoring(db, { now: NOW, turn: 500, force: true });

    // The strong operator/burner cluster is still written...
    expect(result.clustersOpened).toBe(1);
    // ...but no cluster exists for weakA/weakB (dissimilar emails, no other
    // shared signal at all — buildAltLinks emits no edge for that pair, so
    // there is nothing for buildAltClusters to even connect).
    const clusters = collections.altClusters as Array<{ memberUserIds: ObjectId[] }>;
    const hasWeakPairCluster = clusters.some((c) => {
      const ids = c.memberUserIds.map((id) => id.toString());
      return ids.includes(weakA.toString()) && ids.includes(weakB.toString());
    });
    expect(hasWeakPairCluster).toBe(false);
  });

  it("is a no-op when the candidate pool is empty", async () => {
    const { db, collections } = makeFakeDb({
      users: [],
      characters: [],
      activityLog: [],
      actionLogs: [],
      suspiciousCharacters: [],
      financialTxLog: [],
      gameConfig: [],
      gameState: [],
      altLinks: [],
      altClusters: [],
    });

    const result = await runAltScoring(db, { now: NOW, force: true });

    expect(result.candidateCount).toBe(0);
    expect(result.linksWritten).toBe(0);
    expect(result.clustersWritten).toBe(0);
    expect(collections.altLinks).toHaveLength(0);
    expect(collections.altClusters).toHaveLength(0);
  });

  it("still prunes stale output when the candidate pool is empty", async () => {
    const staleAt = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000);
    const { db, collections } = makeFakeDb({
      users: [],
      characters: [],
      activityLog: [],
      actionLogs: [],
      suspiciousCharacters: [],
      financialTxLog: [],
      gameConfig: [],
      gameState: [],
      altLinks: [{ _id: new ObjectId(), updatedAt: staleAt }],
      altClusters: [{ _id: new ObjectId(), updatedAt: staleAt }],
    });

    await runAltScoring(db, { now: NOW, force: true });

    expect(collections.altLinks).toHaveLength(0);
    expect(collections.altClusters).toHaveLength(0);
  });

  it("clears prior-iteration matches and stamps rebuilt output with the active iteration", async () => {
    const seed = baseSeed();
    seed.gameState = [
      {
        _id: "current",
        currentTurn: 500,
        currentYear: 2026,
        iteration: { type: "Iteration", number: 4 },
      },
    ];
    seed.altLinks = [
      {
        _id: new ObjectId(),
        userA: operatorId,
        userB: bystanderId,
        confidence: 0.95,
        signals: [],
        updatedAt: RECENT,
        turn: 12,
        iterationKey: "Iteration:3",
      },
    ];
    seed.altClusters = [
      {
        _id: new ObjectId(),
        memberUserIds: [operatorId, bystanderId],
        confidence: 0.95,
        size: 2,
        signalSummary: [],
        roles: { burners: [], associates: [] },
        topEvidence: [],
        status: "open",
        updatedAt: RECENT,
        turn: 12,
        iterationKey: "Iteration:3",
      },
    ];

    const { db, collections } = makeFakeDb(seed);
    await runAltScoring(db, { now: NOW, force: true });

    expect(collections.altLinks).not.toHaveLength(0);
    expect(collections.altClusters).not.toHaveLength(0);
    expect(collections.altLinks.every((row) => row.iterationKey === "Iteration:4")).toBe(true);
    expect(collections.altClusters.every((row) => row.iterationKey === "Iteration:4")).toBe(true);
  });

  it("dry-run computes without writing to altLinks/altClusters", async () => {
    const { db, collections } = makeFakeDb(baseSeed());

    const result = await runAltScoring(db, { now: NOW, turn: 500, force: true, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.clustersComputed).toBe(1);
    // Reports what WOULD be written...
    expect(result.clustersWritten).toBe(1);
    expect(result.clustersOpened).toBe(1);
    // ...but nothing actually persisted.
    expect(collections.altLinks).toHaveLength(0);
    expect(collections.altClusters).toHaveLength(0);
  });

  it("does not emit a link when the only shared evidence is older than 30 days", async () => {
    const seed = baseSeed();
    const staleAt = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000);
    for (const user of seed.users.slice(0, 2)) {
      user.createdAt = staleAt;
      user.registrationFingerprintAt = staleAt;
    }

    const { db, collections } = makeFakeDb(seed);
    const result = await runAltScoring(db, { now: NOW, turn: 500, force: true });

    expect(result.error).toBeUndefined();
    expect(collections.altLinks).toHaveLength(0);
    expect(collections.altClusters).toHaveLength(0);
  });

  it("prunes stored links and clusters that were not reproduced for 30 days", async () => {
    const seed = baseSeed();
    const staleAt = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000);
    seed.users[0].registrationFingerprint = "fp-operator-now-distinct";
    seed.users[1].registrationFingerprint = "fp-burner-now-distinct";
    seed.altLinks = [
      {
        _id: new ObjectId(),
        userA: operatorId,
        userB: burnerId,
        confidence: 0.95,
        signals: [],
        updatedAt: staleAt,
        turn: 12,
      },
    ];
    seed.altClusters = [
      {
        _id: new ObjectId(),
        memberUserIds: [operatorId, burnerId],
        confidence: 0.95,
        size: 2,
        signalSummary: [],
        roles: { burners: [], associates: [] },
        topEvidence: [],
        status: "open",
        updatedAt: staleAt,
        turn: 12,
      },
    ];

    const { db, collections } = makeFakeDb(seed);
    const result = await runAltScoring(db, { now: NOW, turn: 500, force: true });

    expect(result.error).toBeUndefined();
    expect(collections.altLinks).toHaveLength(0);
    expect(collections.altClusters).toHaveLength(0);
  });

  it("does not prune stale stored matches during a dry run", async () => {
    const seed = baseSeed();
    const staleAt = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000);
    seed.altLinks = [
      {
        _id: new ObjectId(),
        userA: operatorId,
        userB: burnerId,
        confidence: 0.95,
        signals: [],
        updatedAt: staleAt,
        turn: 12,
      },
    ];
    seed.altClusters = [
      {
        _id: new ObjectId(),
        memberUserIds: [operatorId, burnerId],
        confidence: 0.95,
        size: 2,
        signalSummary: [],
        roles: { burners: [], associates: [] },
        topEvidence: [],
        status: "open",
        updatedAt: staleAt,
        turn: 12,
      },
    ];

    const { db, collections } = makeFakeDb(seed);
    await runAltScoring(db, { now: NOW, turn: 500, force: true, dryRun: true });

    expect(collections.altLinks).toHaveLength(1);
    expect(collections.altClusters).toHaveLength(1);
  });

  it("threads user.patreonUserId through buildCandidateFacets into a payment_correlation link", async () => {
    const payA = new ObjectId();
    const payB = new ObjectId();
    const seed = baseSeed();
    seed.users.push(
      {
        _id: payA,
        username: "payA",
        isBanned: false,
        patreonUserId: "patreon-cust-123",
        fingerprintHistory: [],
      },
      {
        _id: payB,
        username: "payB",
        isBanned: false,
        patreonUserId: "patreon-cust-123",
        fingerprintHistory: [],
      }
    );
    seed.activityLog.push(
      { type: "login", userId: payA, username: "payA", timestamp: RECENT },
      { type: "login", userId: payB, username: "payB", timestamp: RECENT }
    );
    const { db, collections } = makeFakeDb(seed);

    const result = await runAltScoring(db, { now: NOW, turn: 500, force: true });
    expect(result.error).toBeUndefined();

    const links = collections.altLinks as Array<{
      userA: ObjectId;
      userB: ObjectId;
      confidence: number;
      signals: Array<{ type: string }>;
    }>;
    const payLink = links.find((l) => {
      const ids = [String(l.userA), String(l.userB)];
      return ids.includes(payA.toString()) && ids.includes(payB.toString());
    });
    expect(payLink).toBeDefined();
    expect(payLink!.signals.some((s) => s.type === "payment_correlation")).toBe(true);
    expect(payLink!.confidence).toBeGreaterThan(0.6);
  });

  it("threads user.ipDetails.as through buildCandidateFacets into an ip_intelligence link on distinct IPs", async () => {
    const netA = new ObjectId();
    const netB = new ObjectId();
    const seed = baseSeed();
    seed.users.push(
      {
        _id: netA,
        username: "netA",
        isBanned: false,
        createdAt: RECENT_ACCOUNT,
        registrationIp: "203.0.113.10",
        ipDetails: {
          ip: "203.0.113.10",
          isHosting: true,
          isProxy: false,
          isVpn: false,
          as: "AS12345 Example Hosting",
        },
        fingerprintHistory: [],
      },
      {
        _id: netB,
        username: "netB",
        isBanned: false,
        createdAt: RECENT_ACCOUNT,
        registrationIp: "198.51.100.99",
        ipDetails: {
          ip: "198.51.100.99",
          isHosting: true,
          isProxy: false,
          isVpn: false,
          as: "AS12345 Example Hosting",
        },
        fingerprintHistory: [],
      }
    );
    seed.activityLog.push(
      { type: "login", userId: netA, username: "netA", timestamp: RECENT },
      { type: "login", userId: netB, username: "netB", timestamp: RECENT }
    );
    const { db, collections } = makeFakeDb(seed);

    const result = await runAltScoring(db, { now: NOW, turn: 500, force: true });
    expect(result.error).toBeUndefined();

    const links = collections.altLinks as Array<{
      userA: ObjectId;
      userB: ObjectId;
      signals: Array<{ type: string }>;
    }>;
    const netLink = links.find((l) => {
      const ids = [String(l.userA), String(l.userB)];
      return ids.includes(netA.toString()) && ids.includes(netB.toString());
    });
    expect(netLink).toBeDefined();
    expect(netLink!.signals.some((s) => s.type === "ip_intelligence")).toBe(true);
  });

  it("threads user.registrationCf/lastCf.ja4 through buildCandidateFacets into a cf_tls_fingerprint link", async () => {
    const tlsA = new ObjectId();
    const tlsB = new ObjectId();
    const seed = baseSeed();
    seed.users.push(
      {
        _id: tlsA,
        username: "tlsA",
        isBanned: false,
        createdAt: RECENT_ACCOUNT,
        registrationCf: { ja4: "t13d1516h2_8daaf6152771_shared" },
        fingerprintHistory: [],
      },
      {
        _id: tlsB,
        username: "tlsB",
        isBanned: false,
        createdAt: RECENT_ACCOUNT,
        // Captured later (lastCf, not registrationCf) — should still match.
        lastCf: { ja4: "t13d1516h2_8daaf6152771_shared" },
        fingerprintHistory: [],
      }
    );
    seed.activityLog.push(
      { type: "login", userId: tlsA, username: "tlsA", timestamp: RECENT },
      { type: "login", userId: tlsB, username: "tlsB", timestamp: RECENT }
    );
    const { db, collections } = makeFakeDb(seed);

    const result = await runAltScoring(db, { now: NOW, turn: 500, force: true });
    expect(result.error).toBeUndefined();

    const links = collections.altLinks as Array<{
      userA: ObjectId;
      userB: ObjectId;
      signals: Array<{ type: string }>;
    }>;
    const tlsLink = links.find((l) => {
      const ids = [String(l.userA), String(l.userB)];
      return ids.includes(tlsA.toString()) && ids.includes(tlsB.toString());
    });
    expect(tlsLink).toBeDefined();
    expect(tlsLink!.signals.some((s) => s.type === "cf_tls_fingerprint")).toBe(true);
  });

  it("does not fabricate a cf_tls_fingerprint link when neither account has a captured CF fingerprint", async () => {
    const { db, collections } = makeFakeDb(baseSeed());
    const result = await runAltScoring(db, { now: NOW, turn: 500, force: true });
    expect(result.error).toBeUndefined();
    const links = collections.altLinks as Array<{ signals: Array<{ type: string }> }>;
    expect(links.some((l) => l.signals.some((s) => s.type === "cf_tls_fingerprint"))).toBe(false);
  });

  // ── forensics-v2 Wave 3: link history + run telemetry ──────────────────

  it("stamps first-sighting tracking fields on a brand-new link", async () => {
    const { db, collections } = makeFakeDb(baseSeed());
    const result = await runAltScoring(db, { now: NOW, turn: 500, force: true });
    expect(result.error).toBeUndefined();

    const links = collections.altLinks as Array<Record<string, unknown>>;
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.firstDetectedAt).toEqual(NOW);
      expect(link.observationCount).toBe(1);
      expect(link.peakConfidence).toBe(link.confidence);
      // No prior run, so there is no previous value to report — writing the
      // current one would falsely read as "unchanged".
      expect(link.previousConfidence).toBeUndefined();
      expect(link.escalatedAt).toBeUndefined();
    }
    expect(result.newLinkCount).toBe(links.length);
    expect(result.escalationCount).toBe(0);
  });

  it("accumulates observation count and preserves the peak across repeated runs", async () => {
    const { db, collections } = makeFakeDb(baseSeed());
    await runAltScoring(db, { now: NOW, turn: 500, force: true });
    const firstPass = (collections.altLinks as Array<Record<string, unknown>>).map((l) => ({
      ...l,
    }));

    const later = new Date(NOW.getTime() + 60 * 60 * 1000);
    const second = await runAltScoring(db, { now: later, turn: 501, force: true });
    expect(second.error).toBeUndefined();
    // Same inputs => same pairs, updated in place rather than duplicated.
    expect(collections.altLinks).toHaveLength(firstPass.length);
    expect(second.newLinkCount).toBe(0);

    for (const link of collections.altLinks as Array<Record<string, unknown>>) {
      expect(link.observationCount).toBe(2);
      expect(link.firstDetectedAt).toEqual(NOW); // never overwritten
      expect(link.previousConfidence).toBe(link.confidence); // stable score
      expect(link.peakConfidence).toBe(link.confidence);
    }
  });

  it("marks a link escalated when its confidence jumps between runs", async () => {
    const seed = baseSeed();
    const escA = new ObjectId();
    const escB = new ObjectId();
    // Start the pair on a weak signal only: a shared /24 subnet.
    seed.users.push(
      {
        _id: escA,
        username: "escA",
        isBanned: false,
        createdAt: RECENT_ACCOUNT,
        lastKnownIp: "203.0.113.7",
        fingerprintHistory: [],
      },
      {
        _id: escB,
        username: "escB",
        isBanned: false,
        createdAt: RECENT_ACCOUNT,
        lastKnownIp: "203.0.113.9",
        fingerprintHistory: [],
      }
    );
    seed.activityLog.push(
      { type: "login", userId: escA, username: "escA", timestamp: RECENT },
      { type: "login", userId: escB, username: "escB", timestamp: RECENT }
    );

    const { db, collections } = makeFakeDb(seed);
    await runAltScoring(db, { now: NOW, turn: 500, force: true });

    const pairOf = () =>
      (collections.altLinks as Array<Record<string, unknown>>).find((l) => {
        const ids = [String(l.userA), String(l.userB)];
        return ids.includes(escA.toString()) && ids.includes(escB.toString());
      });
    // Snapshot the value — `pairOf()` returns the live store document, which
    // the second run updates in place.
    const confidenceBefore = pairOf()?.confidence as number;
    expect(confidenceBefore).toBeDefined();
    expect(confidenceBefore).toBeLessThan(0.3);

    // Now the two accounts turn up on the same device — a definitive signal
    // that should push the pair far past the escalation delta.
    const later = new Date(NOW.getTime() + 60 * 60 * 1000);
    const users = collections.users as Array<Record<string, unknown>>;
    for (const u of users) {
      if (String(u._id) === escA.toString() || String(u._id) === escB.toString()) {
        u.deviceKey = "shared-device-key";
        u.deviceKeyAt = later;
      }
    }

    const second = await runAltScoring(db, { now: later, turn: 501, force: true });
    const after = pairOf()!;

    expect(after.confidence as number).toBeGreaterThan(0.9);
    expect(after.previousConfidence).toBe(confidenceBefore);
    expect(after.escalatedAt).toEqual(later);
    expect(after.observationCount).toBe(2);
    expect(second.escalationCount).toBeGreaterThanOrEqual(1);
  });

  it("writes a run telemetry record with the confidence distribution and signal stats", async () => {
    const { db, collections } = makeFakeDb(baseSeed());
    const result = await runAltScoring(db, { now: NOW, turn: 500, force: true });
    expect(result.error).toBeUndefined();

    const runs = collections.altScoringRuns as Array<Record<string, unknown>>;
    expect(runs).toHaveLength(1);
    const record = runs[0];
    expect(record.at).toEqual(NOW);
    expect(record.turn).toBe(500);
    expect(record.dryRun).toBe(false);
    expect(record.candidateCount).toBe(result.candidateCount);
    expect(record.linksComputed).toBe(result.linksComputed);
    expect(record.candidatePoolTruncated).toBe(false);
    expect(record.confidenceHistogram).toHaveLength(10);
    expect((record.confidenceHistogram as number[]).reduce((a, b) => a + b, 0)).toBe(
      result.linksComputed
    );
    expect(Array.isArray(record.signalStats)).toBe(true);
    expect(record.newLinkCount).toBe(result.newLinkCount);
  });

  it("records a run even when no candidates were found, so a silent stall is visible", async () => {
    // Empty world: no logins, no action rows, no flagged characters.
    const { db, collections } = makeFakeDb({
      users: [],
      activityLog: [],
      characters: [],
      actionLogs: [],
      suspiciousCharacters: [],
    });
    const result = await runAltScoring(db, { now: NOW, turn: 500, force: true });
    expect(result.candidateCount).toBe(0);

    const runs = collections.altScoringRuns as Array<Record<string, unknown>>;
    expect(runs).toHaveLength(1);
    expect(runs[0].candidateCount).toBe(0);
    expect(runs[0].linksComputed).toBe(0);
  });

  it("does not persist links or clusters on a dry run, but still records the run", async () => {
    const { db, collections } = makeFakeDb(baseSeed());
    const result = await runAltScoring(db, { now: NOW, turn: 500, force: true, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.linksWritten).toBeGreaterThan(0); // what WOULD have been written
    expect(collections.altLinks ?? []).toHaveLength(0);

    const runs = collections.altScoringRuns as Array<Record<string, unknown>>;
    expect(runs).toHaveLength(1);
    expect(runs[0].dryRun).toBe(true);
  });

  it("reports enabled:false and no-ops when the altScoringEnabled kill-switch is explicitly off", async () => {
    // Alt scoring is ON by default now; the flag is a kill-switch. Feed a
    // config that explicitly sets it false and confirm we no-op without force.
    resetAltScoringFlagCache();
    vi.mocked(getDb).mockResolvedValueOnce({
      collection: () => ({
        findOne: async () => ({ _id: "default", altScoringEnabled: false }),
      }),
    } as unknown as Db);
    const { db } = makeFakeDb(baseSeed());
    const result = await runAltScoring(db, { now: NOW });
    expect(result.enabled).toBe(false);
    expect(result.candidateCount).toBe(0);
    expect(result.error).toBeUndefined();
    resetAltScoringFlagCache();
  });
});
