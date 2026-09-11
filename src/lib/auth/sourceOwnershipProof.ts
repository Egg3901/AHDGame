/**
 * Source password ownership proof (migration). A fresh password check binds
 * one source account to one enrollment operation for 5 minutes: see
 * createSourceOwnershipProofStore. The proof never signs anyone in and never
 * changes fences, roles, or sessions.
 */

import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  ObjectId,
  ReadPreference,
  type ClientSession,
  type Document,
  type Db,
  type MongoClient,
} from "mongodb";
import {
  captureSourceSecuritySnapshot,
  type SourceSecuritySnapshotBinding,
} from "./sourceSecuritySnapshot";
import { verifySourcePasswordOwnership } from "./sourcePasswordOwnership";
import {
  RequiredTransactionCleanupError,
  runRequiredTransaction,
} from "@/lib/db/runRequiredTransaction";

const USERS_COLLECTION = "users";
const PROOFS_COLLECTION = "authSourceOwnershipProofs";

const OBSERVATION_WINDOW_MS = 30_000;
const PROOF_LIFETIME_MS = 270_000;
const TX_TIMEOUT_MS = 15_000;
const TX_MAX_COMMIT_TIME_MS = 5_000;
const MAX_STRING_LENGTH = 512;
const READ_TIMEOUT_MS = 5_000;
const safeCleanupErrors = new WeakSet<Error>();

const SOURCE_ACCOUNT_ID_PATTERN = /^[0-9a-f]{24}$/;
const UUID_V4_LOWERCASE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SNAPSHOT_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1f\x7f]/;
const WHITESPACE_PATTERN = /\s/;

const SECURITY_PROJECTION = {
  password: 1,
  googleId: 1,
  discordId: 1,
  role: 1,
  isAdmin: 1,
  isBanned: 1,
  authRevokedAt: 1,
  accountDeletion: 1,
  authMigrationFence: 1,
} as const;

const RESERVATION_KEYS = [
  "version",
  "sourceIssuer",
  "sourceSubject",
  "canonicalAccountId",
  "enrollmentOperationId",
] as const;

const STORED_PROOF_KEYS = [
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
] as const;

/** Generic validation failure. Messages never carry a password, hash, or digest. */
export class SourceOwnershipProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceOwnershipProofError";
  }
}

/**
 * The transaction outcome is unknown after the driver reported an uncertain
 * commit. The proof may or may not exist under `proofId`. Callers must
 * reconcile through an authenticated coordinator with that id. This never
 * claims an abort and never retries the write.
 */
export class SourceOwnershipProofOutcomeUnknownError extends Error {
  readonly proofId: string;

  constructor(proofId: string) {
    super("ownership proof outcome unknown");
    this.name = "SourceOwnershipProofOutcomeUnknownError";
    this.proofId = proofId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Exact version 1 enrollment reservation returned by the trusted coordinator. */
export interface SourceOwnershipReservation {
  readonly version: 1;
  readonly sourceIssuer: string;
  readonly sourceSubject: string;
  readonly canonicalAccountId: string;
  readonly enrollmentOperationId: string;
}

/**
 * Trusted metadata only enrollment hook. Receives one frozen object with
 * exactly sourceIssuer, sourceSubject, and signal. Never receives a password,
 * hash, user document, or target id. Makes no auth or routing change and
 * creates no account, fence, admission, provision, or session.
 */
export type ReserveEnrollment = (
  input: Readonly<{
    sourceIssuer: string;
    sourceSubject: string;
    signal: AbortSignal;
  }>
) => Promise<SourceOwnershipReservation>;

/** Frozen primitive proof. No hash, no plaintext, no canonical encoding. */
export interface SourceOwnershipProof {
  readonly proofId: string;
  readonly version: 1;
  readonly sourceIssuer: string;
  readonly sourceAccountId: string;
  readonly canonicalAccountId: string;
  readonly enrollmentOperationId: string;
  readonly snapshotVersion: 1;
  readonly snapshotDigest: string;
  readonly method: "password";
  readonly retainedMethods: readonly string[];
  readonly observedAtMs: number;
  readonly expiresAtMs: number;
  readonly observationWindowMs: 30000;
}

export interface IssuePasswordProofInput {
  readonly sourceAccountId: string;
  readonly password: string;
  readonly reserveEnrollment: ReserveEnrollment;
}

export interface LoadProofInput {
  readonly proofId: string;
}

export interface LoadedSourceOwnershipProof {
  readonly proof: SourceOwnershipProof;
  readonly sourceNowMs: number;
  readonly expired: boolean;
}

export interface SourceOwnershipProofStore {
  readonly issuePasswordProof: (input: IssuePasswordProofInput) => Promise<SourceOwnershipProof>;
  readonly loadProof: (input: LoadProofInput) => Promise<LoadedSourceOwnershipProof | null>;
}

export interface SourceOwnershipProofStoreConfig {
  readonly sourceIssuer: string;
  readonly client: MongoClient;
  readonly db?: Db;
  readonly databaseName?: string;
}

interface CommittedProofState {
  readonly proofId: string;
  readonly sourceIssuer: string;
  readonly sourceAccountId: string;
  readonly canonicalAccountId: string;
  readonly enrollmentOperationId: string;
  readonly snapshotDigest: string;
  readonly observedAtMs: number;
  readonly expiresAtMs: number;
}

function checkIssuer(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_STRING_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    WHITESPACE_PATTERN.test(value) ||
    !value.isWellFormed()
  ) {
    throw new SourceOwnershipProofError("invalid source issuer");
  }
  return value;
}

function checkAccountId(value: unknown): string {
  if (typeof value !== "string" || value.length !== 24 || !SOURCE_ACCOUNT_ID_PATTERN.test(value)) {
    throw new SourceOwnershipProofError("invalid source account");
  }
  return value;
}

function checkUuid(value: unknown): string {
  if (typeof value !== "string" || value.length !== 36 || !UUID_V4_LOWERCASE_PATTERN.test(value)) {
    throw new SourceOwnershipProofError("invalid operation binding");
  }
  return value;
}

function checkDigest(value: unknown): string {
  if (typeof value !== "string" || value.length !== 64 || !SNAPSHOT_DIGEST_PATTERN.test(value)) {
    throw new SourceOwnershipProofError("invalid snapshot digest");
  }
  return value;
}

function checkExactKeys(value: unknown, expected: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SourceOwnershipProofError("invalid operation binding");
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new SourceOwnershipProofError("invalid operation binding");
  }
}

function elapsedExceedsWindow(startedAt: number): boolean {
  return performance.now() - startedAt > OBSERVATION_WINDOW_MS;
}

function assertWithinWindow(startedAt: number): void {
  if (elapsedExceedsWindow(startedAt)) {
    throw new SourceOwnershipProofError("ownership proof window expired");
  }
}

function hasUnknownCommitLabel(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const labels = (error as { errorLabels?: unknown }).errorLabels;
  return Array.isArray(labels) && labels.includes("UnknownTransactionCommitResult");
}

function resolveDb(config: SourceOwnershipProofStoreConfig): Db {
  if (!config || typeof config !== "object") {
    throw new SourceOwnershipProofError("invalid proof store configuration");
  }
  if (!config.client || typeof config.client.startSession !== "function") {
    throw new SourceOwnershipProofError("invalid proof store configuration");
  }
  if (config.db) {
    const owned = (config.db as unknown as { client?: unknown }).client;
    if (owned !== config.client) {
      throw new SourceOwnershipProofError("invalid proof store configuration");
    }
    return config.db;
  }
  const name = config.databaseName;
  if (
    typeof name !== "string" ||
    name.length < 1 ||
    name.length > 128 ||
    CONTROL_CHARACTER_PATTERN.test(name) ||
    WHITESPACE_PATTERN.test(name) ||
    !name.isWellFormed() ||
    /[\\/.$"*<>:|?]/u.test(name)
  ) {
    throw new SourceOwnershipProofError("invalid proof store configuration");
  }
  return config.client.db(name);
}

function copyReservation(
  value: unknown,
  configuredIssuer: string,
  requestedSubject: string
): SourceOwnershipReservation {
  checkExactKeys(value, RESERVATION_KEYS);
  const record = value as Record<string, unknown>;
  if (record["version"] !== 1) {
    throw new SourceOwnershipProofError("invalid operation binding");
  }
  const sourceIssuer = checkIssuer(record["sourceIssuer"]);
  const sourceSubject = checkAccountId(record["sourceSubject"]);
  const canonicalAccountId = checkUuid(record["canonicalAccountId"]);
  const enrollmentOperationId = checkUuid(record["enrollmentOperationId"]);
  if (sourceIssuer !== configuredIssuer || sourceSubject !== requestedSubject) {
    throw new SourceOwnershipProofError("invalid operation binding");
  }
  return { version: 1, sourceIssuer, sourceSubject, canonicalAccountId, enrollmentOperationId };
}

function freezeProof(state: CommittedProofState): SourceOwnershipProof {
  return Object.freeze({
    proofId: state.proofId,
    version: 1 as const,
    sourceIssuer: state.sourceIssuer,
    sourceAccountId: state.sourceAccountId,
    canonicalAccountId: state.canonicalAccountId,
    enrollmentOperationId: state.enrollmentOperationId,
    snapshotVersion: 1 as const,
    snapshotDigest: state.snapshotDigest,
    method: "password" as const,
    retainedMethods: Object.freeze(["password"]),
    observedAtMs: state.observedAtMs,
    expiresAtMs: state.expiresAtMs,
    observationWindowMs: 30000 as const,
  });
}

function readAnchor(value: unknown, proofId: string): { observedAt: Date } {
  if (!value || typeof value !== "object") {
    throw new SourceOwnershipProofError("ownership anchor not confirmed");
  }
  const anchor = (value as { sourceOwnershipProofAnchor?: unknown }).sourceOwnershipProofAnchor;
  if (!anchor || typeof anchor !== "object") {
    throw new SourceOwnershipProofError("ownership anchor not confirmed");
  }
  const record = anchor as Record<string, unknown>;
  if (record["proofId"] !== proofId) {
    throw new SourceOwnershipProofError("ownership anchor not confirmed");
  }
  const observedAt = record["observedAt"];
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    throw new SourceOwnershipProofError("ownership anchor not confirmed");
  }
  return { observedAt };
}

/**
 * Create the disconnected durable source password ownership proof kernel.
 * The factory holds the exact trusted sourceIssuer plus the source client
 * and database. There are no env defaults. Neither returned function is HTTP.
 */
export function createSourceOwnershipProofStore(
  config: SourceOwnershipProofStoreConfig
): SourceOwnershipProofStore {
  const sourceIssuer = checkIssuer(config?.sourceIssuer);
  const client = config?.client;
  if (!client || typeof client.startSession !== "function") {
    throw new SourceOwnershipProofError("invalid proof store configuration");
  }
  const db = resolveDb({ ...config, sourceIssuer });

  async function issuePasswordProof(input: IssuePasswordProofInput): Promise<SourceOwnershipProof> {
    if (!input || typeof input !== "object") {
      throw new SourceOwnershipProofError("invalid proof request");
    }
    checkExactKeys(input, ["sourceAccountId", "password", "reserveEnrollment"]);
    const password = input.password;
    const reserveEnrollment = input.reserveEnrollment;
    if (typeof reserveEnrollment !== "function") {
      throw new SourceOwnershipProofError("invalid proof request");
    }
    const sourceAccountId = checkAccountId(input.sourceAccountId);
    const proofId = randomUUID();
    checkUuid(proofId);
    const startedAt = performance.now();

    const accountObjectId = new ObjectId(sourceAccountId);
    const users = db.collection(USERS_COLLECTION);
    const original = (await users.findOne(
      { _id: accountObjectId },
      {
        readPreference: ReadPreference.primary,
        projection: SECURITY_PROJECTION,
        timeoutMS: READ_TIMEOUT_MS,
        maxTimeMS: READ_TIMEOUT_MS,
      }
    )) as unknown as Record<string, unknown> | null;
    if (!original || typeof original !== "object") {
      throw new SourceOwnershipProofError("account not eligible");
    }

    const verified = await verifySourcePasswordOwnership(
      original as unknown as Parameters<typeof verifySourcePasswordOwnership>[0],
      password
    );
    if (verified !== true) {
      throw new SourceOwnershipProofError("verification failed");
    }

    const remainingMs = OBSERVATION_WINDOW_MS - (performance.now() - startedAt);
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      throw new SourceOwnershipProofError("ownership proof window expired");
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reservation: SourceOwnershipReservation;
    try {
      // Only the metadata callback is raced. Mongo writes always finish through
      // the driver's required transaction and are never detached by a timer.
      const offered = await Promise.race([
        Promise.resolve().then(() =>
          reserveEnrollment(
            Object.freeze({
              sourceIssuer,
              sourceSubject: sourceAccountId,
              signal: controller.signal,
            })
          )
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new SourceOwnershipProofError("ownership proof window expired"));
          }, remainingMs);
        }),
      ]);
      if (controller.signal.aborted) {
        throw new SourceOwnershipProofError("ownership proof window expired");
      }
      reservation = copyReservation(offered, sourceIssuer, sourceAccountId);
    } catch {
      throw new SourceOwnershipProofError("ownership reservation unavailable");
    } finally {
      clearTimeout(timer);
      controller.abort();
    }

    const binding: SourceSecuritySnapshotBinding = {
      sourceIssuer: reservation.sourceIssuer,
      sourceAccountId: reservation.sourceSubject,
      canonicalAccountId: reservation.canonicalAccountId,
      enrollmentOperationId: reservation.enrollmentOperationId,
    };
    const expected = captureSourceSecuritySnapshot(
      original as unknown as Parameters<typeof captureSourceSecuritySnapshot>[0],
      binding
    );
    assertWithinWindow(startedAt);

    const expectedDigest = expected.snapshotDigest;
    const reserved = {
      sourceIssuer: reservation.sourceIssuer,
      sourceSubject: reservation.sourceSubject,
      canonicalAccountId: reservation.canonicalAccountId,
      enrollmentOperationId: reservation.enrollmentOperationId,
    };

    let committed: CommittedProofState;
    let committedCandidate: CommittedProofState | undefined;
    try {
      committed = await runRequiredTransaction<CommittedProofState>(
        async (session: ClientSession) => {
          const current = (await users.findOne(
            { _id: accountObjectId },
            { session, projection: SECURITY_PROJECTION }
          )) as unknown as Record<string, unknown> | null;
          if (!current || typeof current !== "object") {
            throw new SourceOwnershipProofError("account not eligible");
          }
          const live = captureSourceSecuritySnapshot(
            current as unknown as Parameters<typeof captureSourceSecuritySnapshot>[0],
            binding
          );
          if (live.snapshotDigest !== expectedDigest) {
            throw new SourceOwnershipProofError("account changed during proof");
          }
          assertWithinWindow(startedAt);
          const anchored = (await users.findOneAndUpdate(
            { _id: accountObjectId },
            [
              {
                $set: {
                  sourceOwnershipProofAnchor: {
                    proofId: { $literal: proofId },
                    observedAt: "$$NOW",
                  },
                },
              },
            ],
            { session, returnDocument: "after", projection: { sourceOwnershipProofAnchor: 1 } }
          )) as unknown as Record<string, unknown> | null;
          const { observedAt } = readAnchor(anchored, proofId);
          assertWithinWindow(startedAt);
          const observedAtMs = observedAt.getTime();
          if (!Number.isSafeInteger(observedAtMs)) {
            throw new SourceOwnershipProofError("ownership anchor not confirmed");
          }
          const expiresAtMs = observedAtMs + PROOF_LIFETIME_MS;
          if (!Number.isSafeInteger(expiresAtMs)) {
            throw new SourceOwnershipProofError("ownership anchor not confirmed");
          }
          assertWithinWindow(startedAt);
          await db.collection<Document & { _id: string }>(PROOFS_COLLECTION).insertOne(
            {
              _id: proofId,
              version: 1,
              sourceIssuer: reserved.sourceIssuer,
              sourceAccountId: reserved.sourceSubject,
              canonicalAccountId: reserved.canonicalAccountId,
              enrollmentOperationId: reserved.enrollmentOperationId,
              snapshotVersion: 1,
              snapshotDigest: expectedDigest,
              method: "password",
              retainedMethods: ["password"],
              observedAt,
              expiresAt: new Date(expiresAtMs),
              observationWindowMs: OBSERVATION_WINDOW_MS,
            },
            { session }
          );
          assertWithinWindow(startedAt);
          const candidate: CommittedProofState = {
            proofId,
            sourceIssuer: reserved.sourceIssuer,
            sourceAccountId: reserved.sourceSubject,
            canonicalAccountId: reserved.canonicalAccountId,
            enrollmentOperationId: reserved.enrollmentOperationId,
            snapshotDigest: expectedDigest,
            observedAtMs,
            expiresAtMs,
          };
          committedCandidate = candidate;
          return candidate;
        },
        { client, timeoutMS: TX_TIMEOUT_MS, maxCommitTimeMS: TX_MAX_COMMIT_TIME_MS }
      );
    } catch (error) {
      if (error instanceof RequiredTransactionCleanupError && committedCandidate) {
        const failure = new RequiredTransactionCleanupError(
          freezeProof(committedCandidate),
          undefined
        );
        safeCleanupErrors.add(failure);
        throw failure;
      }
      if (hasUnknownCommitLabel(error)) {
        throw new SourceOwnershipProofOutcomeUnknownError(proofId);
      }
      throw error;
    }

    // Commit delay consumes the proof's lifetime. It cannot turn a committed
    // write into an apparent failure with no reconciliation identifier.
    return freezeProof(committed);
  }

  async function loadProof(input: LoadProofInput): Promise<LoadedSourceOwnershipProof | null> {
    if (!input || typeof input !== "object") {
      throw new SourceOwnershipProofError("invalid proof request");
    }
    checkExactKeys(input, ["proofId"]);
    const proofId = checkUuid(input.proofId);
    const cursor = db
      .collection(PROOFS_COLLECTION)
      .aggregate(
        [{ $match: { _id: proofId } }, { $project: { _id: 0, doc: "$$ROOT", sourceNow: "$$NOW" } }],
        {
          readConcern: { level: "majority" },
          readPreference: ReadPreference.primary,
          timeoutMS: READ_TIMEOUT_MS,
          maxTimeMS: READ_TIMEOUT_MS,
        }
      );
    const rows = (await cursor.toArray()) as unknown[];
    const first = rows[0] as { doc?: unknown; sourceNow?: unknown } | undefined;
    if (!first || typeof first !== "object") return null;
    const { doc, sourceNow } = first;
    if (!(sourceNow instanceof Date) || !Number.isFinite(sourceNow.getTime())) {
      throw new SourceOwnershipProofError("invalid proof clock");
    }
    checkExactKeys(doc, STORED_PROOF_KEYS);
    const record = doc as Record<string, unknown>;
    if (record["_id"] !== proofId) {
      throw new SourceOwnershipProofError("invalid proof binding");
    }
    if (record["version"] !== 1 || record["snapshotVersion"] !== 1) {
      throw new SourceOwnershipProofError("invalid proof binding");
    }
    if (record["observationWindowMs"] !== OBSERVATION_WINDOW_MS) {
      throw new SourceOwnershipProofError("invalid proof binding");
    }
    if (record["method"] !== "password") {
      throw new SourceOwnershipProofError("invalid proof binding");
    }
    const retained = record["retainedMethods"];
    if (!Array.isArray(retained) || retained.length !== 1 || retained[0] !== "password") {
      throw new SourceOwnershipProofError("invalid proof binding");
    }
    const storedIssuer = checkIssuer(record["sourceIssuer"]);
    if (storedIssuer !== sourceIssuer) throw new SourceOwnershipProofError("invalid proof binding");
    const storedAccount = checkAccountId(record["sourceAccountId"]);
    const canonicalAccountId = checkUuid(record["canonicalAccountId"]);
    const enrollmentOperationId = checkUuid(record["enrollmentOperationId"]);
    const snapshotDigest = checkDigest(record["snapshotDigest"]);
    const observedAt = record["observedAt"];
    const expiresAt = record["expiresAt"];
    if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
      throw new SourceOwnershipProofError("invalid proof binding");
    }
    if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())) {
      throw new SourceOwnershipProofError("invalid proof binding");
    }
    const observedAtMs = observedAt.getTime();
    const expiresAtMs = expiresAt.getTime();
    if (!Number.isSafeInteger(observedAtMs) || !Number.isSafeInteger(expiresAtMs)) {
      throw new SourceOwnershipProofError("invalid proof binding");
    }
    if (expiresAtMs - observedAtMs !== PROOF_LIFETIME_MS) {
      throw new SourceOwnershipProofError("invalid proof binding");
    }
    const sourceNowMs = sourceNow.getTime();
    if (!Number.isSafeInteger(sourceNowMs) || sourceNowMs < observedAtMs) {
      throw new SourceOwnershipProofError("invalid proof clock");
    }
    const proof = freezeProof({
      proofId,
      sourceIssuer: storedIssuer,
      sourceAccountId: storedAccount,
      canonicalAccountId,
      enrollmentOperationId,
      snapshotDigest,
      observedAtMs,
      expiresAtMs,
    });
    return Object.freeze({ proof, sourceNowMs, expired: sourceNowMs >= expiresAtMs });
  }

  async function safeCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Error && safeCleanupErrors.has(error)) throw error;
      if (error instanceof SourceOwnershipProofOutcomeUnknownError) {
        throw new SourceOwnershipProofOutcomeUnknownError(checkUuid(error.proofId));
      }
      // Database, callback and hostile getter failures must not expose their
      // messages, causes, credentials or document values through this boundary.
      throw new SourceOwnershipProofError("ownership proof unavailable");
    }
  }

  return Object.freeze({
    issuePasswordProof: (input: IssuePasswordProofInput) =>
      safeCall(() => issuePasswordProof(input)),
    loadProof: (input: LoadProofInput) => safeCall(() => loadProof(input)),
  });
}
