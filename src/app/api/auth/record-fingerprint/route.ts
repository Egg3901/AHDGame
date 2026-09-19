import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getAuthUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, internalError, unauthorized } from "@/lib/api/errors";
import type { User } from "@/lib/db/types";
import { recordAudit } from "@/lib/audit/recordAudit";
import { getClientIp } from "@/lib/utils/network";
import { getCfFingerprint, isEmptyCfFingerprint } from "@/lib/utils/cfFingerprint";
import { classifyDevice } from "@/lib/utils/userAgent";
import { createHash } from "crypto";

const bodySchema = z.object({
  fingerprint: z.string().max(128).optional(),
  fingerprintComponents: z
    .object({
      canvas: z.string().max(256).optional(),
      webglRenderer: z.string().max(256).optional(),
      audio: z.string().max(256).optional(),
      fonts: z.string().max(2048).optional(),
      cores: z.number().int().nonnegative().max(1024).optional(),
      memory: z.number().nonnegative().max(1024).optional(),
      screen: z.string().max(512).optional(),
      timezone: z.string().max(128).optional(),
      platform: z.string().max(128).optional(),
      // Modest client entropy additions (forensics-v2 Part B): unmasked
      // WebGL vendor (paired with the existing `webglRenderer`) and the
      // browser's language preference list, both read directly via
      // `navigator`/`WEBGL_debug_renderer_info` — see
      // `src/lib/utils/fingerprint.ts`'s `generateFingerprintData`.
      webglVendor: z.string().max(256).optional(),
      languages: z.string().max(256).optional(),
    })
    .strict(),
});

/** Partially redact an IP for display in forensic surfaces — never store the
 * raw address in `actionAuditLog.net` (plan §3.1 "net" doc-comment). */
function maskIp(ip: string): string {
  if (!ip || ip === "unknown") return "unknown";
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return `${parts.slice(0, 3).join(":")}::`;
  }
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.xxx` : "unknown";
}

/** One-way hash so alt-detection can still match "same IP" across rows
 * without a second copy of the raw address anywhere in the audit spine. */
function hashIp(ip: string): string | undefined {
  if (!ip || ip === "unknown") return undefined;
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

/** How soon after account creation a registration-time value may still be
 * backfilled. The backfill exists for the OAuth signup path, which completes
 * moments after the account row is inserted; anything older is a session
 * beacon and must not mint registration evidence. */
export const REGISTRATION_BACKFILL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** True when `createdAt` is recent enough for a registration-time backfill.
 * A missing `createdAt` refuses rather than allows — inventing registration
 * evidence is strictly worse than admitting we do not have it. */
export function isWithinRegistrationBackfillWindow(
  createdAt: Date | undefined | null,
  now: Date
): boolean {
  if (!createdAt) return false;
  return now.getTime() - createdAt.getTime() <= REGISTRATION_BACKFILL_WINDOW_MS;
}

// POST /api/auth/record-fingerprint — Advisory post-auth capture of fingerprint
// components (used for the OAuth path, which cannot carry components through the
// size-limited OAuth cookie). Never blocks; only backfills/updates component fields.
// Auth: required
// Errors: 400, 401
export async function POST(request: Request) {
  try {
    const authUser = await getAuthUser();
    if (!authUser) return handleRouteError(unauthorized("Authentication required"));

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { fingerprint, fingerprintComponents } = parsed.data;

    const db = await getDb();
    const users = db.collection<User>("users");
    const userId = new ObjectId(authUser.userId);
    const user = await users.findOne(
      { _id: userId },
      {
        projection: {
          registrationFingerprintComponents: 1,
          registrationFingerprint: 1,
          registrationCf: 1,
          // Required by the registration-backfill age gate below. Without it
          // the gate compares against `undefined` and never fires.
          createdAt: 1,
        },
      }
    );
    if (!user) return handleRouteError(unauthorized("Authentication required"));

    const now = new Date();
    const mayBackfillRegistration = isWithinRegistrationBackfillWindow(user.createdAt, now);

    const set: Record<string, unknown> = { lastFingerprintComponents: fingerprintComponents };

    // Always record the supplied fingerprint as the account's CURRENT one.
    // This also takes effect for the OAuth result-page caller, intentionally:
    // an OAuth signup's fingerprint should be the account's current fingerprint.
    if (fingerprint) {
      set.lastFingerprint = fingerprint;
      set.lastFingerprintAt = now;
    }

    // Registration-time backfills — gated on account age. Outside the window a
    // null registration value stays null: this route is called from every
    // authenticated page once the session beacon ships, and writing today's
    // value as "registration evidence" would fabricate a fresh signal that
    // Duplicate Groups unions on — manufacturing the very permanent groups
    // this system exists to remove. Admitting the gap beats inventing a value.
    if (mayBackfillRegistration) {
      if (user.registrationFingerprintComponents == null) {
        set.registrationFingerprintComponents = fingerprintComponents;
      }
      if (fingerprint && user.registrationFingerprint == null) {
        set.registrationFingerprint = fingerprint;
        set.registrationFingerprintAt = now;
      }
    }

    // Server-side Cloudflare edge fingerprint. `lastCf` is unconditional;
    // `registrationCf` is a registration-time value and takes the same gate —
    // its `ja4` feeds the corroborating `cf_tls_fingerprint` signal.
    const cf = getCfFingerprint(request.headers);
    if (!isEmptyCfFingerprint(cf)) {
      set.lastCf = cf;
      if (mayBackfillRegistration && user.registrationCf == null) {
        set.registrationCf = cf;
      }
    }

    await users.updateOne(
      { _id: userId },
      {
        $set: set,
        ...(fingerprint ? { $addToSet: { fingerprintHistory: fingerprint } } : {}),
      }
    );

    const clientIp = await getClientIp();
    recordAudit({
      source: "api",
      category: "auth",
      action: "auth.record_fingerprint",
      subject: { type: "user", id: userId, name: authUser.username },
      net: {
        ipMasked: maskIp(clientIp),
        ipHash: hashIp(clientIp),
        fingerprint: fingerprint || undefined,
        uaClass: classifyDevice(request.headers.get("user-agent")),
      },
      outcome: "ok",
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(
      error instanceof Error ? internalError("record-fingerprint failed", error) : error
    );
  }
}
