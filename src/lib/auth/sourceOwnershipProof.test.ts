import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, statfsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId, type Db } from "mongodb";
import {
  createSourceOwnershipProofStore,
  SourceOwnershipProofError,
  SourceOwnershipProofOutcomeUnknownError,
  type ReserveEnrollment,
  type SourceOwnershipReservation,
} from "./sourceOwnershipProof";
import { RequiredTransactionCleanupError } from "@/lib/db/runRequiredTransaction";

const ISSUER = "lakeside-test-source";
const SOURCE_HEX = "0123456789abcdef01234567";
const CANONICAL = "abcdef12-abcd-4abc-8abc-abcdef123456";
const ENROLL = "12345678-90ab-4cde-b123-456789abcdef";
const PASSWORD = "correct-horse-test-pw";
const WRONG = "wrong-horse-test-pw";
const HASH = bcrypt.hashSync(PASSWORD, 12);
const OTHER_HASH = bcrypt.hashSync("another-synthetic-pw", 12);

type FakeDoc = Record<string, unknown>;

function baseUserDoc(): FakeDoc {
  return {
    _id: new ObjectId(SOURCE_HEX),
    password: HASH,
    role: "player",
    isAdmin: false,
    isBanned: false,
  };
}

function goodReservation(): SourceOwnershipReservation {
  return {
    version: 1,
    sourceIssuer: ISSUER,
    sourceSubject: SOURCE_HEX,
    canonicalAccountId: CANONICAL,
    enrollmentOperationId: ENROLL,
  };
}

function makeReserve(
  onCall?: (input: { sourceIssuer: string; sourceSubject: string }) => void | Promise<void>,
  override?: Record<string, unknown>
): ReserveEnrollment & { calls: number } {
  const fn = (async (input) => {
    fn.calls += 1;
    await onCall?.({ sourceIssuer: input.sourceIssuer, sourceSubject: input.sourceSubject });
    return { ...goodReservation(), ...override };
  }) as ReserveEnrollment & { calls: number };
  fn.calls = 0;
  return fn;
}

interface FakeFixture {
  users: Map<string, FakeDoc>;
  proofs: Map<string, FakeDoc>;
  nowHook: () => Date;
  failProofInsert: boolean;
}

function projectCopy(doc: FakeDoc, projection?: Record<string, number>): FakeDoc {
  const out: FakeDoc = { _id: doc["_id"] };
  if (!projection) {
    for (const key of Object.keys(doc)) if (key !== "_id") out[key] = doc[key];
    return out;
  }
  for (const key of Object.keys(projection)) {
    if (key !== "_id" && projection[key] === 1 && Object.hasOwn(doc, key)) out[key] = doc[key];
  }
  return out;
}

function keyOf(filter: FakeDoc): string {
  const id = filter["_id"];
  if (id instanceof ObjectId) return id.toHexString();
  return String(id);
}

function makeFakeDb(fixture: FakeFixture): Db {
  const usersApi = {
    findOne: async (filter: FakeDoc, options?: { projection?: Record<string, number> }) => {
      const doc = fixture.users.get(keyOf(filter));
      return doc ? projectCopy(doc, options?.projection) : null;
    },
    findOneAndUpdate: async (filter: FakeDoc, update: FakeDoc[], options?: FakeDoc) => {
      const doc = fixture.users.get(keyOf(filter));
      if (!doc) return null;
      const set = (update[0] as FakeDoc)["$set"] as FakeDoc;
      const anchor = set["sourceOwnershipProofAnchor"] as FakeDoc;
      const literal = (anchor["proofId"] as FakeDoc)["$literal"];
      doc["sourceOwnershipProofAnchor"] = { proofId: literal, observedAt: fixture.nowHook() };
      const projection = options?.["projection"] as Record<string, number> | undefined;
      return projectCopy(doc, projection);
    },
  };
  const proofsApi = {
    insertOne: async (doc: FakeDoc) => {
      if (fixture.failProofInsert) throw new Error("synthetic proof insert failure");
      const id = String(doc["_id"]);
      if (fixture.proofs.has(id)) {
        const duplicate = new Error("duplicate key") as Error & { code?: number };
        duplicate.code = 11000;
        throw duplicate;
      }
      fixture.proofs.set(id, { ...doc });
      return { insertedId: id };
    },
    aggregate: (_pipeline: unknown[], _options?: unknown) => ({
      toArray: async () => {
        void _pipeline;
        void _options;
        const matchId = (_pipeline[0] as FakeDoc)["$match"] as FakeDoc;
        const doc = fixture.proofs.get(String(matchId["_id"]));
        if (!doc) return [];
        return [{ doc: { ...doc }, sourceNow: fixture.nowHook() }];
      },
    }),
  };
  return {
    collection: (name: string) => (name === "users" ? usersApi : proofsApi),
  } as unknown as Db;
}

type TxMode = "once" | "unknown-commit" | "cleanup-fails";

function makeFakeClient(db: Db, mode: TxMode = "once", afterCommit?: () => void): MongoClient {
  const session = {
    withTransaction: async (body: (session: unknown) => Promise<unknown>) => {
      if (mode === "unknown-commit") {
        throw Object.assign(new Error("commit result unknown"), {
          errorLabels: ["UnknownTransactionCommitResult"],
        });
      }
      const result = await body(session);
      afterCommit?.();
      return result;
    },
    endSession: async () => {
      if (mode === "cleanup-fails") throw new Error("synthetic cleanup failure");
    },
  };
  const client = { startSession: () => session } as unknown as MongoClient;
  Object.defineProperty(db, "client", { value: client, configurable: true });
  return client;
}

function makeStore(fixture: FakeFixture, mode: TxMode = "once") {
  const db = makeFakeDb(fixture);
  const client = makeFakeClient(db, mode);
  const store = createSourceOwnershipProofStore({ sourceIssuer: ISSUER, client, db });
  return { store, db, client };
}

function newFixture(userDoc: FakeDoc = baseUserDoc()): FakeFixture {
  return {
    users: new Map([[SOURCE_HEX, userDoc]]),
    proofs: new Map(),
    nowHook: () => new Date(),
    failProofInsert: false,
  };
}

function storedJsonDoesNotLeak(fixture: FakeFixture): void {
  const blob = JSON.stringify([...fixture.proofs.values()]);
  expect(blob).not.toContain(PASSWORD);
  expect(blob).not.toContain(HASH);
  expect(blob).not.toContain(OTHER_HASH);
}

describe("source ownership proof kernel", { timeout: 30000 }, () => {
  it("rejects a malformed account id before any reserve or write", async () => {
    const fixture = newFixture();
    const { store } = makeStore(fixture);
    const reserve = makeReserve();
    await expect(
      store.issuePasswordProof({
        sourceAccountId: "NOT-HEX",
        password: PASSWORD,
        reserveEnrollment: reserve,
      })
    ).rejects.toBeInstanceOf(SourceOwnershipProofError);
    expect(reserve.calls).toBe(0);
    expect(fixture.proofs.size).toBe(0);
  });

  it("rejects full-string ID and digest suffix aliases and foreign reader issuers", async () => {
    const fixture = newFixture();
    const { store } = makeStore(fixture);
    const reserve = makeReserve();
    for (const suffix of ["\n", "\u2028", "\u2029"]) {
      await expect(
        store.issuePasswordProof({
          sourceAccountId: SOURCE_HEX + suffix,
          password: PASSWORD,
          reserveEnrollment: reserve,
        })
      ).rejects.toBeInstanceOf(SourceOwnershipProofError);
    }
    expect(reserve.calls).toBe(0);
    const proof = await store.issuePasswordProof({
      sourceAccountId: SOURCE_HEX,
      password: PASSWORD,
      reserveEnrollment: reserve,
    });
    const stored = fixture.proofs.get(proof.proofId)!;
    const digest = stored.snapshotDigest;
    for (const suffix of ["\n", "\u2028", "\u2029"]) {
      stored.snapshotDigest = String(digest) + suffix;
      await expect(store.loadProof({ proofId: proof.proofId })).rejects.toBeInstanceOf(
        SourceOwnershipProofError
      );
    }
    stored.snapshotDigest = digest;
    stored.sourceIssuer = "another-source";
    await expect(store.loadProof({ proofId: proof.proofId })).rejects.toBeInstanceOf(
      SourceOwnershipProofError
    );
    stored.sourceIssuer = ISSUER;
    fixture.nowHook = () => new Date(proof.observedAtMs - 1);
    await expect(store.loadProof({ proofId: proof.proofId })).rejects.toBeInstanceOf(
      SourceOwnershipProofError
    );
  });

  it("bounds a reservation callback that ignores cancellation and discards its late result", async () => {
    const fixture = newFixture();
    const { store } = makeStore(fixture);
    let calls = 0;
    let complete!: (value: SourceOwnershipReservation) => void;
    let signal: AbortSignal | undefined;
    const clock = vi
      .spyOn(performance, "now")
      .mockImplementation(() => (calls++ === 0 ? 0 : 29999));
    try {
      await expect(
        store.issuePasswordProof({
          sourceAccountId: SOURCE_HEX,
          password: PASSWORD,
          reserveEnrollment: (input) => {
            signal = input.signal;
            return new Promise((resolve) => {
              complete = resolve;
            });
          },
        })
      ).rejects.toBeInstanceOf(SourceOwnershipProofError);
      expect(signal?.aborted).toBe(true);
      complete(goodReservation());
      await Promise.resolve();
      expect(fixture.proofs.size).toBe(0);
      expect(fixture.users.get(SOURCE_HEX)).not.toHaveProperty("sourceOwnershipProofAnchor");
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps the original password and reservation callback across the first await", async () => {
    const fixture = newFixture();
    const { store } = makeStore(fixture);
    const reserve = makeReserve();
    const replacement = makeReserve(undefined, { canonicalAccountId: ENROLL });
    const input = { sourceAccountId: SOURCE_HEX, password: PASSWORD, reserveEnrollment: reserve };
    const pending = store.issuePasswordProof(input);
    input.password = WRONG;
    input.reserveEnrollment = replacement;
    const proof = await pending;
    expect(proof.canonicalAccountId).toBe(CANONICAL);
    expect(reserve.calls).toBe(1);
    expect(replacement.calls).toBe(0);
  });

  it("returns the committed proof when commit finishes beyond the observation window", async () => {
    const fixture = newFixture();
    const db = makeFakeDb(fixture);
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const client = makeFakeClient(db, "once", () => {
      clock.mockReturnValue(40000);
    });
    const store = createSourceOwnershipProofStore({ sourceIssuer: ISSUER, client, db });
    try {
      const proof = await store.issuePasswordProof({
        sourceAccountId: SOURCE_HEX,
        password: PASSWORD,
        reserveEnrollment: makeReserve(),
      });
      expect(fixture.proofs.has(proof.proofId)).toBe(true);
      expect(proof.expiresAtMs - proof.observedAtMs).toBe(270000);
    } finally {
      clock.mockRestore();
    }
  });

  it("sanitizes callback failures and hostile reservation getters", async () => {
    const secret = "synthetic-callback-private-material";
    const { store } = makeStore(newFixture());
    for (const callback of [
      async () => {
        throw new Error(secret);
      },
      async () =>
        Object.defineProperty(goodReservation(), "canonicalAccountId", {
          get() {
            throw new Error(secret);
          },
        }),
    ]) {
      try {
        await store.issuePasswordProof({
          sourceAccountId: SOURCE_HEX,
          password: PASSWORD,
          reserveEnrollment: callback,
        });
        expect.fail("expected sanitized rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(SourceOwnershipProofError);
        expect(String(error)).not.toContain(secret);
        expect(error).not.toHaveProperty("cause");
      }
    }
  });

  it("rejects a wrong password with no reserve, anchor, or proof", async () => {
    const fixture = newFixture();
    const { store } = makeStore(fixture);
    const reserve = makeReserve();
    await expect(
      store.issuePasswordProof({
        sourceAccountId: SOURCE_HEX,
        password: WRONG,
        reserveEnrollment: reserve,
      })
    ).rejects.toThrow();
    expect(reserve.calls).toBe(0);
    expect(fixture.users.get(SOURCE_HEX)).not.toHaveProperty("sourceOwnershipProofAnchor");
    expect(fixture.proofs.size).toBe(0);
  });

  it("rejects social and fenced rows with no reserve or writes", async () => {
    for (const userDoc of [
      { ...baseUserDoc(), googleId: "synthetic-google-id" },
      { ...baseUserDoc(), authMigrationFence: { operationId: ENROLL } },
      { ...baseUserDoc(), accountDeletion: { requestedAt: new Date() } },
    ]) {
      const fixture = newFixture(userDoc);
      const { store } = makeStore(fixture);
      const reserve = makeReserve();
      await expect(
        store.issuePasswordProof({
          sourceAccountId: SOURCE_HEX,
          password: PASSWORD,
          reserveEnrollment: reserve,
        })
      ).rejects.toThrow();
      expect(reserve.calls).toBe(0);
      expect(fixture.proofs.size).toBe(0);
      expect(fixture.users.get(SOURCE_HEX)).not.toHaveProperty("sourceOwnershipProofAnchor");
    }
  });

  it("issues an atomic proof and anchor without storing secrets", async () => {
    const fixture = newFixture();
    const { store } = makeStore(fixture);
    const proof = await store.issuePasswordProof({
      sourceAccountId: SOURCE_HEX,
      password: PASSWORD,
      reserveEnrollment: makeReserve(),
    });
    expect(proof.version).toBe(1);
    expect(proof.method).toBe("password");
    expect(proof.sourceIssuer).toBe(ISSUER);
    expect(proof.sourceAccountId).toBe(SOURCE_HEX);
    expect(proof.canonicalAccountId).toBe(CANONICAL);
    expect(proof.enrollmentOperationId).toBe(ENROLL);
    expect(proof.expiresAtMs - proof.observedAtMs).toBe(270000);
    expect(proof.observationWindowMs).toBe(30000);
    expect(Object.isFrozen(proof)).toBe(true);
    expect(Object.isFrozen(proof.retainedMethods)).toBe(true);
    const anchor = (fixture.users.get(SOURCE_HEX) as FakeDoc)[
      "sourceOwnershipProofAnchor"
    ] as FakeDoc;
    expect(anchor["proofId"]).toBe(proof.proofId);
    expect(anchor["observedAt"] instanceof Date).toBe(true);
    expect((anchor["observedAt"] as Date).getTime()).toBe(proof.observedAtMs);
    const stored = fixture.proofs.get(proof.proofId) as FakeDoc;
    expect(stored["_id"]).toBe(proof.proofId);
    expect(stored["snapshotDigest"]).toBe(proof.snapshotDigest);
    storedJsonDoesNotLeak(fixture);
    const blob = JSON.stringify({ proof, anchor });
    expect(blob).not.toContain(PASSWORD);
    expect(blob).not.toContain(HASH);
  });

  it("rejects reservations with unknown keys or a foreign binding", async () => {
    for (const override of [
      { extraKey: "nope" },
      { sourceSubject: "aaaaaaaaaaaaaaaaaaaaaaaa" },
      { sourceIssuer: "another-issuer" },
      { canonicalAccountId: "not-a-uuid" },
      { version: 2 },
    ]) {
      const fixture = newFixture();
      const { store } = makeStore(fixture);
      const reserve = makeReserve(undefined, override);
      await expect(
        store.issuePasswordProof({
          sourceAccountId: SOURCE_HEX,
          password: PASSWORD,
          reserveEnrollment: reserve,
        })
      ).rejects.toBeInstanceOf(SourceOwnershipProofError);
      expect(fixture.proofs.size).toBe(0);
      expect(fixture.users.get(SOURCE_HEX)).not.toHaveProperty("sourceOwnershipProofAnchor");
    }
  });

  it("rejects when the security state mutates after verify, before commit", async () => {
    const fixture = newFixture();
    const { store } = makeStore(fixture);
    const reserve = makeReserve(async () => {
      (fixture.users.get(SOURCE_HEX) as FakeDoc)["password"] = OTHER_HASH;
    });
    await expect(
      store.issuePasswordProof({
        sourceAccountId: SOURCE_HEX,
        password: PASSWORD,
        reserveEnrollment: reserve,
      })
    ).rejects.toThrow();
    expect(fixture.proofs.size).toBe(0);
    expect(fixture.users.get(SOURCE_HEX)).not.toHaveProperty("sourceOwnershipProofAnchor");
  });

  it("allows a profile only change during reserve", async () => {
    const fixture = newFixture();
    const { store } = makeStore(fixture);
    const reserve = makeReserve(async () => {
      (fixture.users.get(SOURCE_HEX) as FakeDoc)["email"] = "changed@example.invalid";
    });
    const proof = await store.issuePasswordProof({
      sourceAccountId: SOURCE_HEX,
      password: PASSWORD,
      reserveEnrollment: reserve,
    });
    expect(fixture.proofs.has(proof.proofId)).toBe(true);
  });

  it("treats absent and null stored passwords as distinct ineligible states", async () => {
    const absent = baseUserDoc();
    delete absent["password"];
    const nulled = baseUserDoc();
    nulled["password"] = null;
    for (const userDoc of [absent, nulled]) {
      const fixture = newFixture(userDoc);
      const { store } = makeStore(fixture);
      const reserve = makeReserve();
      await expect(
        store.issuePasswordProof({
          sourceAccountId: SOURCE_HEX,
          password: PASSWORD,
          reserveEnrollment: reserve,
        })
      ).rejects.toThrow();
      expect(reserve.calls).toBe(0);
      expect(fixture.proofs.size).toBe(0);
    }
  });

  it("allows a second fresh proof for the same operation with a new id", async () => {
    const fixture = newFixture();
    const { store } = makeStore(fixture);
    const first = await store.issuePasswordProof({
      sourceAccountId: SOURCE_HEX,
      password: PASSWORD,
      reserveEnrollment: makeReserve(),
    });
    const second = await store.issuePasswordProof({
      sourceAccountId: SOURCE_HEX,
      password: PASSWORD,
      reserveEnrollment: makeReserve(),
    });
    expect(second.proofId).not.toBe(first.proofId);
    expect(fixture.proofs.size).toBe(2);
    const anchor = (fixture.users.get(SOURCE_HEX) as FakeDoc)[
      "sourceOwnershipProofAnchor"
    ] as FakeDoc;
    expect(anchor["proofId"]).toBe(second.proofId);
  });

  it("stores no proof when the proof insert fails", async () => {
    // The fake has no real rollback, so anchor rollback on insert failure
    // is covered by the opt-in replica set test below, not asserted here.
    const fixture = newFixture();
    fixture.failProofInsert = true;
    const { store } = makeStore(fixture);
    await expect(
      store.issuePasswordProof({
        sourceAccountId: SOURCE_HEX,
        password: PASSWORD,
        reserveEnrollment: makeReserve(),
      })
    ).rejects.toThrow("ownership proof unavailable");
    expect(fixture.proofs.size).toBe(0);
  });

  it("never reruns reserve or bcrypt across a driver retry and keeps one id", async () => {
    const fixture = newFixture();
    const db = makeFakeDb(fixture);
    const tracker = { runs: 0 };
    const seen: string[] = [];
    const inner = db.collection("authSourceOwnershipProofs") as unknown as {
      insertOne: (doc: FakeDoc) => Promise<{ insertedId: string }>;
    };
    const rawInsert = inner.insertOne.bind(inner);
    inner.insertOne = async (doc: FakeDoc) => {
      seen.push(String(doc["_id"]));
      if (seen.length === 1) {
        // First attempt hits a transient error before commit: drop its
        // uncommitted write the way a real rollback would.
        await rawInsert(doc);
        fixture.proofs.delete(String(doc["_id"]));
        throw Object.assign(new Error("transient transaction error"), {
          errorLabels: ["TransientTransactionError"],
        });
      }
      return rawInsert(doc);
    };
    const retryDb = {
      collection: (name: string) => (name === "users" ? db.collection(name) : inner),
    } as unknown as Db;
    const session = {
      withTransaction: async (body: (session: unknown) => Promise<unknown>) => {
        try {
          return await body(session);
        } catch (error) {
          const labels = (error as { errorLabels?: unknown }).errorLabels;
          if (Array.isArray(labels) && labels.includes("TransientTransactionError")) {
            tracker.runs += 1;
            return body(session);
          }
          throw error;
        }
      },
      endSession: async () => undefined,
    };
    const client = { startSession: () => session } as unknown as MongoClient;
    Object.defineProperty(retryDb, "client", { value: client });
    const store = createSourceOwnershipProofStore({ sourceIssuer: ISSUER, client, db: retryDb });
    const compare = vi.spyOn(bcrypt, "compare");
    const reserve = makeReserve();
    try {
      const proof = await store.issuePasswordProof({
        sourceAccountId: SOURCE_HEX,
        password: PASSWORD,
        reserveEnrollment: reserve,
      });
      expect(reserve.calls).toBe(1);
      expect(compare).toHaveBeenCalledTimes(1);
      expect(seen.length).toBe(2);
      expect(seen[0]).toBe(seen[1]);
      expect(seen[0]).toBe(proof.proofId);
      expect(fixture.proofs.size).toBe(1);
    } finally {
      compare.mockRestore();
    }
  });

  it("reports an unknown commit with a stable proof id and no cause", async () => {
    const fixture = newFixture();
    const { store } = makeStore(fixture, "unknown-commit");
    const failure = await store
      .issuePasswordProof({
        sourceAccountId: SOURCE_HEX,
        password: PASSWORD,
        reserveEnrollment: makeReserve(),
      })
      .then(
        () => {
          throw new Error("expected unknown outcome");
        },
        (error: unknown) => error
      );
    expect(failure).toBeInstanceOf(SourceOwnershipProofOutcomeUnknownError);
    const proofId = (failure as SourceOwnershipProofOutcomeUnknownError).proofId;
    expect(typeof proofId).toBe("string");
    expect(proofId).toHaveLength(36);
    expect((failure as Error).message).not.toContain(PASSWORD);
    expect((failure as Error).message).not.toContain(HASH);
    expect((failure as Error).message).not.toContain(proofId);
  });

  it("preserves cleanup failures with the committed result for reconciliation", async () => {
    const fixture = newFixture();
    const { store } = makeStore(fixture, "cleanup-fails");
    const failure = await store
      .issuePasswordProof({
        sourceAccountId: SOURCE_HEX,
        password: PASSWORD,
        reserveEnrollment: makeReserve(),
      })
      .then(
        () => {
          throw new Error("expected cleanup failure");
        },
        (error: unknown) => error
      );
    expect(failure).toBeInstanceOf(RequiredTransactionCleanupError);
    const committed = (failure as RequiredTransactionCleanupError).committedResult as FakeDoc;
    expect(typeof committed["proofId"]).toBe("string");
    expect(fixture.proofs.has(String(committed["proofId"]))).toBe(true);
  });

  it("reads back durable metadata with the source clock and honors expiry", async () => {
    const fixture = newFixture();
    const { store } = makeStore(fixture);
    const proof = await store.issuePasswordProof({
      sourceAccountId: SOURCE_HEX,
      password: PASSWORD,
      reserveEnrollment: makeReserve(),
    });
    const loaded = await store.loadProof({ proofId: proof.proofId });
    expect(loaded).not.toBeNull();
    expect(loaded?.proof).toEqual(proof);
    expect(Number.isSafeInteger(loaded?.sourceNowMs)).toBe(true);
    expect(loaded?.expired).toBe(false);
    expect(await store.loadProof({ proofId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" })).toBeNull();
    await expect(store.loadProof({ proofId: "not-a-uuid" })).rejects.toBeInstanceOf(
      SourceOwnershipProofError
    );
  });

  it("rejects stored proofs with unknown fields and marks stale proofs expired", async () => {
    const fixture = newFixture();
    const { store } = makeStore(fixture);
    const proof = await store.issuePasswordProof({
      sourceAccountId: SOURCE_HEX,
      password: PASSWORD,
      reserveEnrollment: makeReserve(),
    });
    (fixture.proofs.get(proof.proofId) as FakeDoc)["unexpected"] = "nope";
    await expect(store.loadProof({ proofId: proof.proofId })).rejects.toBeInstanceOf(
      SourceOwnershipProofError
    );
    const observedAt = new Date(Date.now() - 600000);
    const staleId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
    fixture.proofs.set(staleId, {
      _id: staleId,
      version: 1,
      sourceIssuer: ISSUER,
      sourceAccountId: SOURCE_HEX,
      canonicalAccountId: CANONICAL,
      enrollmentOperationId: ENROLL,
      snapshotVersion: 1,
      snapshotDigest: proof.snapshotDigest,
      method: "password",
      retainedMethods: ["password"],
      observedAt,
      expiresAt: new Date(observedAt.getTime() + 270000),
      observationWindowMs: 30000,
    });
    const stale = await store.loadProof({ proofId: staleId });
    expect(stale?.expired).toBe(true);
    expect(stale?.proof.proofId).toBe(staleId);
  });

  it("rejects a mismatched db client and derives from a validated database name", async () => {
    const fixture = newFixture();
    const db = makeFakeDb(fixture);
    const otherClient = makeFakeClient(db);
    expect(() =>
      createSourceOwnershipProofStore({
        sourceIssuer: ISSUER,
        client: otherClient,
        db: { ...(db as unknown as object), client: {} } as unknown as Db,
      })
    ).toThrow(SourceOwnershipProofError);
    const named: Record<string, unknown> = {};
    const namedClient = {
      startSession: makeFakeClient(db).startSession,
      db: (name: string) => {
        named["name"] = name;
        return db;
      },
    } as unknown as MongoClient;
    const store = createSourceOwnershipProofStore({
      sourceIssuer: ISSUER,
      client: namedClient,
      databaseName: "synthetic_proof_db",
    });
    const proof = await store.issuePasswordProof({
      sourceAccountId: SOURCE_HEX,
      password: PASSWORD,
      reserveEnrollment: makeReserve(),
    });
    expect(named["name"]).toBe("synthetic_proof_db");
    expect(fixture.proofs.has(proof.proofId)).toBe(true);
    expect(() =>
      createSourceOwnershipProofStore({
        sourceIssuer: "has space",
        client: namedClient,
        databaseName: "x",
      })
    ).toThrow(SourceOwnershipProofError);
  });
});

interface RunningMongo {
  child: ChildProcess;
  pid: number;
  dbPath: string;
  port: number;
  client: MongoClient;
}

const proofMongoEnabled = process.env["AHD_SOURCE_OWNERSHIP_PROOF_MONGO_TEST"] === "true";
const proofMongoDescribe = proofMongoEnabled ? describe : describe.skip;
const spawnErrors = new WeakMap<ChildProcess, Error>();

class ProofFixtureSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofFixtureSafetyError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function waitForMs(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertProofFixtureSpace(): void {
  const stats = statfsSync("/dev/shm");
  const availableBytes = Number(stats.bavail) * Number(stats.bsize);
  if (availableBytes < 2 * 1024 * 1024 * 1024) {
    throw new Error("proof Mongo fixture requires 2 GiB free at /dev/shm");
  }
}

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("proof fixture did not receive a TCP port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return port;
}

function proofProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function waitProofChildExit(child: ChildProcess, timeoutMS: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const deadline = Date.now() + timeoutMS;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await waitForMs(50);
  }
  if (child.exitCode === null && child.signalCode === null) {
    throw new Error(`proof mongod ${child.pid ?? "unknown"} did not exit in time`);
  }
}

async function assertOwnedProofServer(
  client: MongoClient,
  child: ChildProcess
): Promise<{ setName?: string; isWritablePrimary?: boolean }> {
  const pid = child.pid;
  const spawnError = spawnErrors.get(child);
  if (spawnError) throw new ProofFixtureSafetyError(`proof mongod failed: ${spawnError.message}`);
  if (!pid || child.exitCode !== null || child.signalCode !== null || !proofProcessAlive(pid)) {
    throw new ProofFixtureSafetyError(`proof mongod PID ${pid ?? "unknown"} is not live`);
  }
  const status = (await client.db("admin").command({ serverStatus: 1 })) as { pid?: unknown };
  if (Number(status.pid) !== pid) {
    throw new ProofFixtureSafetyError("proof Mongo PID mismatch: refusing to write");
  }
  return (await client.db("admin").command({ hello: 1 })) as {
    setName?: string;
    isWritablePrimary?: boolean;
  };
}

async function waitProofMongo(child: ChildProcess, uri: string): Promise<MongoClient> {
  const deadline = Date.now() + 25000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("proof mongod exited before readiness");
    }
    const client = new MongoClient(uri, {
      connectTimeoutMS: 500,
      serverSelectionTimeoutMS: 500,
      directConnection: true,
      retryWrites: false,
    });
    try {
      await client.connect();
      const hello = await assertOwnedProofServer(client, child);
      if (hello.setName === "rs0" && hello.isWritablePrimary === true) return client;
      await client.close();
      await waitForMs(100);
    } catch (error) {
      lastError = error;
      await client.close().catch(() => undefined);
      if (error instanceof ProofFixtureSafetyError) throw error;
      await waitForMs(100);
    }
  }
  throw new Error(`proof mongod did not become ready: ${String(lastError)}`);
}

async function terminateOwnedProofProcess(child: ChildProcess, pid: number): Promise<void> {
  if (child.exitCode === null && child.signalCode === null && proofProcessAlive(pid)) {
    child.kill("SIGTERM");
  }
  try {
    await waitProofChildExit(child, 8000);
  } catch {
    if (proofProcessAlive(pid)) child.kill("SIGKILL");
    await waitProofChildExit(child, 8000);
  }
  if (proofProcessAlive(pid)) throw new Error(`proof mongod ${pid} survived cleanup`);
}

proofMongoDescribe("source ownership proof against owned replica set", { timeout: 120000 }, () => {
  let replica: RunningMongo | undefined;
  let databaseName: string = "";

  beforeAll(async () => {
    try {
      execFileSync("mongod", ["--version"], { stdio: "ignore" });
    } catch (error) {
      throw new Error(
        `AHD_SOURCE_OWNERSHIP_PROOF_MONGO_TEST=true requires mongod: ${String(error)}`
      );
    }
    assertProofFixtureSpace();
    const dbPath = mkdtempSync(join("/dev/shm", "ahd-source-proof-"));
    const port = await unusedLoopbackPort();
    const child = spawn(
      "mongod",
      [
        "--dbpath",
        dbPath,
        "--bind_ip",
        "127.0.0.1",
        "--port",
        String(port),
        "--replSet",
        "rs0",
        "--oplogSize",
        "64",
        "--setParameter",
        "enableTestCommands=1",
        "--quiet",
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    child.once("error", (error) => spawnErrors.set(child, error));
    child.stdout?.resume();
    child.stderr?.resume();
    if (!child.pid) throw new Error("proof mongod did not provide an owned PID");
    const pid = child.pid;
    try {
      const bootstrap = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, {
        connectTimeoutMS: 500,
        serverSelectionTimeoutMS: 500,
        directConnection: true,
        retryWrites: false,
      });
      const bootstrapDeadline = Date.now() + 25000;
      let bootstrapped = false;
      let bootstrapError: unknown;
      while (Date.now() < bootstrapDeadline && !bootstrapped) {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error("proof mongod exited before bootstrap");
        }
        try {
          await bootstrap.connect();
          bootstrapped = true;
        } catch (error) {
          bootstrapError = error;
          await waitForMs(100);
        }
      }
      if (!bootstrapped) throw bootstrapError;
      await assertOwnedProofServer(bootstrap, child);
      try {
        await bootstrap.db("admin").command({
          replSetInitiate: { _id: "rs0", members: [{ _id: 0, host: `127.0.0.1:${port}` }] },
        });
      } finally {
        await bootstrap.close();
      }
      const client = await waitProofMongo(
        child,
        `mongodb://127.0.0.1:${port}/?replicaSet=rs0&directConnection=true`
      );
      replica = { child, pid, dbPath, port, client };
      databaseName = `source_proof_${new ObjectId().toHexString()}`;
      await replica.client.db(databaseName).createCollection("authSourceOwnershipProofs");
    } catch (error) {
      try {
        await terminateOwnedProofProcess(child, pid);
      } catch {
        // Setup already failed; report the original error below.
      }
      rmSync(dbPath, { recursive: true, force: false });
      throw error;
    }
  }, 60000);

  afterAll(async () => {
    if (replica) {
      const instance = replica;
      replica = undefined;
      await instance.client.close().catch(() => undefined);
      await terminateOwnedProofProcess(instance.child, instance.pid);
      rmSync(instance.dbPath, { recursive: true, force: false });
    }
  }, 30000);

  async function seedUser(): Promise<ObjectId> {
    const db = replica!.client.db(databaseName);
    const id = new ObjectId();
    await db.collection("users").insertOne({
      _id: id,
      password: HASH,
      role: "player",
      isAdmin: false,
      isBanned: false,
    });
    return id;
  }

  function realStore() {
    return createSourceOwnershipProofStore({
      sourceIssuer: ISSUER,
      client: replica!.client,
      databaseName,
    });
  }

  it("issues a proof with an atomic anchor and stores no secrets", async () => {
    const id = await seedUser();
    const hex = id.toHexString();
    const store = realStore();
    const proof = await store.issuePasswordProof({
      sourceAccountId: hex,
      password: PASSWORD,
      reserveEnrollment: async () => goodReservationFor(hex),
    });
    expect(proof.sourceAccountId).toBe(hex);
    expect(proof.expiresAtMs - proof.observedAtMs).toBe(270000);
    const db = replica!.client.db(databaseName);
    const user = (await db.collection("users").findOne({ _id: id })) as unknown as FakeDoc;
    expect((user["sourceOwnershipProofAnchor"] as FakeDoc)["proofId"]).toBe(proof.proofId);
    const stored = (await db
      .collection<{ _id: string }>("authSourceOwnershipProofs")
      .findOne({ _id: proof.proofId })) as unknown as FakeDoc;
    expect(stored["snapshotDigest"]).toBe(proof.snapshotDigest);
    expect(Object.keys(stored).sort()).toEqual(
      [
        "_id",
        "version",
        "sourceIssuer",
        "sourceAccountId",
        "canonicalAccountId",
        "enrollmentOperationId",
        "snapshotVersion",
        "snapshotDigest",
        "method",
        "retainedMethods",
        "observedAt",
        "expiresAt",
        "observationWindowMs",
      ].sort()
    );
    const blob = JSON.stringify(stored);
    expect(blob).not.toContain(PASSWORD);
    expect(blob).not.toContain(HASH);
    const loaded = await store.loadProof({ proofId: proof.proofId });
    expect(loaded?.proof).toEqual(proof);
    expect(loaded?.expired).toBe(false);
  });

  it("writes nothing for a wrong password", async () => {
    const id = await seedUser();
    const hex = id.toHexString();
    const reserve = makeReserve();
    const db = replica!.client.db(databaseName);
    const proofsBefore = await db.collection("authSourceOwnershipProofs").countDocuments({});
    await expect(
      realStore().issuePasswordProof({
        sourceAccountId: hex,
        password: WRONG,
        reserveEnrollment: reserve,
      })
    ).rejects.toThrow();
    expect(reserve.calls).toBe(0);
    const user = (await db.collection("users").findOne({ _id: id })) as unknown as FakeDoc;
    expect(user).not.toHaveProperty("sourceOwnershipProofAnchor");
    expect(await db.collection("authSourceOwnershipProofs").countDocuments({})).toBe(proofsBefore);
  });

  it("rejects when the password changes after verify and writes nothing", async () => {
    const id = await seedUser();
    const hex = id.toHexString();
    const store = realStore();
    const dbBefore = replica!.client.db(databaseName);
    const proofsBefore = await dbBefore.collection("authSourceOwnershipProofs").countDocuments({});
    await expect(
      store.issuePasswordProof({
        sourceAccountId: hex,
        password: PASSWORD,
        reserveEnrollment: async (input) => {
          await replica!.client
            .db(databaseName)
            .collection("users")
            .updateOne({ _id: id }, { $set: { password: OTHER_HASH } });
          return goodReservationFor(hex, input.sourceIssuer);
        },
      })
    ).rejects.toThrow();
    const db = replica!.client.db(databaseName);
    const user = (await db.collection("users").findOne({ _id: id })) as unknown as FakeDoc;
    expect(user).not.toHaveProperty("sourceOwnershipProofAnchor");
    expect(await db.collection("authSourceOwnershipProofs").countDocuments({})).toBe(proofsBefore);
  });

  it("rechecks security after a write conflict between the transaction read and anchor", async () => {
    const id = await seedUser();
    const db = replica!.client.db(databaseName);
    const users = db.collection("users");
    const read = users.findOne.bind(users);
    let raced = false;
    const spy = vi.spyOn(users, "findOne").mockImplementation(async (filter, options) => {
      const document = await read(filter, options);
      if (options?.session && !raced) {
        raced = true;
        await db.collection("users").updateOne({ _id: id }, { $set: { password: OTHER_HASH } });
      }
      return document;
    });
    const hookedDb = new Proxy(db, {
      get(target, key) {
        if (key === "collection")
          return (name: string) => (name === "users" ? users : target.collection(name));
        return Reflect.get(target, key, target);
      },
    });
    const store = createSourceOwnershipProofStore({
      sourceIssuer: ISSUER,
      client: replica!.client,
      db: hookedDb,
    });
    const proofsBefore = await db.collection("authSourceOwnershipProofs").countDocuments({});
    let reservations = 0;
    try {
      await expect(
        store.issuePasswordProof({
          sourceAccountId: id.toHexString(),
          password: PASSWORD,
          reserveEnrollment: async () => {
            reservations += 1;
            return goodReservationFor(id.toHexString());
          },
        })
      ).rejects.toBeInstanceOf(SourceOwnershipProofError);
      expect(raced).toBe(true);
      expect(reservations).toBe(1);
      expect(await db.collection("users").findOne({ _id: id })).not.toHaveProperty(
        "sourceOwnershipProofAnchor"
      );
      expect(await db.collection("authSourceOwnershipProofs").countDocuments({})).toBe(
        proofsBefore
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("rolls the anchor back when the proof insert fails", async () => {
    const id = await seedUser();
    const hex = id.toHexString();
    const dbCount = replica!.client.db(databaseName);
    const proofsBefore = await dbCount.collection("authSourceOwnershipProofs").countDocuments({});
    await replica!.client.db("admin").command({
      configureFailPoint: "failCommand",
      mode: { times: 1 },
      data: { failCommands: ["insert"], errorCode: 8 },
    });
    try {
      await expect(
        realStore().issuePasswordProof({
          sourceAccountId: hex,
          password: PASSWORD,
          reserveEnrollment: async () => goodReservationFor(hex),
        })
      ).rejects.toThrow();
    } finally {
      await replica!.client
        .db("admin")
        .command({ configureFailPoint: "off" })
        .catch(() => undefined);
    }
    const db = replica!.client.db(databaseName);
    const user = (await db.collection("users").findOne({ _id: id })) as unknown as FakeDoc;
    expect(user).not.toHaveProperty("sourceOwnershipProofAnchor");
    expect(await db.collection("authSourceOwnershipProofs").countDocuments({})).toBe(proofsBefore);
  });
});

function goodReservationFor(hex: string, issuer: string = ISSUER): SourceOwnershipReservation {
  return {
    version: 1,
    sourceIssuer: issuer,
    sourceSubject: hex,
    canonicalAccountId: CANONICAL,
    enrollmentOperationId: ENROLL,
  };
}
