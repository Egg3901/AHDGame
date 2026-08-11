import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireCron } from "@/lib/api/requireCron";
import { handleRouteError } from "@/lib/api/errors";
import { logRequest } from "@/lib/api/requestLog";
import type { PatreonTier, User } from "@/lib/db/types";
import { listPatreonMembers, type PatreonMemberRecord } from "@/lib/patreon/members";
import {
  applyPatreonStatus,
  clearExpiredPatreonBenefits,
  findUserByPatreonUserId,
  startPatreonGracePeriod,
} from "@/lib/patreon/service";

// GET|POST /api/cron/patreon-reconcile — reconcile AHD supporter roles against
// the live Patreon campaign membership. DRY RUN by default; pass ?apply=true to
// actually write. Auth: requireCron (Authorization: Bearer $CRON_SECRET).
//
// Decision rules (per run):
//   - toGrant: an ACTIVE paid patron matched to an AHD user (by patreonUserId,
//     else by exact lowercased email) whose AHD patreonTier differs from Patreon
//     -> applyPatreonStatus (grant/upgrade/downgrade) and backfill patreonUserId.
//   - toDerole: an AHD supporter positively matched to a Patreon record that is
//     no longer an active paid patron AND not already counting down
//     (patreonExpiresAt == null) -> startPatreonGracePeriod (30d), never an
//     immediate clear.
//   - unmatchedAhdSupporters: AHD supporters we CANNOT find in the Patreon data
//     by patreonUserId or email -> left completely untouched (manual grants /
//     email mismatches), reported only.
//   - unmatchedActivePatrons: active paid patrons with no matching AHD user ->
//     reported only, no change.
//   - expired: any supporter whose grace has elapsed (patreonExpiresAt in the
//     past) -> clearExpiredPatreonBenefits. Match-independent; this is the same
//     lazy expiry the app already does, just run on a schedule.

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
}

function normEmail(email: string | null | undefined): string | null {
  return email ? String(email).trim().toLowerCase() : null;
}

/** Ordinal ranking of a tier so we can compare "which is higher". */
function tierRank(tier: PatreonTier): number {
  if (tier === "supporter-plus-plus") return 3;
  if (tier === "supporter-plus") return 2;
  if (tier === "supporter") return 1;
  return 0;
}

/** Find an AHD user for an active patron: patreonUserId first, then email. */
async function findUserForPatron(db: Db, patron: PatreonMemberRecord): Promise<User | null> {
  if (patron.patreonUserId) {
    const byId = await findUserByPatreonUserId(db, patron.patreonUserId);
    if (byId) return byId;
  }
  if (patron.email) {
    // Exact match on a lowercased email. Case-insensitive so we still match when
    // a legacy AHD record stored mixed-case; email is otherwise an exact equality.
    const escaped = patron.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return db
      .collection<User>("users")
      .findOne({ email: { $regex: `^${escaped}$`, $options: "i" } });
  }
  return null;
}

export async function runReconcile(db: Db, apply: boolean): Promise<ReconcileResult> {
  const members = await listPatreonMembers();
  const now = Date.now();

  // Index Patreon records for supporter -> patreon matching.
  const byPatreonUserId = new Map<string, PatreonMemberRecord>();
  const byEmail = new Map<string, PatreonMemberRecord>();
  for (const m of members) {
    if (m.patreonUserId) byPatreonUserId.set(m.patreonUserId, m);
    const e = normEmail(m.email);
    if (e) byEmail.set(e, m);
  }

  const activePaid = members.filter((m) => m.active && m.tier !== null);

  const toGrant: GrantEntry[] = [];
  const toDerole: SupporterEntry[] = [];
  const unmatchedActivePatrons: UnmatchedPatronEntry[] = [];
  const unmatchedAhdSupporters: SupporterEntry[] = [];
  const expired: SupporterEntry[] = [];

  const matchedUserIds = new Set<string>();

  // ── Grants: walk active paid patrons ──
  for (const patron of activePaid) {
    const user = await findUserForPatron(db, patron);
    if (!user) {
      unmatchedActivePatrons.push({ email: patron.email, tier: patron.tier });
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
        await applyPatreonStatus(db, {
          userId: user._id,
          tier: patron.tier,
          expiresAt: null,
          adsDisabledDefault: true,
          // Backfill patreonUserId when missing so the webhook works going forward.
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

    // Expiry is match-independent and safe: grace already elapsed.
    const exp = u.patreonExpiresAt ? new Date(u.patreonExpiresAt).getTime() : null;
    if (exp !== null && exp < now) {
      expired.push(entry);
      if (apply) await clearExpiredPatreonBenefits(db, u._id);
      continue;
    }

    // Positively match this supporter to a Patreon record.
    const rec =
      (u.patreonUserId ? byPatreonUserId.get(u.patreonUserId) : undefined) ??
      (normEmail(u.email) ? byEmail.get(normEmail(u.email)!) : undefined);

    if (!rec) {
      // Cannot find them in Patreon by id or email — never derole. Manual grant
      // or email mismatch. Skip if the grant loop already reaffirmed them.
      if (!matchedUserIds.has(u._id.toString())) unmatchedAhdSupporters.push(entry);
      continue;
    }

    if (rec.active) continue; // still an active paid patron (grant loop handled tier)

    // Matched to an inactive/former/free Patreon record. Only start grace if not
    // already counting down (expiresAt in the future means grace is running).
    if (exp === null) {
      toDerole.push(entry);
      if (apply) await startPatreonGracePeriod(db, u._id);
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
  };
}

async function handle(req: Request): Promise<Response> {
  const start = Date.now();
  const path = "/api/cron/patreon-reconcile";

  if (!requireCron(req)) {
    logRequest(req.method, path, 401, Date.now() - start);
    console.warn("[cron/patreon-reconcile] Unauthorized cron attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apply = new URL(req.url).searchParams.get("apply") === "true";

  try {
    const db = await getDb();
    const result = await runReconcile(db, apply);
    const durationMs = Date.now() - start;
    logRequest(req.method, path, 200, durationMs);
    console.info("[cron/patreon-reconcile] Completed", {
      durationMs,
      dryRun: result.dryRun,
      ...result.counts,
    });
    return NextResponse.json(result);
  } catch (error) {
    Sentry.captureException(error, { tags: { route: path } });
    logRequest(req.method, path, 500, Date.now() - start);
    console.error("[cron/patreon-reconcile] Failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return handleRouteError(error);
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
