/**
 * Tests for the account-deletion command kernel.
 *
 * Default tests run against an in-memory fake implementing the kernel's
 * narrow store surface with real Mongo match semantics for the operators the
 * kernel emits ($exists, $ne, $gt, $gte, $lt, $lte, $in, $and, $type, exact
 * match, and $expr against $$NOW read from a controllable fake database
 * clock). The opt-in real-Mongo block at the bottom (env-gated, ephemeral
 * `mongod` on a random port/dir, never a configured database) repeats the
 * lifecycle plus the wall-clock expiry races.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Filter, type UpdateFilter } from "mongodb";
import type { User } from "@/lib/db/types/user";
import {
  asWellFormedCommand,
  checkpointDeletion,
  claimCommand,
  confirmDeletionCompleted,
  DELETION_LEASE_TTL_MS,
  hasDeletionMarker,
  isFreshVerifiedIat,
  readDeletionCommand,
  renewLease,
  reserveDeletion,
  type DeletionCommandStore,
  type VerifiedDeletionCaller,
} from "./deletionCommand";

// ── Minimal deep clone preserving Date/ObjectId prototypes ─────────────────
// Test scaffolding only. The two downcasts below walk schemaless fake docs;
// the kernel itself carries no casts.

function cloneValue<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value instanceof ObjectId) return new ObjectId(value.toHexString()) as T;
  if (Array.isArray(value)) return value.map(cloneValue) as T;
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    const rec = value as Record<string, unknown>;
    for (const key of Object.keys(rec)) out[key] = cloneValue(rec[key]);
    return out as T;
  }
  return value;
}

function idToHex(value: unknown): string | null {
  if (value instanceof ObjectId) return value.toHexString();
  return null;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  const aHex = idToHex(a);
  const bHex = idToHex(b);
  if (aHex !== null || bHex !== null) return aHex !== null && aHex === bHex;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const ka = Object.keys(ra);
    if (ka.length !== Object.keys(rb).length) return false;
    return ka.every((k) => Object.hasOwn(rb, k) && valuesEqual(ra[k], rb[k]));
  }
  return Object.is(a, b);
}

function getPath(doc: unknown, path: string): { found: boolean; value: unknown } {
  let cur: unknown = doc;
  for (const part of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return { found: false, value: undefined };
    const rec = cur as Record<string, unknown>;
    if (!Object.hasOwn(rec, part)) return { found: false, value: undefined };
    cur = rec[part];
  }
  return { found: true, value: cur };
}

function matchesCondition(found: boolean, value: unknown, cond: unknown): boolean {
  if (
    typeof cond === "object" &&
    cond !== null &&
    !(cond instanceof Date) &&
    !(cond instanceof ObjectId) &&
    !Array.isArray(cond) &&
    Object.keys(cond).some((k) => k.startsWith("$"))
  ) {
    const ops = cond as Record<string, unknown>;
    for (const [op, arg] of Object.entries(ops)) {
      if (op === "$exists") {
        if (found !== (arg === true)) return false;
      } else if (op === "$ne") {
        if (found && valuesEqual(value, arg)) return false;
        if (!found && arg === null) return false;
      } else if (op === "$gt") {
        if (!found) return false;
        if (value instanceof Date && arg instanceof Date) {
          if (!(value.getTime() > arg.getTime())) return false;
        } else if (typeof value === "number" && typeof arg === "number") {
          if (!(value > arg)) return false;
        } else return false;
      } else if (op === "$gte") {
        if (!found) return false;
        if (value instanceof Date && arg instanceof Date) {
          if (!(value.getTime() >= arg.getTime())) return false;
        } else if (typeof value === "number" && typeof arg === "number") {
          if (!(value >= arg)) return false;
        } else return false;
      } else if (op === "$lte") {
        if (!found) return false;
        if (value instanceof Date && arg instanceof Date) {
          if (!(value.getTime() <= arg.getTime())) return false;
        } else if (typeof value === "number" && typeof arg === "number") {
          if (!(value <= arg)) return false;
        } else return false;
      } else if (op === "$lt") {
        if (!found) return false;
        if (value instanceof Date && arg instanceof Date) {
          if (!(value.getTime() < arg.getTime())) return false;
        } else if (typeof value === "number" && typeof arg === "number") {
          if (!(value < arg)) return false;
        } else return false;
      } else if (op === "$in") {
        if (!Array.isArray(arg)) return false;
        if (!arg.some((entry) => valuesEqual(value, entry))) return false;
      } else if (op === "$type") {
        if (arg === "null" && value !== null) return false;
      } else {
        return false;
      }
    }
    return true;
  }
  // Bare null matches missing or explicit null, like Mongo.
  if (cond === null) return !found || value === null;
  if (!found) return false;
  return valuesEqual(value, cond);
}

function resolveExprOperand(operand: unknown, doc: unknown, dbNow: Date): unknown {
  if (operand === "$$NOW") return dbNow;
  if (typeof operand === "string" && operand.startsWith("$") && !operand.startsWith("$$")) {
    const hit = getPath(doc, operand.slice(1));
    return hit.found ? hit.value : undefined;
  }
  return operand;
}

function compareExprOperands(op: string, left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return false;
  if (left instanceof Date && right instanceof Date) {
    const a = left.getTime();
    const b = right.getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (op === "$gt") return a > b;
    if (op === "$gte") return a >= b;
    if (op === "$lt") return a < b;
    if (op === "$lte") return a <= b;
    if (op === "$eq") return a === b;
    return false;
  }
  if (typeof left === "number" && typeof right === "number") {
    if (op === "$gt") return left > right;
    if (op === "$gte") return left >= right;
    if (op === "$lt") return left < right;
    if (op === "$lte") return left <= right;
    if (op === "$eq") return Object.is(left, right);
    return false;
  }
  if (op === "$eq") return valuesEqual(left, right);
  return false;
}

function evalExpr(expr: unknown, doc: unknown, dbNow: Date): boolean {
  if (typeof expr !== "object" || expr === null || Array.isArray(expr)) return false;
  for (const [op, arg] of Object.entries(expr as Record<string, unknown>)) {
    if (op === "$and") {
      if (!Array.isArray(arg) || !arg.every((sub) => evalExpr(sub, doc, dbNow))) return false;
    } else if (op === "$or") {
      if (!Array.isArray(arg) || !arg.some((sub) => evalExpr(sub, doc, dbNow))) return false;
    } else if (op === "$gt" || op === "$gte" || op === "$lt" || op === "$lte" || op === "$eq") {
      if (!Array.isArray(arg) || arg.length !== 2) return false;
      const left = resolveExprOperand(arg[0], doc, dbNow);
      const right = resolveExprOperand(arg[1], doc, dbNow);
      if (!compareExprOperands(op, left, right)) return false;
    } else {
      return false;
    }
  }
  return true;
}

function matchesFilter(doc: unknown, filter: Filter<User>, dbNow: Date): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === "$and") {
      if (!Array.isArray(cond)) return false;
      if (!cond.every((sub) => matchesFilter(doc, sub as Filter<User>, dbNow))) return false;
      continue;
    }
    if (key === "$expr") {
      if (!evalExpr(cond, doc, dbNow)) return false;
      continue;
    }
    const hit = getPath(doc, key);
    if (!matchesCondition(hit.found, hit.value, cond)) return false;
  }
  return true;
}

function setPath(doc: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = cloneValue(value);
}

function compareForMax(a: unknown, b: unknown): number | null {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return null;
}

const T0 = new Date("2026-09-01T12:00:00.000Z");
const iatOf = (d: Date): number => Math.floor(d.getTime() / 1000);

/** Deterministic valid UUID per tag so tests satisfy the kernel's strict id shape. */
function rid(tag: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const ch of tag) {
    a = Math.imul(a ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    b = Math.imul(b + ch.charCodeAt(0), 0x85ebca6b) >>> 0;
  }
  const tail = (a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")).slice(0, 12);
  return `11111111-1111-4111-8111-${tail}`;
}

class FakeDeletionStore implements DeletionCommandStore {
  private docs = new Map<string, unknown>();
  /** Fake database clock: `$expr` guards read `$$NOW` from here, not wall time. */
  dbNow: Date = new Date(T0.getTime());
  acknowledgedNext: boolean | null = null;
  throwNext: unknown = null;
  /** When false, an unacknowledged/throwing write is dropped (clean failure). */
  applyOnAmbiguous = true;
  updateCalls = 0;

  seed(doc: unknown, hex: string): void {
    this.docs.set(hex, cloneValue(doc));
  }

  read(hex: string): unknown {
    return cloneValue(this.docs.get(hex));
  }

  async findOne(filter: Filter<User>): Promise<User | null> {
    for (const doc of this.docs.values()) {
      // Test fake only: seeds are caller-built docs; the kernel never casts.
      if (matchesFilter(doc, filter, this.dbNow)) return cloneValue(doc as User);
    }
    return null;
  }

  async updateOne(
    filter: Filter<User>,
    update: UpdateFilter<User>
  ): Promise<{ acknowledged: boolean; matchedCount: number }> {
    this.updateCalls++;
    let matchedKey: string | null = null;
    for (const [hex, doc] of this.docs) {
      if (matchesFilter(doc, filter, this.dbNow)) {
        matchedKey = hex;
        break;
      }
    }
    const ack = this.acknowledgedNext ?? true;
    this.acknowledgedNext = null;
    const boom = this.throwNext;
    this.throwNext = null;
    if (matchedKey !== null && (ack || this.applyOnAmbiguous)) {
      const ops = update as unknown as Record<string, Record<string, unknown>>;
      const stored = this.docs.get(matchedKey) as Record<string, unknown>;
      if (ops.$set) {
        for (const [path, value] of Object.entries(ops.$set)) setPath(stored, path, value);
      }
      if (ops.$max) {
        for (const [path, value] of Object.entries(ops.$max)) {
          const hit = getPath(stored, path);
          const cmp = hit.found ? compareForMax(value, hit.value) : 1;
          if (!hit.found || (cmp !== null && cmp > 0)) setPath(stored, path, value);
        }
      }
    }
    if (boom !== null && boom !== undefined) throw boom;
    return { acknowledged: ack, matchedCount: matchedKey === null ? 0 : 1 };
  }
}

// ── Fixtures ───────────────────────────────────────────────────────────────

let userCounter = 1;

function makeUser(overrides?: Partial<User>): User {
  const n = userCounter++;
  return {
    _id: new ObjectId(n.toString(16).padStart(24, "0")),
    email: `user${n}@example.invalid`,
    username: `user${n}`,
    displayName: `User ${n}`,
    password: `hash-${n}`,
    role: "player",
    hasCompletedSetup: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function callerFor(user: User, now: Date, iat?: number): VerifiedDeletionCaller {
  return { userId: user._id.toHexString(), iat: iat ?? iatOf(now) };
}

function seedStore(user: User): { store: FakeDeletionStore; hex: string } {
  const store = new FakeDeletionStore();
  const hex = user._id.toHexString();
  store.seed(user, hex);
  return { store, hex };
}

describe("admission authorization", () => {
  it("admits one command, freezes audit fields, and evicts the cache twice", async () => {
    const user = makeUser();
    const { store, hex } = seedStore(user);
    const invalidated: string[] = [];
    const res = await reserveDeletion(store, {
      userId: user._id,
      snapshot: user,
      caller: callerFor(user, T0),
      now: T0,
      reservationId: rid("res-1"),
      onInvalidate: (id) => invalidated.push(id),
    });
    expect(res).toEqual({ ok: true, reservationId: rid("res-1"), requestedAt: T0 });
    expect(invalidated).toEqual([hex, hex]);
    const stored = (await store.findOne({ _id: user._id })) as User;
    const cmd = asWellFormedCommand(stored.accountDeletion);
    expect(cmd).toMatchObject({
      state: "reserved",
      reservationId: rid("res-1"),
      requestedBySessionIat: iatOf(T0),
    });
    expect(cmd?.requestedAt.getTime()).toBe(T0.getTime());
    // The marker carries no credential, token, or identity material.
    expect(Object.keys(stored.accountDeletion as object).sort()).toEqual(
      ["requestedAt", "requestedBySessionIat", "reservationId", "state", "updatedAt"].sort()
    );
    // Admission revokes the authorizing session for everything after it.
    expect(stored.authRevokedAt?.getTime()).toBeGreaterThanOrEqual(T0.getTime());
  });

  it("denies every non-authorizing caller and writes nothing", async () => {
    const user = makeUser();
    const badNow = new Date(NaN);
    const cases: Array<{
      name: string;
      snapshot: User;
      caller?: VerifiedDeletionCaller | null;
      now: Date;
      denial: string;
    }> = [
      { name: "null proof", snapshot: user, caller: null, now: T0, denial: "principal" },
      {
        name: "wrong account",
        snapshot: user,
        caller: { userId: new ObjectId().toHexString(), iat: iatOf(T0) },
        now: T0,
        denial: "principal",
      },
      {
        name: "stale proof",
        snapshot: user,
        caller: callerFor(user, T0, iatOf(T0) - 3600),
        now: T0,
        denial: "proof",
      },
      {
        name: "future proof",
        snapshot: user,
        caller: callerFor(user, T0, iatOf(T0) + 3600),
        now: T0,
        denial: "proof",
      },
      {
        name: "non-integer proof",
        snapshot: user,
        caller: callerFor(user, T0, 1.5),
        now: T0,
        denial: "proof",
      },
      {
        name: "bad clock",
        snapshot: user,
        caller: callerFor(user, T0),
        now: badNow,
        denial: "proof",
      },
      {
        name: "admin role snapshot",
        snapshot: makeUser({ role: "admin" }),
        now: T0,
        denial: "admin",
      },
      {
        name: "banned snapshot",
        snapshot: makeUser({ isBanned: true }),
        now: T0,
        denial: "banned",
      },
      {
        name: "revoked snapshot",
        snapshot: makeUser({ authRevokedAt: T0 }),
        now: T0,
        denial: "revoked",
      },
      {
        name: "malformed cutoff fails closed",
        snapshot: makeUser({ authRevokedAt: "yesterday" as unknown as Date }),
        now: T0,
        denial: "revoked",
      },
    ];
    for (const c of cases) {
      const snap = c.snapshot;
      const hex = snap._id.toHexString();
      const store = new FakeDeletionStore();
      store.seed(snap, hex);
      const caller =
        c.caller !== undefined
          ? c.caller
          : ({ userId: hex, iat: iatOf(T0) } satisfies VerifiedDeletionCaller);
      const res = await reserveDeletion(store, {
        userId: snap._id,
        snapshot: snap,
        caller,
        now: c.now,
        reservationId: rid(`tag-${c.name}`),
        onInvalidate: () => {},
      });
      expect(res, c.name).toEqual({ ok: false, reason: "denied", denial: c.denial });
      expect(hasDeletionMarker(store.read(hex) as object), c.name).toBe(false);
      expect(store.updateCalls, c.name).toBe(0);
    }
  });

  it("lets the current snapshot overrule a stale staff-looking payload", async () => {
    // Privilege derives from the live row, never from token claims.
    const promoted = makeUser({ role: "player", isAdmin: true });
    const { store } = seedStore(promoted);
    const res = await reserveDeletion(store, {
      userId: promoted._id,
      snapshot: promoted,
      caller: callerFor(promoted, T0),
      now: T0,
      reservationId: rid("res-admin"),
      onInvalidate: () => {},
    });
    expect(res).toEqual({ ok: false, reason: "denied", denial: "admin" });

    const fenced = makeUser({ authMigrationFence: { operationId: "op-1" } });
    const fencedStore = seedStore(fenced).store;
    const fencedRes = await reserveDeletion(fencedStore, {
      userId: fenced._id,
      snapshot: fenced,
      caller: callerFor(fenced, T0),
      now: T0,
      reservationId: rid("res-fenced"),
      onInvalidate: () => {},
    });
    expect(fencedRes).toEqual({ ok: false, reason: "denied", denial: "fenced" });
  });

  it("blocks admission over any present marker shape without writing", async () => {
    const markers: unknown[] = [
      {
        state: "reserved",
        reservationId: rid("other"),
        requestedAt: T0,
        requestedBySessionIat: iatOf(T0),
        updatedAt: T0,
      },
      null,
      "deleted",
      {},
      { state: "reserved" },
    ];
    for (const marker of markers) {
      const hex = new ObjectId().toHexString();
      const store = new FakeDeletionStore();
      const user = makeUser({ _id: new ObjectId(hex) });
      store.seed({ ...user, accountDeletion: marker }, hex);
      const res = await reserveDeletion(store, {
        userId: user._id,
        snapshot: user,
        caller: callerFor(user, T0),
        now: T0,
        reservationId: rid("res-new"),
        onInvalidate: () => {},
      });
      // Snapshot predates the marker, so the CAS is what blocks: conflict, no write.
      expect(res, JSON.stringify(marker)).toEqual({ ok: false, reason: "conflict" });
      expect((store.read(hex) as Record<string, unknown>).accountDeletion).toEqual(marker);
    }
  });

  it("loses every concurrent snapshot race with zero side effects", async () => {
    const mutations: Array<{ name: string; mutate: (u: User) => void }> = [
      { name: "password", mutate: (u) => void (u.password = "rotated") },
      { name: "google link", mutate: (u) => void (u.googleId = "g-1") },
      { name: "discord link", mutate: (u) => void (u.discordId = "d-1") },
      { name: "role grant", mutate: (u) => void (u.role = "admin") },
      { name: "flag grant", mutate: (u) => void (u.isAdmin = true) },
      { name: "ban", mutate: (u) => void (u.isBanned = true) },
      {
        name: "revocation",
        mutate: (u) => void (u.authRevokedAt = new Date(T0.getTime() + 1000)),
      },
      {
        name: "fence",
        mutate: (u) => void (u.authMigrationFence = { operationId: "op" }),
      },
    ];
    for (const m of mutations) {
      const user = makeUser();
      const hex = user._id.toHexString();
      const store = new FakeDeletionStore();
      store.seed(user, hex);
      const snapshot = cloneValue(user);
      m.mutate(user);
      store.seed(user, hex);
      const res = await reserveDeletion(store, {
        userId: user._id,
        snapshot,
        caller: callerFor(user, T0),
        now: T0,
        reservationId: rid(`tag-${m.name}`),
        onInvalidate: () => {},
      });
      expect(res, m.name).toEqual({ ok: false, reason: "conflict" });
      expect(hasDeletionMarker(store.read(hex) as object), m.name).toBe(false);
    }
  });

  it("resolves an ambiguous ack only by the exact reservation id", async () => {
    const user = makeUser();
    const hex = user._id.toHexString();
    // Write committed but the ack was lost: the owner still confirms.
    const committed = seedStore(user).store;
    committed.applyOnAmbiguous = true;
    committed.acknowledgedNext = false;
    const own = await reserveDeletion(committed, {
      userId: user._id,
      snapshot: user,
      caller: callerFor(user, T0),
      now: T0,
      reservationId: rid("res-own"),
      onInvalidate: () => {},
    });
    expect(own).toEqual({ ok: true, reservationId: rid("res-own"), requestedAt: T0 });

    // Ack lost and nothing committed: unavailable, never assumed.
    const dropped = seedStore(cloneValue(user)).store;
    dropped.applyOnAmbiguous = false;
    dropped.acknowledgedNext = false;
    const lost = await reserveDeletion(dropped, {
      userId: user._id,
      snapshot: cloneValue(user),
      caller: callerFor(user, T0),
      now: T0,
      reservationId: rid("res-lost"),
      onInvalidate: () => {},
    });
    expect(lost).toEqual({ ok: false, reason: "unavailable" });

    // A competing reservation committed under the ambiguity: conflict.
    const raced = seedStore(cloneValue(user)).store;
    raced.applyOnAmbiguous = false;
    raced.acknowledgedNext = false;
    const live = (await raced.findOne({ _id: user._id })) as User;
    live.accountDeletion = {
      state: "reserved",
      reservationId: rid("res-rival"),
      requestedAt: T0,
      requestedBySessionIat: iatOf(T0),
      updatedAt: T0,
    };
    raced.seed(live, hex);
    const rival = await reserveDeletion(raced, {
      userId: user._id,
      snapshot: cloneValue(user),
      caller: callerFor(user, T0),
      now: T0,
      reservationId: rid("res-ours"),
      onInvalidate: () => {},
    });
    expect(rival).toEqual({ ok: false, reason: "conflict" });

    // Throw with commit still resolves; throw without commit is unavailable.
    const thrown = seedStore(cloneValue(user)).store;
    thrown.applyOnAmbiguous = true;
    thrown.throwNext = new Error("transport down");
    const survived = await reserveDeletion(thrown, {
      userId: user._id,
      snapshot: cloneValue(user),
      caller: callerFor(user, T0),
      now: T0,
      reservationId: rid("res-thrown"),
      onInvalidate: () => {},
    });
    expect(survived.ok).toBe(true);
  });

  it("denies token reuse after admission and stays single-flight", async () => {
    const user = makeUser();
    const hex = user._id.toHexString();
    const store = new FakeDeletionStore();
    store.seed(user, hex);
    const first = await reserveDeletion(store, {
      userId: user._id,
      snapshot: cloneValue(user),
      caller: callerFor(user, T0),
      now: T0,
      reservationId: rid("res-first"),
      onInvalidate: () => {},
    });
    expect(first.ok).toBe(true);

    // Same session retries: the admission revoked it, so the proof is stale.
    const reread = (await store.findOne({ _id: user._id })) as User;
    const replay = await reserveDeletion(store, {
      userId: user._id,
      snapshot: reread,
      caller: callerFor(user, T0),
      now: T0,
      reservationId: rid("res-replay"),
      onInvalidate: () => {},
    });
    expect(replay).toEqual({ ok: false, reason: "denied", denial: "revoked" });

    // Even a fresh proof cannot open a second command over the marker.
    const later = new Date(T0.getTime() + 60_000);
    const second = await reserveDeletion(store, {
      userId: user._id,
      snapshot: reread,
      caller: { userId: hex, iat: iatOf(later) },
      now: later,
      reservationId: rid("res-second"),
      onInvalidate: () => {},
    });
    expect(second).toEqual({ ok: false, reason: "conflict" });
  });
});

async function reserveOk(
  store: FakeDeletionStore,
  user: User,
  now: Date,
  reservationId: string
): Promise<void> {
  const snapshot = (await store.findOne({ _id: user._id })) as User;
  const res = await reserveDeletion(store, {
    userId: user._id,
    snapshot,
    caller: { userId: user._id.toHexString(), iat: iatOf(now) },
    now,
    reservationId,
    onInvalidate: () => {},
  });
  expect(res.ok).toBe(true);
}

describe("worker lease fencing", () => {
  it("runs claim, renew, checkpoint, and complete under one held lease", async () => {
    const user = makeUser();
    const { store } = seedStore(user);
    await reserveOk(store, user, T0, rid("res-life"));

    const claim = await claimCommand(store, {
      userId: user._id,
      reservationId: rid("res-life"),
      workerId: "worker-a",
      now: T0,
      onInvalidate: () => {},
    });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.generation).toBe(0);
    expect(claim.leaseExpiresAt.getTime()).toBe(T0.getTime() + DELETION_LEASE_TTL_MS);

    // A second worker loses against the live lease.
    const rival = await claimCommand(store, {
      userId: user._id,
      reservationId: rid("res-life"),
      workerId: "worker-b",
      now: T0,
      onInvalidate: () => {},
    });
    expect(rival).toEqual({ ok: false, reason: "conflict" });

    const mid = new Date(T0.getTime() + 30_000);
    const renewed = await renewLease(store, {
      userId: user._id,
      reservationId: rid("res-life"),
      workerId: "worker-a",
      generation: 0,
      now: mid,
      onInvalidate: () => {},
    });
    expect(renewed.ok).toBe(true);

    const checkpoint = await checkpointDeletion(store, {
      userId: user._id,
      reservationId: rid("res-life"),
      workerId: "worker-a",
      generation: 0,
      now: mid,
      onInvalidate: () => {},
    });
    expect(checkpoint).toEqual({ ok: true });
    expect(readDeletionCommand((await store.findOne({ _id: user._id })) as User)?.state).toBe(
      "cascading"
    );

    const done = await confirmDeletionCompleted(store, {
      userId: user._id,
      reservationId: rid("res-life"),
      workerId: "worker-a",
      generation: 0,
      now: mid,
      onInvalidate: () => {},
    });
    expect(done).toEqual({ ok: true });

    // Terminal: no reclaim, no new reservation, row still present.
    const after = (await store.findOne({ _id: user._id })) as User;
    expect(after.accountDeletion?.state).toBe("complete");
    expect(after.accountDeletion?.reservationId).toBe(rid("res-life"));
    expect(
      await claimCommand(store, {
        userId: user._id,
        reservationId: rid("res-life"),
        workerId: "worker-b",
        now: new Date(mid.getTime() + 10 * 60_000),
        onInvalidate: () => {},
      })
    ).toEqual({ ok: false, reason: "denied" });
  });

  it("reclaims an expired lease at generation + 1 and freezes out the stale holder", async () => {
    const user = makeUser();
    const { store } = seedStore(user);
    await reserveOk(store, user, T0, rid("res-reclaim"));
    const first = await claimCommand(store, {
      userId: user._id,
      reservationId: rid("res-reclaim"),
      workerId: "worker-a",
      now: T0,
      leaseTtlMs: 5_000,
      onInvalidate: () => {},
    });
    expect(first.ok).toBe(true);

    const afterExpiry = new Date(T0.getTime() + 30_000);
    store.dbNow = new Date(afterExpiry.getTime());
    const reclaim = await claimCommand(store, {
      userId: user._id,
      reservationId: rid("res-reclaim"),
      workerId: "worker-b",
      now: afterExpiry,
      onInvalidate: () => {},
    });
    expect(reclaim.ok).toBe(true);
    if (!reclaim.ok) return;
    expect(reclaim.generation).toBe(1);

    // Stale generation cannot renew, checkpoint, or complete.
    const staleBase = {
      userId: user._id,
      reservationId: rid("res-reclaim"),
      workerId: "worker-a",
      generation: 0,
      now: afterExpiry,
      onInvalidate: () => {},
    };
    expect(await renewLease(store, staleBase)).toEqual({ ok: false, reason: "conflict" });
    expect(await checkpointDeletion(store, staleBase)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await confirmDeletionCompleted(store, staleBase)).toEqual({
      ok: false,
      reason: "conflict",
    });

    // The new holder advances.
    expect(
      await checkpointDeletion(store, { ...staleBase, workerId: "worker-b", generation: 1 })
    ).toEqual({ ok: true });
  });

  it("pins every fencing field on each advance", async () => {
    const user = makeUser();
    const { store } = seedStore(user);
    await reserveOk(store, user, T0, rid("res-pin"));
    await claimCommand(store, {
      userId: user._id,
      reservationId: rid("res-pin"),
      workerId: "worker-a",
      now: T0,
      onInvalidate: () => {},
    });
    const good = {
      userId: user._id,
      reservationId: rid("res-pin"),
      workerId: "worker-a",
      generation: 0,
      now: T0,
      onInvalidate: () => {},
    };
    expect(await renewLease(store, { ...good, workerId: "worker-x" })).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await renewLease(store, { ...good, generation: 7 })).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await renewLease(store, { ...good, reservationId: rid("res-nope") })).toEqual({
      ok: false,
      reason: "conflict",
    });
    // Past the deadline the lease is dead: renew is a conflict, never an extension.
    const expired = new Date(T0.getTime() + DELETION_LEASE_TTL_MS + 1000);
    store.dbNow = new Date(expired.getTime());
    expect(await renewLease(store, { ...good, now: expired })).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await checkpointDeletion(store, { ...good, now: expired })).toEqual({
      ok: false,
      reason: "conflict",
    });
    // Completing straight from reserved without the cascade checkpoint is rejected.
    expect(await confirmDeletionCompleted(store, good)).toEqual({
      ok: false,
      reason: "conflict",
    });
  });

  it("rejects unbounded or degenerate lease input without writing", async () => {
    const user = makeUser();
    const { store } = seedStore(user);
    await reserveOk(store, user, T0, rid("res-ttl"));
    const base = {
      userId: user._id,
      reservationId: rid("res-ttl"),
      workerId: "",
      now: T0,
      onInvalidate: () => {},
    };
    expect(await claimCommand(store, base)).toEqual({ ok: false, reason: "denied" });
    expect(await claimCommand(store, { ...base, workerId: "w", leaseTtlMs: 100 })).toEqual({
      ok: false,
      reason: "denied",
    });
    expect(await claimCommand(store, { ...base, workerId: "w", leaseTtlMs: Number.NaN })).toEqual({
      ok: false,
      reason: "denied",
    });
    expect(
      await claimCommand(store, {
        ...base,
        workerId: "w",
        leaseTtlMs: Number.POSITIVE_INFINITY,
      })
    ).toEqual({ ok: false, reason: "denied" });
    expect(await claimCommand(store, { ...base, workerId: "w", reservationId: "nope" })).toEqual({
      ok: false,
      reason: "denied",
    });
    expect(await claimCommand(store, { ...base, workerId: "bad\nworker" })).toEqual({
      ok: false,
      reason: "denied",
    });
    expect(await claimCommand(store, { ...base, workerId: "w".repeat(129) })).toEqual({
      ok: false,
      reason: "denied",
    });
    expect(
      await renewLease(store, {
        userId: user._id,
        reservationId: rid("res-ttl"),
        workerId: "w".repeat(129),
        generation: 0,
        now: T0,
        onInvalidate: () => {},
      })
    ).toEqual({ ok: false, reason: "denied" });
    expect(store.updateCalls).toBe(1);
  });

  it("fails closed on malformed markers and never reclaims them", async () => {
    const malformed: unknown[] = [
      null,
      "gone",
      {},
      { state: "reserved" },
      {
        state: "reserved",
        reservationId: rid("res-x"),
        requestedAt: T0,
        requestedBySessionIat: iatOf(T0),
        updatedAt: T0,
        leaseExpiresAt: new Date(T0.getTime() + 60_000),
      },
      {
        state: "reserved",
        reservationId: rid("res-x"),
        requestedAt: T0,
        requestedBySessionIat: iatOf(T0),
        updatedAt: T0,
        workerId: "worker-a",
      },
      {
        state: "reserved",
        reservationId: rid("res-x"),
        requestedAt: T0,
        requestedBySessionIat: iatOf(T0),
        updatedAt: T0,
        workerId: "worker-a",
        workerGeneration: "zero" as unknown as number,
        leaseExpiresAt: new Date(T0.getTime() + 60_000),
      },
      {
        state: "reserved",
        reservationId: "not-a-uuid",
        requestedAt: T0,
        requestedBySessionIat: iatOf(T0),
        updatedAt: T0,
      },
      {
        state: "cascading",
        reservationId: rid("res-x"),
        requestedAt: T0,
        requestedBySessionIat: iatOf(T0),
        updatedAt: T0,
      },
      {
        state: "reserved",
        reservationId: rid("res-x"),
        requestedAt: T0,
        requestedBySessionIat: iatOf(T0),
        updatedAt: T0,
        workerId: "bad\nworker",
        workerGeneration: 0,
        leaseExpiresAt: new Date(T0.getTime() + 60_000),
      },
      {
        state: "reserved",
        reservationId: rid("res-x"),
        requestedAt: T0,
        requestedBySessionIat: iatOf(T0),
        updatedAt: T0,
        injected: "malicious",
      },
      {
        state: "reserved",
        reservationId: rid("res-x"),
        requestedAt: T0,
        requestedBySessionIat: iatOf(T0),
        updatedAt: T0,
        workerId: "worker-a",
        workerGeneration: 0,
        leaseExpiresAt: new Date(T0.getTime() + 60_000),
        injected: 1,
      },
      {
        state: "vaporized" as unknown as string,
        reservationId: rid("res-x"),
        requestedAt: T0,
        requestedBySessionIat: iatOf(T0),
        updatedAt: T0,
      },
    ];
    for (const marker of malformed) {
      const hex = new ObjectId().toHexString();
      const store = new FakeDeletionStore();
      const user = makeUser({ _id: new ObjectId(hex) });
      store.seed({ ...user, accountDeletion: marker }, hex);
      const res = await claimCommand(store, {
        userId: user._id,
        reservationId: rid("res-x"),
        workerId: "worker-b",
        now: new Date(T0.getTime() + 3600_000),
        onInvalidate: () => {},
      });
      expect(res, JSON.stringify(marker)).toEqual({ ok: false, reason: "malformed" });
      expect((store.read(hex) as Record<string, unknown>).accountDeletion).toEqual(marker);
    }
  });

  it("keeps fence, revocation, and audit fields across checkpoint writes", async () => {
    const user = makeUser();
    const { store, hex } = seedStore(user);
    await reserveOk(store, user, T0, rid("res-keep"));
    await claimCommand(store, {
      userId: user._id,
      reservationId: rid("res-keep"),
      workerId: "worker-a",
      now: T0,
      onInvalidate: () => {},
    });
    const before = (await store.findOne({ _id: user._id })) as User;
    await checkpointDeletion(store, {
      userId: user._id,
      reservationId: rid("res-keep"),
      workerId: "worker-a",
      generation: 0,
      now: new Date(T0.getTime() + 1000),
      onInvalidate: () => {},
    });
    const after = (await store.findOne({ _id: user._id })) as User;
    expect(after.accountDeletion?.reservationId).toBe(before.accountDeletion?.reservationId);
    expect(after.accountDeletion?.requestedAt.getTime()).toBe(
      before.accountDeletion?.requestedAt.getTime()
    );
    expect(after.accountDeletion?.requestedBySessionIat).toBe(
      before.accountDeletion?.requestedBySessionIat
    );
    expect(after.authRevokedAt?.getTime()).toBe(before.authRevokedAt?.getTime());
    expect(Object.hasOwn(store.read(hex) as object, "authMigrationFence")).toBe(false);
  });

  it("treats transport failures as unavailable on every worker write", async () => {
    const user = makeUser();
    const { store } = seedStore(user);
    await reserveOk(store, user, T0, rid("res-flaky"));
    store.throwNext = new Error("down");
    expect(
      await claimCommand(store, {
        userId: user._id,
        reservationId: rid("res-flaky"),
        workerId: "worker-a",
        now: T0,
        onInvalidate: () => {},
      })
    ).toEqual({ ok: false, reason: "unavailable" });
    store.throwNext = new Error("down");
    expect(
      await renewLease(store, {
        userId: user._id,
        reservationId: rid("res-flaky"),
        workerId: "worker-a",
        generation: 0,
        now: T0,
        onInvalidate: () => {},
      })
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("denies cross-account admission when caller, snapshot, and target disagree", async () => {
    // Two live player accounts with identical credentials and roles.
    const userA = makeUser({ password: "shared-hash" });
    const userB = makeUser({ password: "shared-hash" });
    const hexB = userB._id.toHexString();
    const store = new FakeDeletionStore();
    store.seed(userB, hexB);
    const invalidated: string[] = [];
    // Caller for A + snapshot A + victim target B.
    const cross = await reserveDeletion(store, {
      userId: userB._id,
      snapshot: cloneValue(userA),
      caller: callerFor(userA, T0),
      now: T0,
      reservationId: rid("res-cross"),
      onInvalidate: (id) => invalidated.push(id),
    });
    expect(cross).toEqual({ ok: false, reason: "denied", denial: "principal" });
    expect(invalidated).toEqual([]);
    expect(store.updateCalls).toBe(0);
    expect(hasDeletionMarker(store.read(hexB) as object)).toBe(false);
    // Caller for A + snapshot B + target B.
    const cross2 = await reserveDeletion(store, {
      userId: userB._id,
      snapshot: cloneValue(userB),
      caller: callerFor(userA, T0),
      now: T0,
      reservationId: rid("res-cross-2"),
      onInvalidate: (id) => invalidated.push(id),
    });
    expect(cross2).toEqual({ ok: false, reason: "denied", denial: "principal" });
    expect(invalidated).toEqual([]);
    expect(store.updateCalls).toBe(0);
    expect(hasDeletionMarker(store.read(hexB) as object)).toBe(false);
  });

  it("fails stale advances once the database clock passes expiry", async () => {
    const user = makeUser();
    const { store } = seedStore(user);
    await reserveOk(store, user, T0, rid("res-stale"));
    const claimed = await claimCommand(store, {
      userId: user._id,
      reservationId: rid("res-stale"),
      workerId: "worker-a",
      now: T0,
      leaseTtlMs: 5_000,
      onInvalidate: () => {},
    });
    expect(claimed.ok).toBe(true);
    // The database clock moves past the 5s lease while the caller clock stays frozen.
    store.dbNow = new Date(T0.getTime() + 30_000);
    const staleBase = {
      userId: user._id,
      reservationId: rid("res-stale"),
      workerId: "worker-a",
      generation: 0,
      now: T0,
      onInvalidate: () => {},
    };
    expect(await renewLease(store, staleBase)).toEqual({ ok: false, reason: "conflict" });
    expect(await checkpointDeletion(store, staleBase)).toEqual({ ok: false, reason: "conflict" });
    expect(await confirmDeletionCompleted(store, staleBase)).toEqual({
      ok: false,
      reason: "conflict",
    });
    // The expired lease is reclaimable by a new holder at current database time.
    const reclaim = await claimCommand(store, {
      userId: user._id,
      reservationId: rid("res-stale"),
      workerId: "worker-b",
      now: new Date(T0.getTime() + 30_000),
      onInvalidate: () => {},
    });
    expect(reclaim.ok).toBe(true);
    if (reclaim.ok) expect(reclaim.generation).toBe(1);
  });

  it("refuses reclaim while the lease is live at the database clock", async () => {
    const user = makeUser();
    const { store } = seedStore(user);
    await reserveOk(store, user, T0, rid("res-live-steal"));
    await claimCommand(store, {
      userId: user._id,
      reservationId: rid("res-live-steal"),
      workerId: "worker-a",
      now: T0,
      onInvalidate: () => {},
    });
    // A caller with a future-dated clock cannot steal a live lease.
    expect(
      await claimCommand(store, {
        userId: user._id,
        reservationId: rid("res-live-steal"),
        workerId: "worker-b",
        now: new Date(T0.getTime() + 3600_000),
        onInvalidate: () => {},
      })
    ).toEqual({ ok: false, reason: "conflict" });
  });

  it("rejects renews that would move the deadline backward", async () => {
    const user = makeUser();
    const { store } = seedStore(user);
    await reserveOk(store, user, T0, rid("res-back"));
    await claimCommand(store, {
      userId: user._id,
      reservationId: rid("res-back"),
      workerId: "worker-a",
      now: T0,
      onInvalidate: () => {},
    });
    const later = new Date(T0.getTime() + 60_000);
    store.dbNow = new Date(later.getTime());
    const forward = await renewLease(store, {
      userId: user._id,
      reservationId: rid("res-back"),
      workerId: "worker-a",
      generation: 0,
      now: later,
      onInvalidate: () => {},
    });
    expect(forward.ok).toBe(true);
    // Out-of-order retry with the original timestamp conflicts; the deadline stands.
    expect(
      await renewLease(store, {
        userId: user._id,
        reservationId: rid("res-back"),
        workerId: "worker-a",
        generation: 0,
        now: T0,
        onInvalidate: () => {},
      })
    ).toEqual({ ok: false, reason: "conflict" });
    expect(
      readDeletionCommand(
        (await store.findOne({ _id: user._id })) as User
      )?.leaseExpiresAt?.getTime()
    ).toBe(later.getTime() + DELETION_LEASE_TTL_MS);
  });

  it("refuses worker advances on malformed stored commands", async () => {
    const hex = new ObjectId().toHexString();
    const store = new FakeDeletionStore();
    const user = makeUser({ _id: new ObjectId(hex) });
    // Otherwise valid triple plus an unknown field: matches a naive
    // partial-field filter, but the kernel must not advance it.
    store.seed(
      {
        ...user,
        accountDeletion: {
          state: "reserved",
          reservationId: rid("res-extra"),
          requestedAt: T0,
          requestedBySessionIat: iatOf(T0),
          updatedAt: T0,
          workerId: "worker-a",
          workerGeneration: 0,
          leaseExpiresAt: new Date(T0.getTime() + 120_000),
          injected: "x",
        },
      },
      hex
    );
    const base = {
      userId: user._id,
      reservationId: rid("res-extra"),
      workerId: "worker-a",
      generation: 0,
      now: T0,
      onInvalidate: () => {},
    };
    expect(await renewLease(store, base)).toEqual({ ok: false, reason: "conflict" });
    expect(await checkpointDeletion(store, base)).toEqual({ ok: false, reason: "conflict" });
    expect(await confirmDeletionCompleted(store, base)).toEqual({ ok: false, reason: "conflict" });
    expect((store.read(hex) as Record<string, unknown>).accountDeletion).toMatchObject({
      state: "reserved",
    });
  });
});

describe("reads and proof freshness", () => {
  it("returns a safe detached copy with no credential material", async () => {
    const user = makeUser({ googleId: "g-1", discordId: "d-1" });
    const { store } = seedStore(user);
    expect(readDeletionCommand(user)).toBeNull();
    await reserveOk(store, user, T0, rid("res-view"));
    const reread = (await store.findOne({ _id: user._id })) as User;
    const view = readDeletionCommand(reread);
    expect(view).toMatchObject({ state: "reserved", reservationId: rid("res-view") });
    expect(view).not.toHaveProperty("password");
    expect(view).not.toHaveProperty("googleId");
    // Detached: mutating the view cannot corrupt the row.
    if (view) {
      view.state = "complete";
      view.requestedAt.setTime(0);
      view.updatedAt.setTime(0);
    }
    expect(asWellFormedCommand({ ...reread.accountDeletion, injected: 1 })).toBeNull();
    expect(readDeletionCommand((await store.findOne({ _id: user._id })) as User)?.state).toBe(
      "reserved"
    );
    expect(hasDeletionMarker({})).toBe(false);
    expect(hasDeletionMarker(null)).toBe(false);
    expect(hasDeletionMarker({ accountDeletion: null })).toBe(true);
    expect(hasDeletionMarker({ accountDeletion: undefined })).toBe(true);
    expect(readDeletionCommand(null)).toBeNull();
  });

  it("enforces proof freshness boundaries", () => {
    const iat = iatOf(T0);
    expect(isFreshVerifiedIat(iat, T0)).toBe(true);
    // Exact max age still counts; one second past it does not.
    expect(isFreshVerifiedIat(iatOf(new Date(T0.getTime() - 15 * 60_000)), T0)).toBe(true);
    expect(isFreshVerifiedIat(iatOf(new Date(T0.getTime() - 15 * 60_000 - 1000)), T0)).toBe(false);
    expect(isFreshVerifiedIat(iatOf(new Date(T0.getTime() + 61_000)), T0)).toBe(false);
    for (const bad of [undefined, null, Number.NaN, -1, 1.5, "123"]) {
      expect(isFreshVerifiedIat(bad, T0)).toBe(false);
    }
    expect(isFreshVerifiedIat(iat, new Date(NaN))).toBe(false);
  });
});

// ── Real-Mongo interlock (opt-in, ephemeral, never a configured DB) ─────────
//   AHD_DELETION_COMMAND_REAL_MONGO=1 npx vitest run src/lib/account/deletionCommand.test.ts
// Spawns its OWN `mongod` on a random loopback port with a fresh dbpath under
// TMPDIR, so no existing database is touched. Fails when the flag is set but
// no binary exists; the suite skips otherwise.

const RUN_REAL_MONGO = process.env.AHD_DELETION_COMMAND_REAL_MONGO === "1";

function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function mongodAvailable(): boolean {
  try {
    const probe = spawnSync("mongod", ["--version"], { stdio: "ignore" });
    return !probe.error && probe.status === 0;
  } catch {
    return false;
  }
}

/** SIGTERM with a bounded wait, then SIGKILL: only ever signals the owned child. */
async function stopMongod(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => {
      child.once("exit", () => resolve(true));
    }),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);
  if (!exited) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    await Promise.race([
      new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
      }),
      new Promise<void>((resolve) => setTimeout(() => resolve(), 5000)),
    ]);
  }
}

interface RealMongoContext {
  store: DeletionCommandStore;
  cleanup: () => Promise<void>;
}

async function startRealMongo(
  colName: string
): Promise<RealMongoContext & { col: import("mongodb").Collection<User> }> {
  if (!mongodAvailable()) {
    throw new Error("AHD_DELETION_COMMAND_REAL_MONGO=1 but no mongod binary is on PATH");
  }
  const dir = mkdtempSync(path.join(tmpdir(), "ahd-deletion-kernel-"));
  const port = await freeLoopbackPort();
  // stdio ignored so a chatty child can never block on a full pipe.
  const mongod = spawn(
    "mongod",
    [
      "--dbpath",
      dir,
      "--port",
      String(port),
      "--bind_ip",
      "127.0.0.1",
      "--nounixsocket",
      "--wiredTigerCacheSizeGB",
      "0.25",
      "--quiet",
    ],
    { stdio: "ignore" }
  );
  let spawnError: unknown = null;
  mongod.once("error", (err) => {
    spawnError = err;
  });
  const url = `mongodb://127.0.0.1:${port}/?directConnection=true`;
  let client: MongoClient | null = null;
  try {
    let lastError: unknown = spawnError;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (spawnError) throw spawnError;
      if (mongod.exitCode !== null) {
        throw new Error(`mongod exited early with code ${mongod.exitCode}`);
      }
      try {
        client = new MongoClient(url, { serverSelectionTimeoutMS: 500 });
        await client.db("admin").command({ ping: 1 });
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        await client?.close().catch(() => {});
        client = null;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (!client || lastError) throw lastError ?? new Error("mongod never came up");
    const col = client.db("ahdDeletionKernelEphemeral").collection<User>(colName);
    const store: DeletionCommandStore = {
      updateOne: (filter, update) =>
        col
          .updateOne(filter, update)
          .then((r) => ({ acknowledged: r.acknowledged, matchedCount: r.matchedCount })),
      findOne: (filter) => col.findOne(filter),
    };
    const active = client;
    return {
      col,
      store,
      cleanup: async () => {
        await active.close().catch(() => {});
        await stopMongod(mongod);
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (err) {
    await client?.close().catch(() => {});
    await stopMongod(mongod);
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

describe.skipIf(!RUN_REAL_MONGO)("deletion command on real mongo (ephemeral)", () => {
  it("serializes admission and claim races and runs the worker lifecycle", async () => {
    const { col, store, cleanup } = await startRealMongo("usersRace");
    try {
      const now = new Date();
      const user = makeUser();
      await col.insertOne(cloneValue(user));
      const snapshot = (await col.findOne({ _id: user._id })) as User;
      const caller = { userId: user._id.toHexString(), iat: iatOf(now) };
      const [a, b] = await Promise.all([
        reserveDeletion(store, {
          userId: user._id,
          snapshot,
          caller,
          now,
          reservationId: rid("res-real-a"),
          onInvalidate: () => {},
        }),
        reserveDeletion(store, {
          userId: user._id,
          snapshot,
          caller,
          now,
          reservationId: rid("res-real-b"),
          onInvalidate: () => {},
        }),
      ]);
      const winners = [a, b].filter((r) => r.ok);
      expect(winners).toHaveLength(1);
      const winner = winners[0];
      expect(winner?.ok).toBe(true);
      const winnerId = winner && winner.ok ? winner.reservationId : "";
      // Two holders race the initial claim: exactly one wins.
      const racer = makeUser();
      await col.insertOne(cloneValue(racer));
      const racerSnapshot = (await col.findOne({ _id: racer._id })) as User;
      const racerNow = new Date();
      const admitted = await reserveDeletion(store, {
        userId: racer._id,
        snapshot: racerSnapshot,
        caller: { userId: racer._id.toHexString(), iat: iatOf(racerNow) },
        now: racerNow,
        reservationId: rid("res-real-race"),
        onInvalidate: () => {},
      });
      expect(admitted.ok).toBe(true);
      const [c1, c2] = await Promise.all([
        claimCommand(store, {
          userId: racer._id,
          reservationId: rid("res-real-race"),
          workerId: "real-worker-a",
          now: racerNow,
          onInvalidate: () => {},
        }),
        claimCommand(store, {
          userId: racer._id,
          reservationId: rid("res-real-race"),
          workerId: "real-worker-b",
          now: racerNow,
          onInvalidate: () => {},
        }),
      ]);
      expect([c1, c2].filter((r) => r.ok)).toHaveLength(1);
      // A partial stored command is never claimable.
      const partial = makeUser();
      await col.insertOne(
        cloneValue({
          ...partial,
          accountDeletion: {
            state: "reserved",
            reservationId: rid("res-real-partial"),
            requestedAt: racerNow,
            requestedBySessionIat: iatOf(racerNow),
            updatedAt: racerNow,
            workerId: "real-worker-a",
          },
        })
      );
      expect(
        await claimCommand(store, {
          userId: partial._id,
          reservationId: rid("res-real-partial"),
          workerId: "real-worker-b",
          now: new Date(racerNow.getTime() + 3600_000),
          onInvalidate: () => {},
        })
      ).toEqual({ ok: false, reason: "malformed" });
      const workerNow = new Date(now.getTime() + 1000);
      const claimed = await claimCommand(store, {
        userId: user._id,
        reservationId: winnerId,
        workerId: "real-worker",
        now: workerNow,
        onInvalidate: () => {},
      });
      expect(claimed.ok).toBe(true);
      expect(
        await checkpointDeletion(store, {
          userId: user._id,
          reservationId: winnerId,
          workerId: "real-worker",
          generation: 0,
          now: workerNow,
          onInvalidate: () => {},
        })
      ).toEqual({ ok: true });
      expect(
        await confirmDeletionCompleted(store, {
          userId: user._id,
          reservationId: winnerId,
          workerId: "real-worker",
          generation: 0,
          now: workerNow,
          onInvalidate: () => {},
        })
      ).toEqual({ ok: true });
      await col.db.dropDatabase();
    } finally {
      await cleanup();
    }
  }, 90_000);

  it("denies cross-account admission with identical credentials", async () => {
    const { col, store, cleanup } = await startRealMongo("usersCross");
    try {
      const now = new Date();
      const userA = makeUser({ password: "shared-hash" });
      const userB = makeUser({ password: "shared-hash" });
      await col.insertMany([cloneValue(userA), cloneValue(userB)]);
      const snapshotA = (await col.findOne({ _id: userA._id })) as User;
      const res = await reserveDeletion(store, {
        userId: userB._id,
        snapshot: snapshotA,
        caller: { userId: userA._id.toHexString(), iat: iatOf(now) },
        now,
        reservationId: rid("res-real-cross"),
        onInvalidate: () => {},
      });
      expect(res).toEqual({ ok: false, reason: "denied", denial: "principal" });
      expect(await col.findOne({ accountDeletion: { $exists: true } })).toBeNull();
    } finally {
      await cleanup();
    }
  }, 90_000);

  it("fails stale advances after a real delay past a short lease", async () => {
    const { col, store, cleanup } = await startRealMongo("usersExpiry");
    try {
      const now = new Date();
      const user = makeUser();
      await col.insertOne(cloneValue(user));
      const snapshot = (await col.findOne({ _id: user._id })) as User;
      const admitted = await reserveDeletion(store, {
        userId: user._id,
        snapshot,
        caller: { userId: user._id.toHexString(), iat: iatOf(now) },
        now,
        reservationId: rid("res-real-expiry"),
        onInvalidate: () => {},
      });
      expect(admitted.ok).toBe(true);
      const claimed = await claimCommand(store, {
        userId: user._id,
        reservationId: rid("res-real-expiry"),
        workerId: "real-worker",
        now,
        leaseTtlMs: 5_000,
        onInvalidate: () => {},
      });
      expect(claimed.ok).toBe(true);
      // A future-dated caller cannot reclaim the still-live lease.
      expect(
        await claimCommand(store, {
          userId: user._id,
          reservationId: rid("res-real-expiry"),
          workerId: "real-worker-b",
          now: new Date(now.getTime() + 3600_000),
          onInvalidate: () => {},
        })
      ).toEqual({ ok: false, reason: "conflict" });
      // Wait past the 5s lease, then replay with the frozen timestamp: every
      // advance must fail even though `now` predates the deadline.
      await new Promise((r) => setTimeout(r, 6500));
      const staleBase = {
        userId: user._id,
        reservationId: rid("res-real-expiry"),
        workerId: "real-worker",
        generation: 0,
        now,
        onInvalidate: () => {},
      };
      expect(await renewLease(store, staleBase)).toEqual({ ok: false, reason: "conflict" });
      expect(await checkpointDeletion(store, staleBase)).toEqual({
        ok: false,
        reason: "conflict",
      });
      expect(await confirmDeletionCompleted(store, staleBase)).toEqual({
        ok: false,
        reason: "conflict",
      });
      // Fresh reclaim at the current clock succeeds at generation + 1.
      const reclaim = await claimCommand(store, {
        userId: user._id,
        reservationId: rid("res-real-expiry"),
        workerId: "real-worker-b",
        now: new Date(),
        onInvalidate: () => {},
      });
      expect(reclaim.ok).toBe(true);
      if (reclaim.ok) expect(reclaim.generation).toBe(1);
      await col.db.dropDatabase();
    } finally {
      await cleanup();
    }
  }, 90_000);
});
