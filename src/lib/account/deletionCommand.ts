/**
 * Account-deletion command kernel: single-document protocol on the user row.
 *
 * Guarantees: admission (`reserveDeletion`) is the only authorization event,
 * a single CAS binding the exact caller proof to the current credential,
 * privilege, revocation, fence, and deletion-absence snapshot. Execution
 * (`claimCommand`, `renewLease`, `checkpointDeletion`,
 * `confirmDeletionCompleted`) advances only for the holder of a live lease,
 * where liveness is evaluated by MongoDB at write time (`$$NOW`), never from
 * a caller-supplied timestamp. Completion keeps a terminal receipt; this
 * module never removes the user row.
 *
 * Caller prerequisites: admission callers pass an already crypto-verified
 * session payload plus a fresh account snapshot, with `args.userId`,
 * `snapshot._id`, and `caller.userId` all identical. Worker callers run in a
 * trusted server context and pass server time for audit fields and proposed
 * deadlines. `args.now` never decides lease liveness: every time-dependent
 * write guard uses `$expr` against `$$NOW`, and every proposed deadline must
 * itself be future at write time. Results are `denied` (bad input),
 * `conflict` (CAS mismatch, including expiry), or `unavailable` (transport).
 * No function retries internally and none performs I/O besides the injected
 * store handle.
 */

import { randomUUID } from "node:crypto";
import type { Filter, ObjectId, UpdateFilter } from "mongodb";
import type { AccountDeletionCommand, User } from "@/lib/db/types/user";
import { authMigrationFenceAbsentFilter, isAuthMigrationFenced } from "@/lib/auth/sourceFence";
import { authRevocationSnapshotFilter } from "@/lib/auth/sessionIssue";
import { invalidateCachedUser } from "@/lib/auth/userDocCache";

/** Document field carrying the deletion command. Absent means no command. */
export const DELETION_MARKER_FIELD = "accountDeletion" as const;

/** Default worker lease length. Bounded; the holder must renew or finish inside it. */
export const DELETION_LEASE_TTL_MS = 120_000;
/** Lease TTL bounds. Rejects both busy-loop short leases and unbounded holds. */
export const DELETION_LEASE_TTL_MIN_MS = 5_000;
export const DELETION_LEASE_TTL_MAX_MS = 600_000;
/** Authorizing session proof must be this fresh. No renew/relogin resume. */
export const DELETION_PROOF_MAX_AGE_MS = 15 * 60_000;
/** Future-dated proofs beyond this skew fail closed (bad clock, never trusted). */
export const DELETION_PROOF_FUTURE_SKEW_MS = 60_000;
/** Generation stamped on the first worker claim; reclaim increments by one. */
export const DELETION_INITIAL_GENERATION = 0;

/**
 * Minimal store surface the kernel needs. A real `Collection<User>` satisfies
 * this structurally; unit tests use an in-memory fake. Only these two methods
 * are ever called, so no broader DB access can creep in.
 */
export interface DeletionCommandStore {
  updateOne(
    filter: Filter<User>,
    update: UpdateFilter<User>
  ): Promise<{ acknowledged: boolean; matchedCount: number }>;
  findOne(filter: Filter<User>): Promise<User | null>;
}

/**
 * Already crypto-verified caller identity. The kernel cannot verify JWT
 * signatures: the caller passes the payload from `verifyAuth*` and it is
 * explicitly trusted as the authorization input, checked for exact account
 * match and freshness against the snapshot below.
 */
export interface VerifiedDeletionCaller {
  userId: string;
  iat: number;
}

/** Safe metadata copy of a well-formed command. Never carries credentials. */
export type DeletionCommandView = AccountDeletionCommand;

function isValidNow(now: unknown): now is Date {
  return now instanceof Date && Number.isFinite(now.getTime());
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * Freshness of an already-verified session proof against server time. Denies
 * missing, non-integer, negative, stale, and future-dated proofs, plus any
 * bad clock. Pure so routes and tests share the exact check.
 */
export function isFreshVerifiedIat(iat: unknown, now: Date): boolean {
  if (!isValidNow(now)) return false;
  if (typeof iat !== "number" || !Number.isSafeInteger(iat) || iat < 0) return false;
  const nowMs = now.getTime();
  const iatMs = iat * 1000;
  if (iatMs > nowMs + DELETION_PROOF_FUTURE_SKEW_MS) return false;
  if (nowMs - iatMs > DELETION_PROOF_MAX_AGE_MS) return false;
  return true;
}

/**
 * Presence of any deletion marker. Any present value, including null or a
 * malformed shape, counts as present and blocks new admission. Only an
 * absent field means no command.
 */
export function hasDeletionMarker(account: object | null | undefined): boolean {
  if (!account) return false;
  return Object.hasOwn(account, DELETION_MARKER_FIELD);
}

function isDeletionState(value: unknown): value is AccountDeletionCommand["state"] {
  return value === "reserved" || value === "cascading" || value === "complete";
}

/** Reservation ids are UUIDs minted by the default provider. */
const RESERVATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Worker ids are short opaque labels with no control characters. */
const WORKER_ID_RE = /^[^\u0000-\u001f\u007f]{1,128}$/;

const COMMAND_FIELDS = new Set([
  "state",
  "reservationId",
  "requestedAt",
  "requestedBySessionIat",
  "updatedAt",
  "workerId",
  "workerGeneration",
  "leaseExpiresAt",
]);

export function isValidReservationId(value: unknown): value is string {
  return typeof value === "string" && RESERVATION_ID_RE.test(value);
}

export function isValidWorkerId(value: unknown): value is string {
  return typeof value === "string" && WORKER_ID_RE.test(value);
}

/**
 * Narrow an unknown stored marker to a safe copy. Returns null for absent,
 * null, malformed, or over-privileged shapes (fail closed): unknown fields,
 * non-UUID reservation ids, out-of-shape worker ids, partial lease triples,
 * and `cascading`/`complete` without a full triple. Lease fields are all or
 * nothing: absent together only while `reserved` and waiting for the first
 * claim, present together otherwise. Dates are copied so callers cannot
 * mutate the row through the view.
 */
export function asWellFormedCommand(value: unknown): DeletionCommandView | null {
  if (typeof value !== "object" || value === null) return null;
  for (const key of Object.keys(value)) {
    if (!COMMAND_FIELDS.has(key)) return null;
  }
  if (
    !("state" in value) ||
    !("reservationId" in value) ||
    !("requestedAt" in value) ||
    !("requestedBySessionIat" in value) ||
    !("updatedAt" in value)
  ) {
    return null;
  }
  const { state, reservationId, requestedAt, requestedBySessionIat, updatedAt } = value as Record<
    string,
    unknown
  >;
  if (!isDeletionState(state)) return null;
  if (!isValidReservationId(reservationId)) return null;
  if (!isValidDate(requestedAt)) return null;
  if (
    typeof requestedBySessionIat !== "number" ||
    !Number.isSafeInteger(requestedBySessionIat) ||
    requestedBySessionIat < 0
  ) {
    return null;
  }
  if (!isValidDate(updatedAt)) return null;
  const rec = value as Record<string, unknown>;
  const hasWorker = Object.hasOwn(rec, "workerId");
  const hasGeneration = Object.hasOwn(rec, "workerGeneration");
  const hasLease = Object.hasOwn(rec, "leaseExpiresAt");
  const tripleCount = [hasWorker, hasGeneration, hasLease].filter(Boolean).length;
  if (tripleCount === 1 || tripleCount === 2) return null;
  if (tripleCount === 0 && state !== "reserved") return null;
  const out: DeletionCommandView = {
    state,
    reservationId,
    requestedAt: new Date(requestedAt.getTime()),
    requestedBySessionIat,
    updatedAt: new Date(updatedAt.getTime()),
  };
  if (tripleCount === 3) {
    if (!isValidWorkerId(rec.workerId)) return null;
    if (
      typeof rec.workerGeneration !== "number" ||
      !Number.isSafeInteger(rec.workerGeneration) ||
      rec.workerGeneration < 0
    ) {
      return null;
    }
    if (!isValidDate(rec.leaseExpiresAt)) return null;
    out.workerId = rec.workerId;
    out.workerGeneration = rec.workerGeneration;
    out.leaseExpiresAt = new Date((rec.leaseExpiresAt as Date).getTime());
  }
  return out;
}

/**
 * Read-only safe view of the command on a loaded account. Null when absent
 * or malformed (fail closed). Pair with `hasDeletionMarker` to distinguish
 * absent from malformed-present.
 */
export function readDeletionCommand(account: User | null | undefined): DeletionCommandView | null {
  if (!account || !hasDeletionMarker(account)) return null;
  return asWellFormedCommand(account.accountDeletion);
}

/** Advisory read-side check of a held lease as of the given time. Write guards use the database clock. */
export function isLeaseCurrentlyHeld(command: DeletionCommandView, now: Date): boolean {
  if (!isValidNow(now)) return false;
  if (typeof command.workerId !== "string" || command.workerId.length === 0) return false;
  if (!isValidDate(command.leaseExpiresAt)) return false;
  return command.leaseExpiresAt.getTime() > now.getTime();
}

/**
 * Revocation cutoffs mirror `credentialSessionIsCurrent`: absent or explicit
 * null is current, an exact-Date cutoff must strictly precede issue time, and
 * any malformed stored cutoff fails closed. Kept local so this kernel stays
 * off the generic logout/revocation write path, which must never carry fence
 * or deletion-absence predicates.
 */
function isRevocationCurrent(authRevokedAt: unknown, iat: number): boolean {
  if (authRevokedAt === undefined || authRevokedAt === null) return true;
  if (!isValidDate(authRevokedAt)) return false;
  return authRevokedAt.getTime() < iat * 1000;
}

export type AdmissionDenial = "principal" | "proof" | "admin" | "banned" | "revoked" | "fenced";

/**
 * Pure admission authorization over a fresh (never cached) account snapshot
 * and the explicitly trusted verified payload. Privilege comes from the
 * current snapshot only: a stale player claim never masks a promotion, and a
 * stale staff claim never survives a demotion. Credential state is checked
 * here and pinned again in the admission CAS, so a concurrent password,
 * provider-link, privilege, revocation, fence, or deletion write fails the
 * write instead of being silently overwritten.
 */
export function decideAdmission(
  snapshot: User,
  caller: VerifiedDeletionCaller | null,
  now: Date
): { ok: true } | { ok: false; denial: AdmissionDenial } {
  if (!caller || typeof caller.userId !== "string" || caller.userId.length === 0) {
    return { ok: false, denial: "principal" };
  }
  if (snapshot._id.toHexString() !== caller.userId) {
    return { ok: false, denial: "principal" };
  }
  if (!isFreshVerifiedIat(caller.iat, now)) {
    return { ok: false, denial: "proof" };
  }
  if (snapshot.isBanned === true) {
    return { ok: false, denial: "banned" };
  }
  if (snapshot.isAdmin === true || snapshot.role === "admin") {
    return { ok: false, denial: "admin" };
  }
  if (isAuthMigrationFenced(snapshot)) {
    return { ok: false, denial: "fenced" };
  }
  if (!isRevocationCurrent(snapshot.authRevokedAt, caller.iat)) {
    return { ok: false, denial: "revoked" };
  }
  return { ok: true };
}

export interface ReserveDeletionArgs {
  userId: ObjectId;
  /** Fresh `findOne` with no cache. The CAS below re-pins every field read here. */
  snapshot: User;
  /** Explicitly trusted post-crypto payload from `verifyAuth*`. */
  caller: VerifiedDeletionCaller | null;
  /** Server time, frozen into `requestedAt` on success. */
  now: Date;
  /** Override for tests. Defaults to `randomUUID`. Never a JWT or secret. */
  reservationId?: string;
  /** Cache eviction. Defaults to the canonical helper. */
  onInvalidate?: (userIdHex: string) => void;
}

export type ReserveDeletionResult =
  | { ok: true; reservationId: string; requestedAt: Date }
  | { ok: false; reason: "denied"; denial: AdmissionDenial }
  | { ok: false; reason: "conflict" }
  | { ok: false; reason: "unavailable" };

/**
 * Admit one deletion command with a single CAS on the user document. The
 * target account, the snapshot, and the verified caller must name the exact
 * same id before anything else happens. The filter then pins the exact
 * credential snapshot (password, provider links), current privilege flags
 * (role, isAdmin), the revocation snapshot, fence absence, and deletion
 * absence, so any concurrent change lands as `conflict` with zero side
 * effects.
 *
 * The canonical cache is invalidated before the write and again on every
 * settled write (success, conflict, or transport failure), because a lost
 * acknowledgment may still have committed.
 *
 * Returns `ok` only for a confirmed own reservation: on an ambiguous ack the
 * user row is re-read and only the exact reservation id resolves it. Never
 * start cascade work on anything but `ok: true`.
 */
export async function reserveDeletion(
  store: DeletionCommandStore,
  args: ReserveDeletionArgs
): Promise<ReserveDeletionResult> {
  const hex = args.userId.toHexString();
  const invalidate = args.onInvalidate ?? invalidateCachedUser;
  const caller = args.caller;
  if (
    !caller ||
    typeof caller.userId !== "string" ||
    caller.userId !== hex ||
    args.snapshot._id.toHexString() !== hex
  ) {
    return { ok: false, reason: "denied", denial: "principal" };
  }
  const decision = decideAdmission(args.snapshot, caller, args.now);
  if (!decision.ok) return { ok: false, reason: "denied", denial: decision.denial };
  if (hasDeletionMarker(args.snapshot)) return { ok: false, reason: "conflict" };
  if (typeof caller.iat !== "number" || !Number.isSafeInteger(caller.iat)) {
    return { ok: false, reason: "unavailable" };
  }
  const reservationId = args.reservationId ?? randomUUID();
  if (!isValidReservationId(reservationId)) {
    return { ok: false, reason: "unavailable" };
  }
  const s = args.snapshot;
  const filter: Filter<User> = {
    _id: args.userId,
    password: s.password ?? null,
    ...(s.googleId === undefined ? { googleId: { $exists: false } } : { googleId: s.googleId }),
    ...(s.discordId === undefined ? { discordId: { $exists: false } } : { discordId: s.discordId }),
    role: s.role,
    ...(s.isAdmin === undefined ? { isAdmin: { $exists: false } } : { isAdmin: s.isAdmin }),
    isBanned: { $ne: true },
    ...authRevocationSnapshotFilter(s.authRevokedAt),
    ...authMigrationFenceAbsentFilter(),
    accountDeletion: { $exists: false },
  };
  const command: AccountDeletionCommand = {
    state: "reserved",
    reservationId,
    requestedAt: args.now,
    requestedBySessionIat: caller.iat,
    updatedAt: args.now,
  };
  const update: UpdateFilter<User> = {
    $set: { accountDeletion: command, updatedAt: args.now },
    $max: { authRevokedAt: args.now },
  };
  invalidate(hex);
  let write: { acknowledged: boolean; matchedCount: number } | null = null;
  try {
    write = await store.updateOne(filter, update);
  } catch {
    write = null;
  } finally {
    invalidate(hex);
  }
  if (write && write.acknowledged === true) {
    if (write.matchedCount === 1) {
      return { ok: true, reservationId, requestedAt: args.now };
    }
    return { ok: false, reason: "conflict" };
  }
  let current: User | null = null;
  try {
    current = await store.findOne({ _id: args.userId });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!current) return { ok: false, reason: "unavailable" };
  if (!hasDeletionMarker(current)) return { ok: false, reason: "unavailable" };
  const own = asWellFormedCommand(current.accountDeletion);
  if (own && own.reservationId === reservationId) {
    return { ok: true, reservationId, requestedAt: own.requestedAt };
  }
  return { ok: false, reason: "conflict" };
}

export interface WorkerCommandArgs {
  userId: ObjectId;
  reservationId: string;
  workerId: string;
  /** Trusted server time at call entry: audit stamps and proposed deadlines only. */
  now: Date;
  /** Lease length. Defaults to `DELETION_LEASE_TTL_MS`; bounded. */
  leaseTtlMs?: number;
  /** Cache eviction. Defaults to the canonical helper. */
  onInvalidate?: (userIdHex: string) => void;
}

export type ClaimCommandResult =
  | { ok: true; generation: number; leaseExpiresAt: Date }
  | { ok: false; reason: "denied" | "conflict" | "malformed" | "unavailable" };

function resolveLeaseTtl(leaseTtlMs: number | undefined): number | null {
  const ttl = leaseTtlMs ?? DELETION_LEASE_TTL_MS;
  if (!Number.isFinite(ttl)) return null;
  if (ttl < DELETION_LEASE_TTL_MIN_MS || ttl > DELETION_LEASE_TTL_MAX_MS) return null;
  return ttl;
}

/**
 * Lease acquisition for one command. The initial claim pins reservation id,
 * state, and the absence of every lease field, so exactly one of concurrent
 * claimants wins and a concurrent malformation denies. Reclaim pins the exact
 * previous worker triple plus state and additionally requires the stored
 * deadline to be expired at write time (`$expr` against `$$NOW`), so a caller
 * with a future-dated `now` cannot steal a live lease. A live lease, a
 * mismatched id, a malformed marker, a terminal command, or a proposed
 * deadline that is already past at write time never transfers. `args.now`
 * supplies audit times and the proposed deadline only; expiry is always the
 * database clock.
 */
export async function claimCommand(
  store: DeletionCommandStore,
  args: WorkerCommandArgs
): Promise<ClaimCommandResult> {
  const hex = args.userId.toHexString();
  const invalidate = args.onInvalidate ?? invalidateCachedUser;
  if (
    !isValidWorkerId(args.workerId) ||
    !isValidNow(args.now) ||
    !isValidReservationId(args.reservationId)
  ) {
    return { ok: false, reason: "denied" };
  }
  const ttl = resolveLeaseTtl(args.leaseTtlMs);
  if (ttl === null) return { ok: false, reason: "denied" };
  let current: User | null = null;
  try {
    current = await store.findOne({ _id: args.userId });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!current || !hasDeletionMarker(current)) return { ok: false, reason: "denied" };
  const cmd = asWellFormedCommand(current.accountDeletion);
  if (!cmd) return { ok: false, reason: "malformed" };
  if (cmd.reservationId !== args.reservationId) return { ok: false, reason: "conflict" };
  if (cmd.state === "complete") return { ok: false, reason: "denied" };
  const leaseExpiresAt = new Date(args.now.getTime() + ttl);
  if (!isValidNow(leaseExpiresAt)) return { ok: false, reason: "denied" };
  let filter: Filter<User>;
  let generation: number;
  if (
    cmd.workerId === undefined &&
    cmd.workerGeneration === undefined &&
    cmd.leaseExpiresAt === undefined
  ) {
    generation = DELETION_INITIAL_GENERATION;
    filter = {
      _id: args.userId,
      "accountDeletion.reservationId": cmd.reservationId,
      "accountDeletion.state": cmd.state,
      "accountDeletion.workerId": { $exists: false },
      "accountDeletion.workerGeneration": { $exists: false },
      "accountDeletion.leaseExpiresAt": { $exists: false },
      $expr: { $gt: [leaseExpiresAt, "$$NOW"] },
    } as Filter<User>;
  } else if (
    typeof cmd.workerId === "string" &&
    isValidDate(cmd.leaseExpiresAt) &&
    typeof cmd.workerGeneration === "number" &&
    Number.isSafeInteger(cmd.workerGeneration) &&
    cmd.workerGeneration >= 0
  ) {
    generation = cmd.workerGeneration + 1;
    if (!Number.isSafeInteger(generation)) return { ok: false, reason: "malformed" };
    filter = {
      _id: args.userId,
      "accountDeletion.reservationId": cmd.reservationId,
      "accountDeletion.state": cmd.state,
      "accountDeletion.workerId": cmd.workerId,
      "accountDeletion.workerGeneration": cmd.workerGeneration,
      "accountDeletion.leaseExpiresAt": cmd.leaseExpiresAt,
      $expr: {
        $and: [
          { $lte: ["$accountDeletion.leaseExpiresAt", "$$NOW"] },
          { $gt: [leaseExpiresAt, "$$NOW"] },
        ],
      },
    } as Filter<User>;
  } else {
    return { ok: false, reason: "malformed" };
  }
  const update: UpdateFilter<User> = {
    $set: {
      "accountDeletion.workerId": args.workerId,
      "accountDeletion.workerGeneration": generation,
      "accountDeletion.leaseExpiresAt": leaseExpiresAt,
      "accountDeletion.updatedAt": args.now,
      updatedAt: args.now,
    },
  };
  invalidate(hex);
  let write: { acknowledged: boolean; matchedCount: number } | null = null;
  try {
    write = await store.updateOne(filter, update);
  } catch {
    write = null;
  } finally {
    invalidate(hex);
  }
  if (!write || write.acknowledged !== true) return { ok: false, reason: "unavailable" };
  if (write.matchedCount !== 1) return { ok: false, reason: "conflict" };
  return { ok: true, generation, leaseExpiresAt };
}

export interface RenewLeaseArgs extends WorkerCommandArgs {
  generation: number;
}

export type RenewLeaseResult =
  { ok: true; leaseExpiresAt: Date } | { ok: false; reason: "denied" | "conflict" | "unavailable" };

interface ValidWorkerCall {
  cmd: DeletionCommandView;
}

function isValidGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Fresh-read the stored command and require an exact identity match. A
 * malformed marker, a missing marker, a wrong reservation id, worker id, or
 * generation, or a disallowed state all fail closed here, before any write,
 * so a partial field coincidence can never advance the state machine. The
 * write-time CAS re-pins the same tuple, so a change between this read and
 * the write lands as `conflict`.
 */
async function loadHeldCommand(
  store: DeletionCommandStore,
  args: CheckpointDeletionArgs,
  allowedStates: readonly AccountDeletionCommand["state"][]
): Promise<
  { ok: true; cmd: ValidWorkerCall["cmd"] } | { ok: false; reason: "conflict" | "unavailable" }
> {
  let current: User | null = null;
  try {
    current = await store.findOne({ _id: args.userId });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!current || !hasDeletionMarker(current)) return { ok: false, reason: "conflict" };
  const cmd = asWellFormedCommand(current.accountDeletion);
  if (!cmd) return { ok: false, reason: "conflict" };
  if (cmd.reservationId !== args.reservationId) return { ok: false, reason: "conflict" };
  if (!allowedStates.includes(cmd.state)) return { ok: false, reason: "conflict" };
  if (cmd.workerId !== args.workerId) return { ok: false, reason: "conflict" };
  if (cmd.workerGeneration !== args.generation) return { ok: false, reason: "conflict" };
  if (!isValidDate(cmd.leaseExpiresAt)) return { ok: false, reason: "conflict" };
  return { ok: true, cmd };
}

async function guardedWorkerWrite(
  store: DeletionCommandStore,
  invalidate: (userIdHex: string) => void,
  hex: string,
  filter: Filter<User>,
  update: UpdateFilter<User>
): Promise<{ ok: true } | { ok: false; reason: "conflict" | "unavailable" }> {
  invalidate(hex);
  let write: { acknowledged: boolean; matchedCount: number } | null = null;
  try {
    write = await store.updateOne(filter, update);
  } catch {
    write = null;
  } finally {
    invalidate(hex);
  }
  if (!write || write.acknowledged !== true) return { ok: false, reason: "unavailable" };
  if (write.matchedCount !== 1) return { ok: false, reason: "conflict" };
  return { ok: true };
}

/**
 * Extend a held lease. Re-reads the command, requires the exact fencing
 * tuple, then extends in one CAS guarded by the database clock: the stored
 * deadline must still be live at write time, the proposed deadline must be
 * future at write time, and it must not move the deadline backward
 * (out-of-order renews conflict instead of shrinking the lease). An expired
 * lease never renews; it goes through `claimCommand` reclaim at generation
 * + 1. `args.now` supplies the proposed deadline and audit times only.
 */
export async function renewLease(
  store: DeletionCommandStore,
  args: RenewLeaseArgs
): Promise<RenewLeaseResult> {
  const hex = args.userId.toHexString();
  const invalidate = args.onInvalidate ?? invalidateCachedUser;
  if (
    !isValidWorkerId(args.workerId) ||
    !isValidNow(args.now) ||
    !isValidReservationId(args.reservationId) ||
    !isValidGeneration(args.generation)
  ) {
    return { ok: false, reason: "denied" };
  }
  const ttl = resolveLeaseTtl(args.leaseTtlMs);
  if (ttl === null) return { ok: false, reason: "denied" };
  const proposed = new Date(args.now.getTime() + ttl);
  if (!isValidNow(proposed)) return { ok: false, reason: "denied" };
  const loaded = await loadHeldCommand(store, args, ["reserved", "cascading"]);
  if (!loaded.ok) return loaded;
  const previousDeadline = loaded.cmd.leaseExpiresAt as Date;
  const filter = {
    _id: args.userId,
    "accountDeletion.reservationId": args.reservationId,
    "accountDeletion.state": { $in: ["reserved", "cascading"] },
    "accountDeletion.workerId": args.workerId,
    "accountDeletion.workerGeneration": args.generation,
    "accountDeletion.leaseExpiresAt": previousDeadline,
    $expr: {
      $and: [
        { $gt: ["$accountDeletion.leaseExpiresAt", "$$NOW"] },
        { $gt: [proposed, "$$NOW"] },
        { $gte: [proposed, "$accountDeletion.leaseExpiresAt"] },
      ],
    },
  } as Filter<User>;
  const update: UpdateFilter<User> = {
    $set: {
      "accountDeletion.leaseExpiresAt": proposed,
      "accountDeletion.updatedAt": args.now,
      updatedAt: args.now,
    },
  };
  const written = await guardedWorkerWrite(store, invalidate, hex, filter, update);
  if (!written.ok) return written;
  return { ok: true, leaseExpiresAt: proposed };
}

export interface CheckpointDeletionArgs extends WorkerCommandArgs {
  generation: number;
}

export type CheckpointDeletionResult =
  { ok: true } | { ok: false; reason: "denied" | "conflict" | "unavailable" };

/**
 * Advance `reserved` to `cascading` under a held lease. Re-reads the command,
 * requires the exact fencing tuple, then advances in one CAS whose liveness
 * guard is the database clock: a request that arrives after expiry fails even
 * when its `now` predates the deadline. Already-`cascading` retries by the
 * same holder match and succeed. Only touches progress fields.
 */
export async function checkpointDeletion(
  store: DeletionCommandStore,
  args: CheckpointDeletionArgs
): Promise<CheckpointDeletionResult> {
  const hex = args.userId.toHexString();
  const invalidate = args.onInvalidate ?? invalidateCachedUser;
  if (
    !isValidWorkerId(args.workerId) ||
    !isValidNow(args.now) ||
    !isValidReservationId(args.reservationId) ||
    !isValidGeneration(args.generation)
  ) {
    return { ok: false, reason: "denied" };
  }
  const loaded = await loadHeldCommand(store, args, ["reserved", "cascading"]);
  if (!loaded.ok) return loaded;
  const filter = {
    _id: args.userId,
    "accountDeletion.reservationId": args.reservationId,
    "accountDeletion.state": { $in: ["reserved", "cascading"] },
    "accountDeletion.workerId": args.workerId,
    "accountDeletion.workerGeneration": args.generation,
    $expr: { $gt: ["$accountDeletion.leaseExpiresAt", "$$NOW"] },
  } as Filter<User>;
  const update: UpdateFilter<User> = {
    $set: {
      "accountDeletion.state": "cascading",
      "accountDeletion.updatedAt": args.now,
      updatedAt: args.now,
    },
  };
  const written = await guardedWorkerWrite(store, invalidate, hex, filter, update);
  if (!written.ok) return written;
  return { ok: true };
}

export type ConfirmDeletionCompletedResult =
  { ok: true } | { ok: false; reason: "denied" | "conflict" | "unavailable" };

/**
 * Mark `cascading` as terminally `complete` under a held lease, with the same
 * fresh-read check and database-clock liveness guard as every other advance.
 * Keeps the receipt on the row and never deletes the user document.
 */
export async function confirmDeletionCompleted(
  store: DeletionCommandStore,
  args: CheckpointDeletionArgs
): Promise<ConfirmDeletionCompletedResult> {
  const hex = args.userId.toHexString();
  const invalidate = args.onInvalidate ?? invalidateCachedUser;
  if (
    !isValidWorkerId(args.workerId) ||
    !isValidNow(args.now) ||
    !isValidReservationId(args.reservationId) ||
    !isValidGeneration(args.generation)
  ) {
    return { ok: false, reason: "denied" };
  }
  const loaded = await loadHeldCommand(store, args, ["cascading"]);
  if (!loaded.ok) return loaded;
  const filter = {
    _id: args.userId,
    "accountDeletion.reservationId": args.reservationId,
    "accountDeletion.state": "cascading",
    "accountDeletion.workerId": args.workerId,
    "accountDeletion.workerGeneration": args.generation,
    $expr: { $gt: ["$accountDeletion.leaseExpiresAt", "$$NOW"] },
  } as Filter<User>;
  const update: UpdateFilter<User> = {
    $set: {
      "accountDeletion.state": "complete",
      "accountDeletion.updatedAt": args.now,
      updatedAt: args.now,
    },
  };
  const written = await guardedWorkerWrite(store, invalidate, hex, filter, update);
  if (!written.ok) return written;
  return { ok: true };
}
