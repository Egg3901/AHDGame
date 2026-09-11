import { createHash, randomUUID } from "node:crypto";
import {
  MongoServerError,
  ObjectId,
  ReadPreference,
  type ClientSession,
  type Db,
  type Document,
  type MongoClient,
} from "mongodb";
import {
  runRequiredTransaction,
  RequiredTransactionCleanupError,
} from "@/lib/db/runRequiredTransaction";
import { invalidateCachedUser } from "./userDocCache";
import {
  captureSourceSecuritySnapshot,
  type SourceSecuritySnapshotUser,
} from "./sourceSecuritySnapshot";
import type { LoadedSourceOwnershipProof, SourceOwnershipProof } from "./sourceOwnershipProof";

const USERS = "users";
const CONSUMPTIONS = "sourceFenceConsumptions";
const RECEIPTS = "sourceFenceReceipts";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX24 = /^[0-9a-f]{24}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const BCRYPT12 = /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/;
const CONTROL = /[\x00-\x1f\x7f]/;

export type SourceFenceStatus =
  "COMMITTED" | "REPLAY_NO_MUTATION" | "CONFLICT" | "STALE" | "UNAVAILABLE" | "COMMIT_UNKNOWN";

export interface CentralFenceAttestation {
  readonly version: 1;
  readonly sourceIssuer: string;
  readonly sourceAccountId: string;
  readonly canonicalAccountId: string;
  readonly enrollmentOperationId: string;
  readonly fenceGeneration: string;
  readonly fenceAuthority: string;
  readonly fenceTokenHash: string;
  readonly fencedAtMs: number;
  readonly leaseExpiresAtMs: number;
  readonly targetIssuer: string;
  readonly targetSubject: string;
  readonly attestationDigest: string;
}

export interface SourceFenceResult {
  readonly status: SourceFenceStatus;
  readonly proofId?: string;
  readonly receiptId?: string;
  readonly sourceAccountId?: string;
  readonly canonicalAccountId?: string;
  readonly enrollmentOperationId?: string;
  readonly snapshotDigest?: string;
  readonly fencedAt?: string;
}

export interface SourceFenceWriterConfig {
  readonly client: MongoClient;
  readonly db: Db;
  readonly sourceIssuer: string;
  readonly clockSkewBoundMs: number;
  readonly clockSkewEvidence: string;
  readonly loadSourceProof: (
    input: Readonly<{ proofId: string }>,
    options: Readonly<{ signal: AbortSignal }>
  ) => Promise<LoadedSourceOwnershipProof | null>;
  readonly loadCentralFenceAttestation: (
    input: Readonly<{ canonicalAccountId: string; enrollmentOperationId: string }>,
    options: Readonly<{ signal: AbortSignal }>
  ) => Promise<CentralFenceAttestation | null>;
  readonly proofTimeoutMs?: number;
  readonly attestationTimeoutMs?: number;
}

type StoredBinding = {
  _id: string;
  sourceIssuer: string;
  sourceAccountId: string;
  canonicalAccountId: string;
  enrollmentOperationId: string;
  snapshotDigest: string;
  proofDigest: string;
  receiptId: string;
  consumedAt: Date;
};

type StoredReceipt = {
  _id: string;
  proofId: string;
  sourceIssuer: string;
  sourceAccountId: string;
  canonicalAccountId: string;
  enrollmentOperationId: string;
  snapshotDigest: string;
  proofDigest: string;
  passwordDigest: string;
  securitySnapshot: Document;
  fencedAt: Date;
};

class StaleFenceError extends Error {}
class ConflictFenceError extends Error {}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function safeText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    value.isWellFormed() &&
    !CONTROL.test(value) &&
    value === value.trim()
  );
}

function canonical(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, value[key]])
    )
  );
}

function proofBinding(proof: SourceOwnershipProof): Record<string, unknown> {
  return {
    canonicalAccountId: proof.canonicalAccountId,
    enrollmentOperationId: proof.enrollmentOperationId,
    expiresAtMs: proof.expiresAtMs,
    method: proof.method,
    observationWindowMs: proof.observationWindowMs,
    observedAtMs: proof.observedAtMs,
    proofId: proof.proofId,
    retainedMethods: [...proof.retainedMethods],
    snapshotDigest: proof.snapshotDigest,
    snapshotVersion: proof.snapshotVersion,
    sourceAccountId: proof.sourceAccountId,
    sourceIssuer: proof.sourceIssuer,
    version: proof.version,
  };
}

export function sourceProofDigest(proof: SourceOwnershipProof): string {
  return sha256(canonical(proofBinding(proof)));
}

export function centralAttestationDigest(
  attestation: Omit<CentralFenceAttestation, "attestationDigest">
): string {
  return sha256(canonical(attestation as unknown as Record<string, unknown>));
}

function validateProof(
  value: LoadedSourceOwnershipProof | null,
  proofId: string,
  issuer: string
): { proof: SourceOwnershipProof; fresh: boolean } {
  if (!value || typeof value.expired !== "boolean" || !Number.isSafeInteger(value.sourceNowMs))
    throw new StaleFenceError();
  const proof = value.proof;
  if (
    !exactKeys(proof, [
      "canonicalAccountId",
      "enrollmentOperationId",
      "expiresAtMs",
      "method",
      "observationWindowMs",
      "observedAtMs",
      "proofId",
      "retainedMethods",
      "snapshotDigest",
      "snapshotVersion",
      "sourceAccountId",
      "sourceIssuer",
      "version",
    ])
  )
    throw new StaleFenceError();
  if (
    proof.version !== 1 ||
    proof.snapshotVersion !== 1 ||
    proof.method !== "password" ||
    proof.observationWindowMs !== 30_000 ||
    proof.proofId !== proofId ||
    proof.sourceIssuer !== issuer ||
    !UUID.test(proof.proofId) ||
    !HEX24.test(proof.sourceAccountId) ||
    !UUID.test(proof.canonicalAccountId) ||
    !UUID.test(proof.enrollmentOperationId) ||
    !HEX64.test(proof.snapshotDigest) ||
    proof.retainedMethods.length !== 1 ||
    proof.retainedMethods[0] !== "password" ||
    !Number.isSafeInteger(proof.observedAtMs) ||
    !Number.isSafeInteger(proof.expiresAtMs) ||
    proof.expiresAtMs - proof.observedAtMs !== 270_000 ||
    value.sourceNowMs < proof.observedAtMs ||
    value.expired !== value.sourceNowMs >= proof.expiresAtMs
  ) {
    throw new StaleFenceError();
  }
  return {
    proof: Object.freeze({ ...proof, retainedMethods: Object.freeze([...proof.retainedMethods]) }),
    fresh: value.sourceNowMs < proof.expiresAtMs,
  };
}

const ATTESTATION_KEYS = [
  "attestationDigest",
  "canonicalAccountId",
  "enrollmentOperationId",
  "fenceAuthority",
  "fenceGeneration",
  "fenceTokenHash",
  "fencedAtMs",
  "leaseExpiresAtMs",
  "sourceAccountId",
  "sourceIssuer",
  "targetIssuer",
  "targetSubject",
  "version",
];

function validateAttestation(
  value: CentralFenceAttestation | null,
  proof: SourceOwnershipProof
): CentralFenceAttestation {
  if (!exactKeys(value, ATTESTATION_KEYS)) throw new StaleFenceError();
  const item = value as unknown as CentralFenceAttestation;
  const unsigned = { ...item } as Record<string, unknown>;
  delete unsigned["attestationDigest"];
  if (
    item.version !== 1 ||
    item.sourceIssuer !== proof.sourceIssuer ||
    item.sourceAccountId !== proof.sourceAccountId ||
    item.canonicalAccountId !== proof.canonicalAccountId ||
    item.enrollmentOperationId !== proof.enrollmentOperationId ||
    !/^[1-9][0-9]{0,18}$/.test(item.fenceGeneration) ||
    (item.fenceGeneration.length === 19 && item.fenceGeneration > "9223372036854775807") ||
    !safeText(item.fenceAuthority, 128) ||
    !HEX64.test(item.fenceTokenHash) ||
    !Number.isSafeInteger(item.fencedAtMs) ||
    item.fencedAtMs <= 0 ||
    !Number.isSafeInteger(item.leaseExpiresAtMs) ||
    !safeText(item.targetIssuer, 512) ||
    !safeText(item.targetSubject, 512) ||
    !HEX64.test(item.attestationDigest) ||
    centralAttestationDigest(
      unsigned as unknown as Omit<CentralFenceAttestation, "attestationDigest">
    ) !== item.attestationDigest
  ) {
    throw new StaleFenceError();
  }
  return Object.freeze({ ...item });
}

async function bounded<T>(
  timeoutMs: number,
  loader: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      loader(controller.signal),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener("abort", () => reject(new Error("unavailable")), {
          once: true,
        })
      ),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function success(
  status: "COMMITTED" | "REPLAY_NO_MUTATION",
  receipt: StoredReceipt
): SourceFenceResult {
  return Object.freeze({
    status,
    proofId: receipt.proofId,
    receiptId: receipt._id,
    sourceAccountId: receipt.sourceAccountId,
    canonicalAccountId: receipt.canonicalAccountId,
    enrollmentOperationId: receipt.enrollmentOperationId,
    snapshotDigest: receipt.snapshotDigest,
    fencedAt: receipt.fencedAt.toISOString(),
  });
}

function isUnknownCommit(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    Array.isArray((error as { errorLabels?: unknown }).errorLabels) &&
    (error as { errorLabels: unknown[] }).errorLabels.includes("UnknownTransactionCommitResult")
  );
}

function hasNoUsableSocialMethod(
  user: SourceSecuritySnapshotUser,
  key: "googleId" | "discordId"
): boolean {
  if (!Object.hasOwn(user, key)) return true;
  const value = user[key];
  return value === null || value === "";
}

export function createSourceFenceWriter(config: SourceFenceWriterConfig) {
  if (
    !config?.client ||
    typeof config.client.startSession !== "function" ||
    !config.db ||
    (config.db as unknown as { client?: unknown }).client !== config.client ||
    !safeText(config.sourceIssuer, 512) ||
    !Number.isSafeInteger(config.clockSkewBoundMs) ||
    config.clockSkewBoundMs <= 0 ||
    !safeText(config.clockSkewEvidence, 512) ||
    typeof config.loadSourceProof !== "function" ||
    typeof config.loadCentralFenceAttestation !== "function"
  ) {
    throw new TypeError("Invalid source fence writer configuration");
  }
  const proofTimeoutMs = config.proofTimeoutMs ?? 5_000;
  const attestationTimeoutMs = config.attestationTimeoutMs ?? 5_000;
  for (const timeout of [proofTimeoutMs, attestationTimeoutMs]) {
    if (!Number.isSafeInteger(timeout) || timeout < 10 || timeout > 10_000)
      throw new TypeError("Invalid source fence loader timeout");
  }
  const users = config.db.collection<SourceSecuritySnapshotUser>(USERS);
  const consumptions = config.db.collection<StoredBinding>(CONSUMPTIONS);
  const receipts = config.db.collection<StoredReceipt>(RECEIPTS);

  async function reconcile(proof: SourceOwnershipProof): Promise<SourceFenceResult | null> {
    const session = config.client.startSession();
    try {
      let result: SourceFenceResult | null = null;
      await session.withTransaction(
        async () => {
          const user = await users.findOne(
            { _id: new ObjectId(proof.sourceAccountId) },
            { session, projection: { authMigrationFence: 1 } }
          );
          const consumption = await consumptions.findOne({ _id: proof.proofId }, { session });
          const receipt = await receipts.findOne({ proofId: proof.proofId }, { session });
          if (!user || !Object.hasOwn(user, "authMigrationFence")) {
            if (consumption || receipt) result = Object.freeze({ status: "CONFLICT" });
            return;
          }
          const fence = user.authMigrationFence as Record<string, unknown>;
          const digest = sourceProofDigest(proof);
          const exact =
            consumption &&
            receipt &&
            fence?.["v"] === 1 &&
            fence["proofId"] === proof.proofId &&
            fence["receiptId"] === receipt._id &&
            consumption.receiptId === receipt._id &&
            consumption.proofDigest === digest &&
            receipt.proofDigest === digest &&
            receipt.sourceAccountId === proof.sourceAccountId &&
            receipt.canonicalAccountId === proof.canonicalAccountId &&
            receipt.enrollmentOperationId === proof.enrollmentOperationId &&
            receipt.snapshotDigest === proof.snapshotDigest;
          result = exact
            ? success("REPLAY_NO_MUTATION", receipt)
            : Object.freeze({ status: "CONFLICT" });
        },
        { readConcern: { level: "snapshot" }, readPreference: ReadPreference.primary }
      );
      return result;
    } finally {
      await session.endSession();
    }
  }

  async function applySourceFence(
    input: Readonly<{ proofId: string; provenance: string }>
  ): Promise<SourceFenceResult> {
    if (
      !exactKeys(input, ["proofId", "provenance"]) ||
      !UUID.test(input.proofId) ||
      !safeText(input.provenance, 256)
    ) {
      throw new TypeError("Invalid source fence input");
    }
    let loaded: LoadedSourceOwnershipProof | null;
    try {
      loaded = await bounded(proofTimeoutMs, (signal) =>
        config.loadSourceProof(Object.freeze({ proofId: input.proofId }), Object.freeze({ signal }))
      );
    } catch {
      return Object.freeze({ status: "UNAVAILABLE" });
    }
    let validated: { proof: SourceOwnershipProof; fresh: boolean };
    try {
      validated = validateProof(loaded, input.proofId, config.sourceIssuer);
    } catch {
      return Object.freeze({ status: "STALE" });
    }
    const { proof } = validated;
    let prior: SourceFenceResult | null;
    try {
      prior = await reconcile(proof);
    } catch {
      return Object.freeze({ status: "UNAVAILABLE" });
    }
    if (prior) return prior;
    if (!validated.fresh) return Object.freeze({ status: "STALE" });

    let attestationValue: CentralFenceAttestation | null;
    try {
      attestationValue = await bounded(attestationTimeoutMs, (signal) =>
        config.loadCentralFenceAttestation(
          Object.freeze({
            canonicalAccountId: proof.canonicalAccountId,
            enrollmentOperationId: proof.enrollmentOperationId,
          }),
          Object.freeze({ signal })
        )
      );
    } catch {
      return Object.freeze({ status: "UNAVAILABLE" });
    }
    let attestation: CentralFenceAttestation;
    try {
      attestation = validateAttestation(attestationValue, proof);
    } catch {
      return Object.freeze({ status: "STALE" });
    }

    const receiptId = randomUUID();
    const proofDigest = sourceProofDigest(proof);
    const fencedAt = new Date();
    // A proof observed before the immutable central fence is the original
    // attempt and remains bounded by its lease. A proof observed after the
    // fence plus the proven clock-skew bound is fresh redrive authority under
    // the same permanent operation, so only its own freshness window applies.
    const postFenceProof = proof.observedAtMs >= attestation.fencedAtMs + config.clockSkewBoundMs;
    const deadline =
      (postFenceProof
        ? proof.expiresAtMs
        : Math.min(proof.expiresAtMs, attestation.leaseExpiresAtMs)) - config.clockSkewBoundMs;
    if (fencedAt.getTime() >= deadline) return Object.freeze({ status: "STALE" });
    let writeStarted = false;
    try {
      const committed = await runRequiredTransaction(
        async (session: ClientSession) => {
          const accountId = new ObjectId(proof.sourceAccountId);
          const user = await users.findOne({ _id: accountId }, { session });
          if (!user) throw new StaleFenceError();
          const snapshot = captureSourceSecuritySnapshot(user, {
            sourceIssuer: proof.sourceIssuer,
            sourceAccountId: proof.sourceAccountId,
            canonicalAccountId: proof.canonicalAccountId,
            enrollmentOperationId: proof.enrollmentOperationId,
          });
          if (
            snapshot.snapshotDigest !== proof.snapshotDigest ||
            typeof user.password !== "string" ||
            !BCRYPT12.test(user.password) ||
            !hasNoUsableSocialMethod(user, "googleId") ||
            !hasNoUsableSocialMethod(user, "discordId") ||
            user.role !== "player" ||
            (Object.hasOwn(user, "isBanned") && user.isBanned !== false) ||
            (Object.hasOwn(user, "isAdmin") && user.isAdmin !== false)
          ) {
            throw new StaleFenceError();
          }
          const clock = await users
            .aggregate<{ now: Date }>(
              [{ $match: { _id: accountId } }, { $project: { _id: 0, now: "$$NOW" } }],
              { session }
            )
            .next();
          if (!clock?.now || clock.now.getTime() >= deadline) throw new StaleFenceError();
          writeStarted = true;
          await consumptions.insertOne(
            {
              _id: proof.proofId,
              sourceIssuer: proof.sourceIssuer,
              sourceAccountId: proof.sourceAccountId,
              canonicalAccountId: proof.canonicalAccountId,
              enrollmentOperationId: proof.enrollmentOperationId,
              snapshotDigest: proof.snapshotDigest,
              proofDigest,
              receiptId,
              consumedAt: fencedAt,
            },
            { session }
          );
          const fence = Object.freeze({
            v: 1,
            proofId: proof.proofId,
            receiptId,
            operationId: proof.enrollmentOperationId,
            canonicalAccountId: proof.canonicalAccountId,
            snapshotDigest: proof.snapshotDigest,
            fencedAt,
          });
          const changed = await users.updateOne(
            {
              _id: accountId,
              authMigrationFence: { $exists: false },
              accountDeletion: { $exists: false },
              $expr: { $lt: ["$$NOW", new Date(deadline)] },
            },
            { $set: { authMigrationFence: fence }, $max: { authRevokedAt: fencedAt } },
            { session }
          );
          if (!changed.acknowledged || changed.matchedCount !== 1) throw new StaleFenceError();
          const receipt: StoredReceipt = {
            _id: receiptId,
            proofId: proof.proofId,
            sourceIssuer: proof.sourceIssuer,
            sourceAccountId: proof.sourceAccountId,
            canonicalAccountId: proof.canonicalAccountId,
            enrollmentOperationId: proof.enrollmentOperationId,
            snapshotDigest: proof.snapshotDigest,
            proofDigest,
            passwordDigest: user.password,
            securitySnapshot: JSON.parse(snapshot.canonicalEncoding) as Document,
            fencedAt,
          };
          await receipts.insertOne(receipt, { session });
          return success("COMMITTED", receipt);
        },
        { client: config.client }
      );
      invalidateCachedUser(proof.sourceAccountId);
      return committed;
    } catch (error) {
      if (error instanceof RequiredTransactionCleanupError) {
        invalidateCachedUser(proof.sourceAccountId);
        return error.committedResult as SourceFenceResult;
      }
      if (error instanceof StaleFenceError) {
        return (await reconcile(proof).catch(() => null)) ?? Object.freeze({ status: "STALE" });
      }
      if (error instanceof ConflictFenceError) return Object.freeze({ status: "CONFLICT" });
      if (error instanceof MongoServerError && error.code === 11000) {
        return (
          (await reconcile(proof).catch(() => null)) ?? Object.freeze({ status: "COMMIT_UNKNOWN" })
        );
      }
      if (writeStarted || isUnknownCommit(error)) {
        invalidateCachedUser(proof.sourceAccountId);
        return (
          (await reconcile(proof).catch(() => null)) ?? Object.freeze({ status: "COMMIT_UNKNOWN" })
        );
      }
      return Object.freeze({ status: "UNAVAILABLE" });
    }
  }

  return Object.freeze({ applySourceFence });
}
