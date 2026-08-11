import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createHash, randomUUID } from "crypto";
import { getDb } from "@/lib/mongodb";
import { SignJWT } from "jose";
import { cookies } from "next/headers";
import { getJwtSecret, getAuthCookieOptions, getTrackingCookieOptions } from "@/lib/auth";
import { needsCharacterHint } from "@/lib/auth/characterGate";
import { setCharacterGateCookie } from "@/lib/auth/characterGateCookie";
import { AUTH_COOKIE_NAME } from "@/lib/authCookieName";
import { getClientIp } from "@/lib/utils/network";
import { AUTH_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { durableRateLimit } from "@/lib/api/rateLimit.mongo";
import { parseJsonBody } from "@/lib/api/validate";
import { loginBodySchema } from "@/lib/api/schemas/auth";
import { handleRouteError, internalError } from "@/lib/api/errors";
import { classifyDevice } from "@/lib/utils/userAgent";
import { checkIpFireAndForget } from "@/lib/ip/ipteoh";
import { getCfFingerprint, isEmptyCfFingerprint } from "@/lib/utils/cfFingerprint";
import type { GameConfig } from "@/lib/db/types";
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

// POST /api/auth/login — Authenticates a user with email/username and password, sets an HTTP-only JWT cookie.
// Auth: public
// Errors: 400, 401, 403, 429
export async function POST(request: Request) {
  try {
    const clientIp = await getClientIp();
    const limit = await durableRateLimit(clientIp, AUTH_LIMITS.maxRequests, AUTH_LIMITS.windowMs);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const parsed = await parseJsonBody(request, loginBodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { email, password, fingerprint, deviceKey, fingerprintComponents } = parsed.data;

    // Built once and reused for every outcome below — masked/hashed IP,
    // pass-through fingerprint/deviceKey (already opaque client-side
    // identifiers, never raw PII), and the device class. `trackingId` is
    // read (not minted) here so failed attempts still carry it.
    const netBase: ActionAuditNet = {
      ipMasked: maskIp(clientIp),
      ipHash: hashIp(clientIp),
      fingerprint: fingerprint || undefined,
      deviceKey: deviceKey || undefined,
      trackingId: (await cookies()).get("__ahd_track")?.value,
      uaClass: classifyDevice(request.headers.get("user-agent")),
    };

    const db = await getDb();
    const usersCollection = db.collection("users");

    // Find user by email or username
    const user = await usersCollection.findOne({
      $or: [{ email: email.toLowerCase() }, { username: email.toLowerCase() }],
    });

    if (!user) {
      // Perform dummy bcrypt compare to prevent timing-based username enumeration
      await bcrypt.compare(
        password,
        "$2a$12$dummyhashfortimingprotectiononly00000000000000000000000"
      );
      recordAudit({
        source: "api",
        category: "auth",
        action: "auth.login",
        subject: { type: "user", name: email.toLowerCase() },
        net: netBase,
        outcome: "rejected",
        reason: "invalid_credentials",
      });
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Check if user is banned
    if (user.isBanned) {
      recordAudit({
        source: "api",
        category: "auth",
        action: "auth.login",
        subject: { type: "user", id: user._id, name: user.username },
        net: netBase,
        outcome: "rejected",
        reason: "banned",
      });
      return NextResponse.json(
        { error: "banned", reason: user.banReason || "Violation of rules" },
        { status: 403 }
      );
    }

    // Verify password — reject OAuth-only accounts that have no password set
    const isValidPassword = user.password && (await bcrypt.compare(password, user.password));

    if (!isValidPassword) {
      recordAudit({
        source: "api",
        category: "auth",
        action: "auth.login",
        subject: { type: "user", id: user._id, name: user.username },
        net: netBase,
        outcome: "rejected",
        reason: "invalid_credentials",
      });
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Create JWT token
    const token = await new SignJWT({
      userId: user._id.toString(),
      email: user.email,
      username: user.username,
      role: user.role,
      isAdmin: user.isAdmin || false,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(getJwtSecret());

    // Set HTTP-only cookie
    const cookieStore = await cookies();
    cookieStore.set(AUTH_COOKIE_NAME, token, await getAuthCookieOptions());

    // Seed the character-creation hint cookie so a player with no character is
    // redirected to /create-character from their first navigation (the /api/auth/me
    // self-healer reconciles it against DB truth thereafter). hasCompletedSetup is
    // the existing proxy the post-login client redirect already keys off of.
    await setCharacterGateCookie(
      cookieStore,
      needsCharacterHint({
        role: user.role,
        isAdmin: user.isAdmin === true,
        hasCharacter: user.hasCompletedSetup ?? true,
      })
    );

    // Persistent tracking cookie for anti-fraud duplicate detection.
    // Re-use existing value so the ID survives across logins; generate a new one only on first visit.
    const existingTrack = cookieStore.get("__ahd_track")?.value;
    const trackingId = existingTrack || randomUUID();
    if (!existingTrack) {
      cookieStore.set("__ahd_track", trackingId, await getTrackingCookieOptions());
    }

    const device = classifyDevice(request.headers.get("user-agent"));

    // Server-side Cloudflare edge fingerprint — mirrors the fingerprint
    // components backfill below: always refresh `lastCf`, and backfill
    // `registrationCf` only when this account never captured one (legacy
    // accounts created before this field existed).
    const cf = getCfFingerprint(request.headers);

    // Update last login, IP, token identifier, fingerprint, and tracking ID.
    // Each identity signal carries its own `*At` stamp so staleness can be
    // judged per signal (src/lib/auth/identitySignals.ts) — `lastLogin` is not
    // a valid proxy for signals written conditionally below.
    const observedAt = new Date();
    const updateFields: Record<string, unknown> = {
      lastLogin: observedAt,
      lastKnownIp: clientIp,
      lastKnownIpAt: observedAt,
      lastAuthToken: token.slice(-12), // Store last 12 chars of token for identification
      trackingId,
      trackingIdAt: observedAt,
      lastDevice: device,
    };

    if (!isEmptyCfFingerprint(cf)) {
      updateFields.lastCf = cf;
      if (user.registrationCf == null) {
        updateFields.registrationCf = cf;
      }
    }

    // Stamps live INSIDE these guards on purpose: a login from a browser with
    // cleared/blocked localStorage refreshes `lastLogin` without re-observing
    // the device key, so stamping unconditionally would make a year-old key
    // read as fresh forever.
    if (fingerprint) {
      updateFields.lastFingerprint = fingerprint;
      updateFields.lastFingerprintAt = observedAt;
    }
    if (deviceKey) {
      updateFields.deviceKey = deviceKey;
      updateFields.deviceKeyAt = observedAt;
    }
    if (fingerprintComponents) {
      updateFields.lastFingerprintComponents = fingerprintComponents;
    }

    await usersCollection.updateOne(
      { _id: user._id },
      {
        $set: updateFields,
        // Successful re-auth invalidates prior session-revocation; otherwise a
        // leftover authRevokedAt + stale sibling JWT breaks Lakeside/Ops SSO.
        $unset: { authRevokedAt: "" },
        // Add fingerprint to history if it's new
        ...(fingerprint ? { $addToSet: { fingerprintHistory: fingerprint } } : {}),
      }
    );

    // Fire-and-forget: log the login event for admin activity tracking.
    // If this insert fails, the login itself is unaffected.
    db.collection("activityLog")
      .insertOne({
        type: "login",
        timestamp: new Date(),
        userId: user._id,
        username: user.username as string,
        ipAddress: clientIp ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
        fingerprint: fingerprint || undefined,
        trackingId,
        deviceKey: deviceKey || undefined,
      })
      .catch(() => {});

    recordAudit({
      source: "api",
      category: "auth",
      action: "auth.login",
      subject: { type: "user", id: user._id, name: user.username },
      net: { ...netBase, trackingId, uaClass: device },
      outcome: "ok",
    });

    // Fire-and-forget: backfill IP details for users missing them.
    // Only runs if ipDetectionEnabled is on and this user has no ipDetails yet.
    if (!user.ipDetails) {
      db.collection<GameConfig>("gameConfig")
        .findOne({ _id: "default" }, { projection: { ipDetectionEnabled: 1 } })
        .then((config) => {
          if (config?.ipDetectionEnabled) {
            checkIpFireAndForget(clientIp).then((ipDetails) => {
              if (ipDetails) {
                usersCollection
                  .updateOne({ _id: user._id }, { $set: { ipDetails } })
                  .catch(() => {});
              }
            });
          }
        })
        .catch(() => {});
    }

    return NextResponse.json({
      message: "Login successful",
      user: {
        id: user._id.toString(),
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        hasCompletedSetup: user.hasCompletedSetup ?? true, // Default true for admins/legacy users
        isAdmin: user.isAdmin || false,
      },
    });
  } catch (error) {
    return handleRouteError(error instanceof Error ? internalError("Login failed", error) : error);
  }
}
