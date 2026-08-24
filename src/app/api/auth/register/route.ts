import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { timingSafeCompare } from "@/lib/api/timingSafeCompare";
import bcrypt from "bcryptjs";
import { createHash, randomUUID } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { cookies } from "next/headers";
import { createAdminLog } from "@/lib/adminLog";
import { getClientIp } from "@/lib/utils/network";
import { createNotification } from "@/lib/notifications";
import { AUTH_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { durableRateLimit } from "@/lib/api/rateLimit.mongo";
import { parseJsonBody } from "@/lib/api/validate";
import { registerBodySchema } from "@/lib/api/schemas/auth";
import { normalizeReferralCode } from "@/lib/auth/normalizeReferralCode";
import { getTrackingCookieOptions } from "@/lib/auth";
import { assertRegistrationAllowed } from "@/lib/auth/registrationGate";
import { normalizeIp } from "@/lib/utils/ipNormalize";
import { classifyDevice } from "@/lib/utils/userAgent";
import { checkIpFireAndForget } from "@/lib/ip/ipteoh";
import { getCfFingerprint, isEmptyCfFingerprint } from "@/lib/utils/cfFingerprint";
import type { GameConfig } from "@/lib/db/types";
import { normalizeMaintenanceMode } from "@/lib/maintenanceStatus";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { lakesideAccountFields } from "@/lib/auth/lakesideAccount";
import { recordAudit } from "@/lib/audit/recordAudit";
import type { ActionAuditNet } from "@/lib/db/types/actionAuditLog";

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

// POST /api/auth/register — Creates a new user account with optional admin key or referral code.
// Auth: public
// Errors: 400, 403, 409, 429, 503
export async function POST(request: Request) {
  try {
    const db = await getDb();
    const clientIp = await getClientIp();

    // Block registration during maintenance mode (both "partial" and "full").
    const config = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });
    if (normalizeMaintenanceMode(config?.maintenanceMode) !== "off") {
      return NextResponse.json(
        { error: "Registration is disabled during maintenance. Please try again later." },
        { status: 503 }
      );
    }

    const limit = await durableRateLimit(clientIp, AUTH_LIMITS.maxRequests, AUTH_LIMITS.windowMs);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const parsed = await parseJsonBody(request, registerBodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const {
      email,
      username,
      password,
      adminKey,
      fingerprint,
      deviceKey,
      fingerprintComponents,
      referralCode,
      testSecret,
      ageConfirmed,
      termsAccepted,
      turnstileToken,
    } = parsed.data;

    // Read (not minted) here so every rejection/acceptance path below shares
    // one masked/hashed `net` snapshot — mirrors the login route.
    const cookieStore = await cookies();
    const existingTrack = cookieStore.get("__ahd_track")?.value;
    const device = classifyDevice(request.headers.get("user-agent"));
    const netBase: ActionAuditNet = {
      ipMasked: maskIp(clientIp),
      ipHash: hashIp(clientIp),
      fingerprint: fingerprint || undefined,
      deviceKey: deviceKey || undefined,
      trackingId: existingTrack,
      uaClass: device,
    };

    const turnstile = await verifyTurnstileToken(turnstileToken, clientIp);
    if (!turnstile.ok) {
      recordAudit({
        source: "api",
        category: "auth",
        action: "auth.register",
        subject: { type: "user", name: email.toLowerCase() },
        net: netBase,
        outcome: "rejected",
        reason: "turnstile_failed",
      });
      return NextResponse.json(
        { error: "Verification failed. Please try again." },
        { status: 400 }
      );
    }

    if (!ageConfirmed || !termsAccepted) {
      recordAudit({
        source: "api",
        category: "auth",
        action: "auth.register",
        subject: { type: "user", name: email.toLowerCase() },
        net: netBase,
        outcome: "rejected",
        reason: !ageConfirmed ? "age_not_confirmed" : "terms_not_accepted",
      });
    }
    if (!ageConfirmed) {
      return NextResponse.json(
        { error: "You must confirm that you are at least 13 years old to register." },
        { status: 400 }
      );
    }
    if (!termsAccepted) {
      return NextResponse.json(
        { error: "You must accept the Terms of Service and Privacy Policy to register." },
        { status: 400 }
      );
    }

    // Master kill-switch, manual IP bans, and (if enabled) registration-collision checks.
    // Throws ApiError(403) on block — caught by handleRouteError below.
    let gateDecision;
    try {
      gateDecision = await assertRegistrationAllowed(db, {
        clientIp,
        fingerprint,
        trackingId: existingTrack,
        deviceKey,
        device,
      });
    } catch (err) {
      recordAudit({
        source: "api",
        category: "auth",
        action: "auth.register",
        subject: { type: "user", name: email.toLowerCase() },
        net: netBase,
        outcome: "rejected",
        reason: "registration_gate_blocked",
      });
      throw err;
    }

    // Block registration when test mode is enabled and no valid test secret is provided
    if (config?.testMode) {
      const expectedSecret = process.env.TEST_SECRET;
      if (!expectedSecret || !timingSafeCompare(testSecret ?? "", expectedSecret)) {
        recordAudit({
          source: "api",
          category: "auth",
          action: "auth.register",
          subject: { type: "user", name: email.toLowerCase() },
          net: netBase,
          outcome: "rejected",
          reason: "invalid_test_secret",
        });
        return NextResponse.json(
          { error: "Registration requires a valid test secret. Contact an admin for access." },
          { status: 403 }
        );
      }
    }

    const usersCollection = db.collection("users");

    // Check if user already exists
    const existingUser = await usersCollection.findOne({
      $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }],
    });

    if (existingUser) {
      recordAudit({
        source: "api",
        category: "auth",
        action: "auth.register",
        subject: { type: "user", name: email.toLowerCase() },
        net: netBase,
        outcome: "rejected",
        reason: "duplicate_account",
      });
      return NextResponse.json(
        { error: "An account with this email or username already exists" },
        { status: 409 }
      );
    }

    // Validate referral code if provided
    let referredByObjectId: ObjectId | undefined;
    if (referralCode) {
      const normalizedReferralCode = normalizeReferralCode(referralCode);
      if (!normalizedReferralCode) {
        recordAudit({
          source: "api",
          category: "auth",
          action: "auth.register",
          subject: { type: "user", name: email.toLowerCase() },
          net: netBase,
          outcome: "rejected",
          reason: "invalid_referral_code",
        });
        return NextResponse.json({ error: "Invalid referral code" }, { status: 400 });
      }
      const referrer = await usersCollection.findOne({ _id: new ObjectId(normalizedReferralCode) });
      if (!referrer) {
        recordAudit({
          source: "api",
          category: "auth",
          action: "auth.register",
          subject: { type: "user", name: email.toLowerCase() },
          net: netBase,
          outcome: "rejected",
          reason: "invalid_referral_code",
        });
        return NextResponse.json({ error: "Invalid referral code" }, { status: 400 });
      }
      // Prevent self-referral (can't happen at registration but guard anyway)
      referredByObjectId = referrer._id as ObjectId;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Determine if user should be an admin
    let isAdmin = false;
    if (adminKey && adminKey.trim() !== "") {
      // Master switch — checked before key validation so a disabled flag
      // never leaks timing info about whether the provided key matches.
      // Treated as enabled when undefined for legacy configs.
      if (config?.adminRegistrationEnabled === false) {
        recordAudit({
          source: "api",
          category: "auth",
          action: "auth.register",
          subject: { type: "user", name: email.toLowerCase() },
          net: netBase,
          outcome: "rejected",
          reason: "admin_registration_disabled",
        });
        return NextResponse.json(
          { error: "Admin registration is currently disabled." },
          { status: 403 }
        );
      }
      const adminRegKey = process.env.ADMIN_REGISTRATION_KEY;
      if (adminRegKey && timingSafeCompare(adminKey ?? "", adminRegKey)) {
        isAdmin = true;
      } else {
        recordAudit({
          source: "api",
          category: "auth",
          action: "auth.register",
          subject: { type: "user", name: email.toLowerCase() },
          net: netBase,
          outcome: "rejected",
          reason: "invalid_admin_key",
        });
        return NextResponse.json({ error: "Invalid admin key" }, { status: 403 });
      }
    }

    // Persistent tracking cookie for anti-fraud duplicate detection
    const trackingId = existingTrack || randomUUID();
    if (!existingTrack) {
      cookieStore.set("__ahd_track", trackingId, await getTrackingCookieOptions());
    }

    // Server-side Cloudflare edge fingerprint (country/ASN/colo/JA4/bot &
    // threat scores) — all-optional, `{}` when this zone/request exposes
    // none of it (e.g. local dev with no Cloudflare in front).
    const cf = getCfFingerprint(request.headers);

    // Single instant for the row's timestamps, including the per-signal `*At`
    // stamps (src/lib/auth/identitySignals.ts).
    const observedAt = new Date();

    // Create player user
    const result = await usersCollection.insertOne({
      email: email.toLowerCase(),
      username: username.toLowerCase(),
      displayName: username,
      password: hashedPassword,
      role: "player",
      isAdmin: isAdmin, // Flag to indicate admin privileges
      hasCompletedSetup: false, // Character creation not done yet
      // Store normalized form so the IP-collision check (which normalizes on
      // read via registrationGate) can match consistently across header
      // variants (IPv4-mapped IPv6 vs bare IPv4, casing, whitespace).
      registrationIp: normalizeIp(clientIp) ?? clientIp,
      lastKnownIp: clientIp,
      lastKnownIpAt: observedAt,
      registrationFingerprint: fingerprint || null,
      lastFingerprint: fingerprint || null,
      // Stamped only when a fingerprint was actually supplied — an absent one
      // must not read as "observed at signup".
      ...(fingerprint
        ? { registrationFingerprintAt: observedAt, lastFingerprintAt: observedAt }
        : {}),
      fingerprintHistory: fingerprint ? [fingerprint] : [],
      registrationFingerprintComponents: fingerprintComponents ?? null,
      lastFingerprintComponents: fingerprintComponents ?? null,
      ...(isEmptyCfFingerprint(cf) ? {} : { registrationCf: cf, lastCf: cf }),
      trackingId,
      trackingIdAt: observedAt,
      deviceKey: deviceKey || null,
      ...(deviceKey ? { deviceKeyAt: observedAt } : {}),
      lastDevice: device,
      ...(referredByObjectId ? { referredBy: referredByObjectId } : {}),
      referralCount: 0,
      activeCharacterId: null,
      activeCharacterCount: 0,
      ...lakesideAccountFields("ahd"),
      createdAt: observedAt,
      updatedAt: observedAt,
    });

    // Log account creation
    await createAdminLog({
      category: "account",
      action: "account_created",
      username: username.toLowerCase(),
      details: isAdmin ? "Created with admin privileges" : undefined,
    });

    if (gateDecision.softAllow) {
      // Surfaces the cgNAT bypass in the admin log so moderators can review
      // registrations that slipped past the IP-collision block.
      const sa = gateDecision.softAllow;
      await createAdminLog({
        category: "account",
        action: "cgnat_soft_allow",
        username: username.toLowerCase(),
        details: `Allowed despite IP collision (${sa.device}) — shared IP ${sa.sharedIp} already used by ${sa.existingCount} account${sa.existingCount === 1 ? "" : "s"}.`,
      });
    }

    // Fire-and-forget: IP/VPN detection via ipapi.co.
    // Non-blocking — if it fails, registration still succeeds.
    if (config?.ipDetectionEnabled) {
      checkIpFireAndForget(clientIp).then((ipDetails) => {
        if (ipDetails) {
          usersCollection
            .updateOne({ _id: result.insertedId }, { $set: { ipDetails } })
            .catch(() => {});
        }
      });
    }

    // Send welcome notification
    await createNotification({
      userId: result.insertedId as ObjectId,
      type: "welcome",
      title: "Welcome to A House Divided!",
      message:
        "You've entered one of the most competitive political simulations online. " +
        "Create your character, choose a home state, and pick a party — then start building influence. " +
        "Use Actions to campaign, fundraise, and advertise. Enter elections to win office. " +
        "Primary elections narrow each party to one candidate; the general election decides the winner. " +
        "Good luck, and may the best politician win.",
    });

    recordAudit({
      source: "api",
      category: "auth",
      action: "auth.register",
      subject: { type: "user", id: result.insertedId, name: username.toLowerCase() },
      net: { ...netBase, trackingId },
      outcome: "ok",
    });

    return NextResponse.json(
      {
        message: "Account created successfully" + (isAdmin ? " with admin privileges" : ""),
        userId: result.insertedId.toString(),
        isAdmin: isAdmin,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
