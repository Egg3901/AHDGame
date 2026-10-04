/**
 * Patreon supporter reconciliation. Linked Patreon identities control grants,
 * grace periods, and expiry; unmatched identities stay untouched and accrue
 * pseudonymous retry history through `runPatreonReconcile`.
 */
import { createHmac, randomUUID } from "node:crypto";
import type { Db, Document } from "mongodb";
import type { PatreonTier, User } from "@/lib/db/types";
import { listPatreonMembers, type PatreonMemberRecord } from "@/lib/patreon/members";
import {
  applyPatreonStatus,
  clearExpiredPatreonBenefits,
  findUserByPatreonUserId,
  startPatreonGracePeriod,
} from "@/lib/patreon/service";

interface GrantEntry {
  username: string;
  email: string | null;
  from: PatreonTier;
  to: PatreonTier;
}
interface SupporterEntry {
  username: string;
  email: string | null;
  tier: PatreonTier;
}
interface UnmatchedPatronEntry {
  email: string | null;
  tier: PatreonTier;
}

export interface ReconcileResult {
  dryRun: boolean;
  counts: {
    patreonMembers: number;
    activePaidPatrons: number;
    ahdSupporters: number;
    toGrant: number;
    toDerole: number;
    unmatchedActivePatrons: number;
    unmatchedAhdSupporters: number;
    expired: number;
  };
  toGrant: GrantEntry[];
  toDerole: SupporterEntry[];
  unmatchedActivePatrons: UnmatchedPatronEntry[];
  unmatchedAhdSupporters: SupporterEntry[];
  expired: SupporterEntry[];
  /** Pseudonymous keys used only for internal retry history. Never return to clients. */
  auditKeys: Array<{ kind: "active_patron" | "ahd_supporter"; fingerprint: string }>;
}

type ReconcileAuditCounts = ReconcileResult["counts"];

interface ReconcileRunAudit extends Document {
  _id: string;
  startedAt: Date;
  completedAt?: Date;
  mode: "dry_run" | "apply";
  status: "running" | "completed" | "failed" | "skipped";
  counts?: ReconcileAuditCounts;
  errorType?: string;
  skipReason?: "lock_held";
}

interface PatreonReconcileCronLock extends Document {
  _id: string;
  owner?: string;
  leaseUntil?: Date;
}

interface UnmatchedAudit extends Document {
  _id: string;
  kind: "active_patron" | "ahd_supporter";
  fingerprint: string;
  state: "open" | "resolved";
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt?: Date;
  attemptCount: number;
  lastRunId: string;
}

const RECONCILE_LOCK_ID = "patreon-reconcile";
const RECONCILE_LOCK_MS = 60 * 60 * 1000;

export class PatreonReconcileLockBusyError extends Error {
  constructor() {
    super("Patreon reconciliation is already running");
    this.name = "PatreonReconcileLockBusyError";
  }
}

export class PatreonReconcileLockLostError extends Error {
  constructor() {
    super("Patreon reconciliation lost its apply lease");
    this.name = "PatreonReconcileLockLostError";
  }
}

function fingerprint(value: string): string {
  // A keyed digest prevents emails or provider IDs from being recovered by a
  // dictionary scan of the retry collection. The creator token is required
  // for a successful member-list pass; the fallback only keeps unit tests
  // deterministic when they mock that external call.
  const key = process.env.PATREON_CREATOR_TOKEN;
  if (!key && process.env.NODE_ENV !== "test") {
    throw new Error("PATREON_CREATOR_TOKEN is required for reconciliation fingerprints");
  }
  return createHmac("sha256", key ?? "unit-test-only-patreon-key")
    .update(value)
    .digest("hex");
}

/** Ordinal ranking of a tier so we can compare "which is higher". */
function tierRank(tier: PatreonTier): number {
  if (tier === "supporter-plus-plus") return 3;
  if (tier === "supporter-plus") return 2;
  if (tier === "supporter") return 1;
  return 0;
}

/** Resolve linked provider identity; email is contact information only. */
async function findUserForPatron(db: Db, patron: PatreonMemberRecord): Promise<User | null> {
  return patron.patreonUserId ? findUserByPatreonUserId(db, patron.patreonUserId) : null;
}

export async function runReconcile(
  db: Db,
  apply: boolean,
  beforeApplyWrite?: () => Promise<void>
): Promise<ReconcileResult> {
  const members = await listPatreonMembers();
  const now = Date.now();

  // Index Patreon records for supporter -> patreon matching.
  const byPatreonUserId = new Map<string, PatreonMemberRecord>();
  for (const m of members) {
    if (m.patreonUserId) byPatreonUserId.set(m.patreonUserId, m);
  }

  const activePaid = members.filter((m) => m.active && m.tier !== null);

  const toGrant: GrantEntry[] = [];
  const toDerole: SupporterEntry[] = [];
  const unmatchedActivePatrons: UnmatchedPatronEntry[] = [];
  const unmatchedAhdSupporters: SupporterEntry[] = [];
  const expired: SupporterEntry[] = [];
  const auditKeys: ReconcileResult["auditKeys"] = [];

  const matchedUserIds = new Set<string>();

  // ── Grants: walk active paid patrons ──
  for (const patron of activePaid) {
    const user = await findUserForPatron(db, patron);
    if (!user) {
      unmatchedActivePatrons.push({ email: patron.email, tier: patron.tier });
      const stableIdentity = patron.patreonUserId
        ? `patreon:${patron.patreonUserId}`
        : patron.email
          ? `email:${patron.email.trim().toLowerCase()}`
          : `anonymous:${patron.tier ?? "none"}`;
      auditKeys.push({ kind: "active_patron", fingerprint: fingerprint(stableIdentity) });
      continue;
    }
    matchedUserIds.add(user._id.toString());
    const current = user.patreonTier ?? null;

    // A Stripe (Lakeside) subscriber may only be UPGRADED by a Patreon pledge,
    // never downgraded or left unchanged by Patreon: higher tier wins. If the
    // Patreon tier is equal or lower, leave the Stripe grant untouched so the
    // Lakeside webhook stays the source of truth for their benefits/expiry.
    if (user.supporterProvider === "stripe" && tierRank(patron.tier) <= tierRank(current)) {
      continue;
    }

    if (current !== patron.tier) {
      toGrant.push({
        username: user.username,
        email: user.email ?? null,
        from: current,
        to: patron.tier,
      });
      if (apply) {
        await beforeApplyWrite?.();
        await applyPatreonStatus(db, {
          userId: user._id,
          tier: patron.tier,
          expiresAt: user.supporterProvider === "stripe" ? (user.patreonExpiresAt ?? null) : null,
          adsDisabledDefault: true,
          provider: user.supporterProvider === "stripe" ? "stripe" : undefined,
          // Keep the explicit provider mapping used for this match.
          patreonUserId: patron.patreonUserId ?? user.patreonUserId,
        });
      }
    }
  }

  // ── Derole / unmatched: walk current AHD supporters ──
  const supporters = await db
    .collection<User>("users")
    .find({ patreonTier: { $ne: null } })
    .toArray();

  for (const u of supporters) {
    const entry: SupporterEntry = {
      username: u.username,
      email: u.email ?? null,
      tier: u.patreonTier ?? null,
    };

    // Stripe (Lakeside portal) subscribers are invisible to Patreon's member
    // list, so Patreon reconciliation must never lapse, grace-out, or expire
    // them here — that is driven solely by the Lakeside subscription webhook and
    // its currentPeriodEnd + grace expiry. We still let the grant loop above
    // UPGRADE such a user if they ALSO pledge on Patreon at a higher tier
    // (higher tier wins), but we skip every Patreon-driven downgrade/removal
    // decision for them below.
    if (u.supporterProvider === "stripe") {
      continue;
    }

    // Positively match this supporter to a Patreon record.
    const rec = u.patreonUserId ? byPatreonUserId.get(u.patreonUserId) : undefined;

    if (!rec) {
      // Cannot find them in Patreon by linked provider ID — never derole. Manual grant
      // or email mismatch. Skip if the grant loop already reaffirmed them.
      if (!matchedUserIds.has(u._id.toString())) {
        unmatchedAhdSupporters.push(entry);
        auditKeys.push({
          kind: "ahd_supporter",
          fingerprint: fingerprint(`ahd-user:${u._id.toString()}`),
        });
      }
      continue;
    }

    if (rec.active) continue; // still an active paid patron (grant loop handled tier)

    // Missing provider identity/data never starts or completes a Patreon
    // expiry. Only a positively linked, inactive Patreon record can advance
    // its existing grace period to benefit removal.
    const exp = u.patreonExpiresAt ? new Date(u.patreonExpiresAt).getTime() : null;
    if (exp !== null && exp < now) {
      expired.push(entry);
      if (apply) {
        await beforeApplyWrite?.();
        await clearExpiredPatreonBenefits(db, u._id);
      }
      continue;
    }

    // Matched to an inactive/former/free Patreon record. Only start grace if not
    // already counting down (expiresAt in the future means grace is running).
    if (exp === null) {
      toDerole.push(entry);
      if (apply) {
        await beforeApplyWrite?.();
        await startPatreonGracePeriod(db, u._id);
      }
    }
  }

  return {
    dryRun: !apply,
    counts: {
      patreonMembers: members.length,
      activePaidPatrons: activePaid.length,
      ahdSupporters: supporters.length,
      toGrant: toGrant.length,
      toDerole: toDerole.length,
      unmatchedActivePatrons: unmatchedActivePatrons.length,
      unmatchedAhdSupporters: unmatchedAhdSupporters.length,
      expired: expired.length,
    },
    toGrant,
    toDerole,
    unmatchedActivePatrons,
    unmatchedAhdSupporters,
    expired,
    auditKeys,
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

async function acquireApplyLock(db: Db, owner: string, now: Date): Promise<void> {
  try {
    const result = await db.collection<PatreonReconcileCronLock>("cronLocks").updateOne(
      {
        _id: RECONCILE_LOCK_ID,
        $or: [{ leaseUntil: { $lte: now } }, { owner }],
      },
      { $set: { owner, leaseUntil: new Date(now.getTime() + RECONCILE_LOCK_MS) } },
      { upsert: true }
    );
    if (result.matchedCount !== 1 && result.modifiedCount !== 1 && result.upsertedCount !== 1) {
      throw new PatreonReconcileLockBusyError();
    }
  } catch (error) {
    if (error instanceof PatreonReconcileLockBusyError) throw error;
    if (isDuplicateKeyError(error)) throw new PatreonReconcileLockBusyError();
    throw error;
  }
}

async function releaseApplyLock(db: Db, owner: string): Promise<void> {
  await db
    .collection<PatreonReconcileCronLock>("cronLocks")
    .updateOne(
      { _id: RECONCILE_LOCK_ID, owner },
      { $set: { leaseUntil: new Date(0) }, $unset: { owner: "" } }
    );
}

/** Extend the lease only while this run still owns an unexpired lock. */
async function renewApplyLock(db: Db, owner: string): Promise<void> {
  const now = new Date();
  const result = await db
    .collection<PatreonReconcileCronLock>("cronLocks")
    .updateOne(
      { _id: RECONCILE_LOCK_ID, owner, leaseUntil: { $gt: now } },
      { $set: { leaseUntil: new Date(now.getTime() + RECONCILE_LOCK_MS) } }
    );
  if (result.matchedCount !== 1) throw new PatreonReconcileLockLostError();
}

async function persistUnmatchedAudit(
  db: Db,
  keys: ReconcileResult["auditKeys"],
  runId: string,
  now: Date
): Promise<void> {
  const collection = db.collection<UnmatchedAudit>("patreonReconcileUnmatched");
  for (const kind of ["active_patron", "ahd_supporter"] as const) {
    const currentIds = keys
      .filter((key) => key.kind === kind)
      .map((key) => `${kind}:${key.fingerprint}`);
    await collection.updateMany(
      { kind, state: "open", _id: { $nin: currentIds } },
      { $set: { state: "resolved", resolvedAt: now } }
    );
    const operations = keys
      .filter((key) => key.kind === kind)
      .map((key) => ({
        updateOne: {
          filter: { _id: `${kind}:${key.fingerprint}` },
          update: {
            $set: {
              kind,
              fingerprint: key.fingerprint,
              state: "open",
              lastSeenAt: now,
              lastRunId: runId,
            },
            $setOnInsert: { firstSeenAt: now },
            $inc: { attemptCount: 1 },
            $unset: { resolvedAt: "" },
          },
          upsert: true,
        },
      }));
    if (operations.length > 0) await collection.bulkWrite(operations);
  }
}

/** Run a reconciliation and persist PII-free counts, failures, and unmatched retry history. */
export async function runPatreonReconcile(db: Db, apply: boolean): Promise<ReconcileResult> {
  const runId = randomUUID();
  const startedAt = new Date();
  const audits = db.collection<ReconcileRunAudit>("patreonReconcileRuns");
  await audits.insertOne({
    _id: runId,
    startedAt,
    mode: apply ? "apply" : "dry_run",
    status: "running",
  });

  const owner = apply ? randomUUID() : null;
  let failed = false;
  try {
    if (owner) await acquireApplyLock(db, owner, startedAt);
    const beforeApplyWrite = owner ? () => renewApplyLock(db, owner) : undefined;
    const result = await runReconcile(db, apply, beforeApplyWrite);
    if (apply) {
      await beforeApplyWrite?.();
      await persistUnmatchedAudit(db, result.auditKeys, runId, new Date());
    }
    await audits.updateOne(
      { _id: runId },
      { $set: { status: "completed", completedAt: new Date(), counts: result.counts } }
    );
    return result;
  } catch (error) {
    failed = true;
    const lockBusy = error instanceof PatreonReconcileLockBusyError;
    await audits.updateOne(
      { _id: runId },
      {
        $set: {
          status: lockBusy ? "skipped" : "failed",
          completedAt: new Date(),
          ...(lockBusy
            ? { skipReason: "lock_held" }
            : { errorType: error instanceof Error ? error.name : "UnknownError" }),
        },
      }
    );
    throw error;
  } finally {
    if (owner) {
      try {
        await releaseApplyLock(db, owner);
      } catch (error) {
        if (!failed) {
          await audits.updateOne(
            { _id: runId },
            {
              $set: {
                status: "failed",
                completedAt: new Date(),
                errorType: "PatreonReconcileLockReleaseError",
              },
            }
          );
          throw error;
        }
      }
    }
  }
}
