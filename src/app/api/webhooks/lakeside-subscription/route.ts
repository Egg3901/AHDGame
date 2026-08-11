import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireLakesideToken } from "@/lib/api/requireLakesideToken";
import { parseJsonBody } from "@/lib/api/validate";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import {
  applyPatreonStatus,
  getGracePeriodEnd,
  startPatreonGracePeriod,
} from "@/lib/patreon/service";
import type { User } from "@/lib/db/types";

// POST /api/webhooks/lakeside-subscription
// The Lakeside account portal (lakesidegames.net/account) pushes Stripe
// subscription state changes here so AHD grants the exact same benefits as the
// equivalent Patreon tiers.
//
// Auth: Authorization: Bearer $LAKESIDE_S2S_TOKEN (requireLakesideToken).
//
// Body: {
//   email: string,                                  // shared Lakeside account email
//   tier: "supporter" | "supporter-plus" | "supporter-plus-plus" | null,  // matches PatreonTier values
//   active: boolean,                                 // is the subscription live?
//   currentPeriodEnd: string | null                 // ISO end of the paid period
// }
//
// Behaviour:
//   - active + non-null tier -> applyPatreonStatus(provider: "stripe"). The
//     expiry is set to currentPeriodEnd PLUS the existing 30-day Patreon grace
//     constant, so a missed Stripe renewal degrades on exactly the same clock a
//     lapsed patron does. A null currentPeriodEnd means "no known expiry".
//   - active:false (or a null tier) -> startPatreonGracePeriod (30d), never an
//     immediate clear. Matches how a cancelled patron winds down.
//   - unknown email -> 404 JSON (the portal logs the miss).
//
// Idempotent: applyPatreonStatus / startPatreonGracePeriod are $set updates, so
// replaying the same event converges to the same state.

const schema = z.object({
  email: z.string().email(),
  tier: z.enum(["supporter", "supporter-plus", "supporter-plus-plus"]).nullable(),
  active: z.boolean(),
  currentPeriodEnd: z.string().datetime().nullable(),
});

export async function POST(request: Request) {
  try {
    if (!requireLakesideToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { email, tier, active, currentPeriodEnd } = parsed.data;

    const db = await getDb();

    // Match the shared Lakeside account by lowercased email (case-insensitive
    // exact match, mirroring the Patreon reconciler's email matching).
    const normalized = email.trim().toLowerCase();
    const user = await db
      .collection<User>("users")
      .findOne({ email: { $regex: `^${escapeRegex(normalized)}$`, $options: "i" } });

    if (!user) {
      return NextResponse.json({ ok: false, error: "unknown_email" }, { status: 404 });
    }

    if (active && tier !== null) {
      // Grant / upgrade / downgrade. Expiry = period end + grace window so a
      // missed renewal degrades exactly like a lapsed patron.
      const expiresAt = currentPeriodEnd ? getGracePeriodEnd(new Date(currentPeriodEnd)) : null;
      await applyPatreonStatus(db, {
        userId: user._id,
        tier,
        expiresAt,
        adsDisabledDefault: true,
        provider: "stripe",
      });
      return NextResponse.json({ ok: true, status: "active", tier });
    }

    // Cancelled / lapsed / no tier: start the 30-day grace countdown.
    await startPatreonGracePeriod(db, user._id);
    return NextResponse.json({ ok: true, status: "grace_period" });
  } catch (error) {
    return handleRouteError(error);
  }
}
