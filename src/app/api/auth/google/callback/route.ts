import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { randomBytes, randomUUID } from "crypto";
import { SignJWT } from "jose";
import { getDb } from "@/lib/mongodb";
import {
  getAuthUser,
  getJwtSecret,
  getAuthCookieOptions,
  getTrackingCookieOptions,
} from "@/lib/auth"; // Optional auth — intentionally uses getAuthUser() for conditional link/login logic
import { needsCharacterHint } from "@/lib/auth/characterGate";
import { setCharacterGateCookie } from "@/lib/auth/characterGateCookie";
import { AUTH_COOKIE_NAME } from "@/lib/authCookieName";
import { exchangeGoogleCode, fetchGoogleUser } from "@/lib/google";
import { createAdminLog } from "@/lib/adminLog";
import { createNotification } from "@/lib/notifications";
import { OAUTH_DEVICE_KEY_COOKIE, OAUTH_FINGERPRINT_COOKIE } from "@/lib/auth/oauthFingerprint";
import { resolveReferredByFromOAuthCookie } from "@/lib/auth/referralCode";
import { getClientIp, getBaseUrl } from "@/lib/utils/network";
import {
  getCfFingerprint,
  isEmptyCfFingerprint,
  type CfFingerprint,
} from "@/lib/utils/cfFingerprint";
import { assertRegistrationAllowed } from "@/lib/auth/registrationGate";
import { normalizeIp } from "@/lib/utils/ipNormalize";
import { classifyDevice } from "@/lib/utils/userAgent";
import { checkIpFireAndForget } from "@/lib/ip/ipteoh";
import type { GameConfig } from "@/lib/db/types";
import { AUTH_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import type { User } from "@/lib/db/types";
import { normalizeMaintenanceMode } from "@/lib/maintenanceStatus";
import { lakesideAccountFields } from "@/lib/auth/lakesideAccount";
import {
  GOOGLE_OAUTH_RETURN_URL_COOKIE,
  loginDestination,
  takeOAuthReturnUrlCookie,
} from "@/lib/auth/lakesideLoginReturn";

// GET /api/auth/google/callback — Handles the Google OAuth callback to log in or register a user via Google.
// Auth: public
// Errors: 429
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const baseUrl = getBaseUrl(request);
  const clientIp = await getClientIp();
  const limit = checkRateLimit(clientIp, AUTH_LIMITS.maxRequests, AUTH_LIMITS.windowMs);
  if (!limit.ok) return rateLimitResponse(limit.retryAfter);

  const cookieStore = await cookies();
  const mode = cookieStore.get("google_oauth_mode")?.value ?? "link";
  cookieStore.delete("google_oauth_mode");

  const isLoginMode = mode === "login";
  const defaultNext = isLoginMode ? "/login" : "/settings";

  function resultUrl(status: string, reason?: string, next = defaultNext) {
    const params = new URLSearchParams({ status, next });
    if (reason) params.set("reason", reason);
    return new URL(`/auth/google/result?${params.toString()}`, baseUrl);
  }

  if (error) {
    const safeReason = error === "access_denied" ? "access_denied" : "exchange_failed";
    return NextResponse.redirect(resultUrl("error", safeReason));
  }

  if (!code || !state) {
    return NextResponse.redirect(resultUrl("error", "missing_params"));
  }

  const storedState = cookieStore.get("google_oauth_state")?.value;
  if (!storedState || storedState !== state) {
    return NextResponse.redirect(resultUrl("error", "invalid_state"));
  }
  cookieStore.delete("google_oauth_state");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.redirect(resultUrl("error", "not_configured"));
  }

  try {
    const tokenData = await exchangeGoogleCode(code, redirectUri, clientId, clientSecret);
    const googleUser = await fetchGoogleUser(tokenData.access_token);

    if (!googleUser?.id || typeof googleUser.id !== "string") {
      throw new Error("Invalid Google user data");
    }

    const db = await getDb();
    const userAgent = request.headers.get("user-agent");
    const cf = getCfFingerprint(request.headers);

    if (isLoginMode) {
      return handleGoogleLogin(db, googleUser, cookieStore, baseUrl, userAgent, cf);
    } else {
      return handleGoogleLink(db, googleUser, cookieStore, baseUrl);
    }
  } catch (err) {
    console.error("Google OAuth error:", err);
    return NextResponse.redirect(resultUrl("error", "exchange_failed"));
  }
}

async function handleGoogleLogin(
  db: Awaited<ReturnType<typeof getDb>>,
  googleUser: { id: string; email: string; name: string; picture: string | null },
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  baseUrl: string,
  userAgent: string | null,
  cf: CfFingerprint
) {
  const usersCollection = db.collection<User>("users");

  const existingUser = await usersCollection.findOne({ googleId: googleUser.id });

  if (existingUser) {
    if (existingUser.isBanned) {
      const reason = encodeURIComponent(existingUser.banReason || "Violation of rules");
      return NextResponse.redirect(new URL(`/banned?reason=${reason}`, baseUrl));
    }

    const token = await new SignJWT({
      userId: existingUser._id.toString(),
      email: existingUser.email,
      username: existingUser.username,
      role: existingUser.role,
      isAdmin: existingUser.isAdmin || false,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(getJwtSecret());

    cookieStore.set(AUTH_COOKIE_NAME, token, await getAuthCookieOptions());
    await setCharacterGateCookie(
      cookieStore,
      needsCharacterHint({
        role: existingUser.role,
        isAdmin: existingUser.isAdmin === true,
        hasCharacter: existingUser.hasCompletedSetup ?? true,
      })
    );
    const existingTrack = cookieStore.get("__ahd_track")?.value;
    const trackingId = existingTrack || randomUUID();
    if (!existingTrack) {
      cookieStore.set("__ahd_track", trackingId, await getTrackingCookieOptions());
    }
    const oauthDeviceKey = cookieStore.get(OAUTH_DEVICE_KEY_COOKIE)?.value;
    cookieStore.delete(OAUTH_DEVICE_KEY_COOKIE);

    const clientIp = await getClientIp();
    const device = classifyDevice(userAgent);
    const observedAt = new Date();
    await usersCollection.updateOne(
      { _id: existingUser._id },
      {
        $set: {
          lastLogin: observedAt,
          lastKnownIp: clientIp,
          lastKnownIpAt: observedAt,
          lastAuthToken: token.slice(-12),
          trackingId,
          trackingIdAt: observedAt,
          googleEmail: googleUser.email,
          googleName: googleUser.name,
          googleAvatar: googleUser.picture ?? undefined,
          lastDevice: device,
          // Stamp inside the guard — an OAuth login without a device key must
          // not refresh `deviceKeyAt` (src/lib/auth/identitySignals.ts).
          ...(oauthDeviceKey ? { deviceKey: oauthDeviceKey, deviceKeyAt: observedAt } : {}),
          ...(isEmptyCfFingerprint(cf)
            ? {}
            : {
                lastCf: cf,
                ...(existingUser.registrationCf == null ? { registrationCf: cf } : {}),
              }),
        },
        $unset: { authRevokedAt: "" },
      }
    );

    db.collection("activityLog")
      .insertOne({
        type: "login",
        timestamp: new Date(),
        userId: existingUser._id,
        username: existingUser.username,
        ipAddress: clientIp ?? undefined,
        userAgent: userAgent ?? undefined,
        trackingId,
        deviceKey: oauthDeviceKey || undefined,
      })
      .catch(() => {});

    // Prefer a stashed Lakeside SSO continuation (ops dash) over the in-game default.
    const next = loginDestination(
      takeOAuthReturnUrlCookie(cookieStore, GOOGLE_OAUTH_RETURN_URL_COOKIE),
      {
        role: existingUser.role,
        isAdmin: existingUser.isAdmin === true,
        hasCompletedSetup: existingUser.hasCompletedSetup ?? true,
      }
    );
    return NextResponse.redirect(
      new URL(`/auth/google/result?status=login_success&next=${encodeURIComponent(next)}`, baseUrl)
    );
  }

  // No existing user — auto-register via Google. Gate new-user creation only;
  // existing users re-authenticating via OAuth never reach this branch.
  //
  // Block new-account creation during maintenance (partial or full), mirroring
  // POST /api/auth/register and the Discord callback — otherwise Google would
  // be the one signup path that ignores maintenance mode.
  const maintConfig = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { maintenanceMode: 1 } });
  if (normalizeMaintenanceMode(maintConfig?.maintenanceMode) !== "off") {
    return NextResponse.redirect(
      new URL(
        `/auth/google/result?status=error&reason=maintenance&next=${encodeURIComponent("/maintenance")}`,
        baseUrl
      )
    );
  }

  const clientIp = await getClientIp();
  const existingTrack = cookieStore.get("__ahd_track")?.value;
  const oauthFingerprint = cookieStore.get(OAUTH_FINGERPRINT_COOKIE)?.value;
  cookieStore.delete(OAUTH_FINGERPRINT_COOKIE);
  const oauthDeviceKey = cookieStore.get(OAUTH_DEVICE_KEY_COOKIE)?.value;
  cookieStore.delete(OAUTH_DEVICE_KEY_COOKIE);
  const referredByObjectId = await resolveReferredByFromOAuthCookie(cookieStore, usersCollection);
  const device = classifyDevice(userAgent);
  let gateDecision: Awaited<ReturnType<typeof assertRegistrationAllowed>> = {};
  try {
    gateDecision = await assertRegistrationAllowed(db, {
      clientIp,
      trackingId: existingTrack,
      fingerprint: oauthFingerprint,
      deviceKey: oauthDeviceKey,
      device,
    });
  } catch (err) {
    // ApiError → surface as a user-facing redirect rather than a 500.
    if (err instanceof Error && "status" in err && (err as { status: number }).status === 403) {
      return NextResponse.redirect(
        new URL("/auth/google/result?status=error&reason=registration_blocked", baseUrl)
      );
    }
    throw err;
  }
  const trackingId = existingTrack || randomUUID();
  if (!existingTrack) {
    cookieStore.set("__ahd_track", trackingId, await getTrackingCookieOptions());
  }

  // Generate username from Google name
  const baseUsername =
    googleUser.name
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 16) || "player";

  let username = baseUsername;
  let attempts = 0;
  const maxAttempts = 15;
  while (attempts < maxAttempts) {
    const taken = await usersCollection.findOne({ username });
    if (!taken) break;
    const suffix = randomBytes(4).toString("hex");
    username = `${baseUsername}_${suffix}`.slice(0, 32);
    attempts++;
  }
  if (attempts >= maxAttempts) {
    username = `google_${googleUser.id}`.slice(0, 32);
  }

  // Use a placeholder email that is unique and clearly identifies Google-only accounts
  const email = `google_${googleUser.id}@google.local`;

  // Single instant for this row's timestamps, including the per-signal `*At`
  // stamps (src/lib/auth/identitySignals.ts).
  const newUserObservedAt = new Date();

  const result = await usersCollection.insertOne({
    email,
    username,
    displayName: googleUser.name,
    password: "", // No password for Google-only accounts — login route rejects empty-password accounts
    role: "player",
    isAdmin: false,
    hasCompletedSetup: false,
    googleId: googleUser.id,
    googleEmail: googleUser.email,
    googleName: googleUser.name,
    googleAvatar: googleUser.picture ?? undefined,
    googleLinkedAt: new Date(),
    // Normalized so the IP-collision check matches consistently across
    // header variants (see registrationGate.ts).
    registrationIp: normalizeIp(clientIp) ?? clientIp,
    lastKnownIp: clientIp,
    lastKnownIpAt: newUserObservedAt,
    // Persist the fingerprint carried via the OAuth cookie so the registration
    // gate can match a later alt from the same device immediately (not only after
    // the post-auth record-fingerprint backfill).
    registrationFingerprint: oauthFingerprint || null,
    lastFingerprint: oauthFingerprint || null,
    ...(oauthFingerprint
      ? { registrationFingerprintAt: newUserObservedAt, lastFingerprintAt: newUserObservedAt }
      : {}),
    fingerprintHistory: oauthFingerprint ? [oauthFingerprint] : [],
    ...(isEmptyCfFingerprint(cf) ? {} : { registrationCf: cf, lastCf: cf }),
    trackingId,
    trackingIdAt: newUserObservedAt,
    deviceKey: oauthDeviceKey || null,
    ...(oauthDeviceKey ? { deviceKeyAt: newUserObservedAt } : {}),
    lastDevice: device,
    ...(referredByObjectId ? { referredBy: referredByObjectId } : {}),
    referralCount: 0,
    ...lakesideAccountFields("ahd-google"),
    createdAt: newUserObservedAt,
    updatedAt: newUserObservedAt,
  } as unknown as User);

  await createAdminLog({
    category: "account",
    action: "account_created",
    username,
    details: `Registered via Google (${googleUser.email})`,
  });

  if (gateDecision.softAllow) {
    const sa = gateDecision.softAllow;
    await createAdminLog({
      category: "account",
      action: "cgnat_soft_allow",
      username,
      details: `Allowed despite IP collision (${sa.device}) — shared IP ${sa.sharedIp} already used by ${sa.existingCount} account${sa.existingCount === 1 ? "" : "s"}.`,
    });
  }

  // Fire-and-forget: IP/VPN detection via ipapi.co.
  db.collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { ipDetectionEnabled: 1 } })
    .then((config) => {
      if (config?.ipDetectionEnabled) {
        checkIpFireAndForget(clientIp).then((ipDetails) => {
          if (ipDetails) {
            usersCollection
              .updateOne({ _id: result.insertedId }, { $set: { ipDetails } })
              .catch(() => {});
          }
        });
      }
    })
    .catch(() => {});

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

  const token = await new SignJWT({
    userId: result.insertedId.toString(),
    email,
    username,
    role: "player",
    isAdmin: false,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());

  cookieStore.set(AUTH_COOKIE_NAME, token, await getAuthCookieOptions());
  // Brand-new OAuth account — no character yet, so gate it into /create-character.
  await setCharacterGateCookie(cookieStore, true);

  await usersCollection.updateOne(
    { _id: result.insertedId },
    // No `lastKnownIpAt` here: this `$set` writes no IP, and stamping it would
    // assert an observation that did not happen.
    {
      $set: {
        lastLogin: new Date(),
        lastAuthToken: token.slice(-12),
        trackingId,
        trackingIdAt: new Date(),
      },
    }
  );

  db.collection("activityLog")
    .insertOne({
      type: "login",
      timestamp: new Date(),
      userId: result.insertedId,
      username,
      ipAddress: clientIp ?? undefined,
      userAgent: userAgent ?? undefined,
      trackingId,
    })
    .catch(() => {});

  const next = loginDestination(
    takeOAuthReturnUrlCookie(cookieStore, GOOGLE_OAUTH_RETURN_URL_COOKIE),
    {
      role: "player",
      isAdmin: false,
      hasCompletedSetup: false,
    }
  );
  return NextResponse.redirect(
    new URL(`/auth/google/result?status=login_success&next=${encodeURIComponent(next)}`, baseUrl)
  );
}

async function handleGoogleLink(
  db: Awaited<ReturnType<typeof getDb>>,
  googleUser: { id: string; email: string; name: string; picture: string | null },
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  baseUrl: string
) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", baseUrl));
  }

  const existingUser = await db.collection<User>("users").findOne({
    googleId: googleUser.id,
    _id: { $ne: new ObjectId(user.userId) },
  });

  if (existingUser) {
    return NextResponse.redirect(
      new URL(
        `/auth/google/result?status=error&reason=already_linked&next=${encodeURIComponent("/settings")}`,
        baseUrl
      )
    );
  }

  await db.collection<User>("users").updateOne(
    { _id: new ObjectId(user.userId) },
    {
      $set: {
        googleId: googleUser.id,
        googleEmail: googleUser.email,
        googleName: googleUser.name,
        googleAvatar: googleUser.picture ?? undefined,
        googleLinkedAt: new Date(),
      },
    }
  );

  return NextResponse.redirect(
    new URL(`/auth/google/result?status=success&next=${encodeURIComponent("/settings")}`, baseUrl)
  );
}
