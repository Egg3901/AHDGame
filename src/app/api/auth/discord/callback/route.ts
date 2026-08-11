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
import { exchangeCodeForToken, fetchDiscordUser } from "@/lib/discord";
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
import { AUTH_LIMITS, checkRateLimit } from "@/lib/api/rateLimit";
import type { User, GameConfig } from "@/lib/db/types";
import { normalizeMaintenanceMode } from "@/lib/maintenanceStatus";
import { lakesideAccountFields } from "@/lib/auth/lakesideAccount";
import {
  DISCORD_OAUTH_RETURN_URL_COOKIE,
  loginDestination,
  takeOAuthReturnUrlCookie,
} from "@/lib/auth/lakesideLoginReturn";

// GET /api/auth/discord/callback — Handles the Discord OAuth callback to log in or register a user via Discord.
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
  // OAuth callbacks are browser navigations — redirect on rate limit instead of returning JSON
  const isRateLimited = !limit.ok;

  const cookieStore = await cookies();
  const modeCookie = cookieStore.get("discord_oauth_mode");
  const mode = modeCookie?.value;
  cookieStore.delete("discord_oauth_mode");

  // Default redirect target when we don't yet know the intended mode
  const defaultNext = mode === "login" ? "/login" : "/settings";

  function resultUrl(status: string, reason?: string, next = defaultNext) {
    const params = new URLSearchParams({ status, next });
    if (reason) params.set("reason", reason);
    return new URL(`/auth/discord/result?${params.toString()}`, baseUrl);
  }

  if (isRateLimited) {
    return NextResponse.redirect(resultUrl("error", "rate_limited"));
  }

  if (!mode) {
    return NextResponse.redirect(resultUrl("error", "session_expired"));
  }

  const isLoginMode = mode === "login";

  // Handle Discord errors (user denied, etc.) — sanitize to known values to prevent injection
  const KNOWN_DISCORD_ERRORS = [
    "access_denied",
    "invalid_scope",
    "invalid_request",
    "server_error",
  ];
  if (error) {
    const safeReason = KNOWN_DISCORD_ERRORS.includes(error) ? error : "exchange_failed";
    return NextResponse.redirect(resultUrl("error", safeReason));
  }

  if (!code || !state) {
    return NextResponse.redirect(
      resultUrl("error", "missing_params", isLoginMode ? "/login" : "/settings")
    );
  }

  // Verify state token
  const storedState = cookieStore.get("discord_oauth_state")?.value;

  if (!storedState || storedState !== state) {
    return NextResponse.redirect(resultUrl("error", "invalid_state"));
  }

  cookieStore.delete("discord_oauth_state");

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.redirect(resultUrl("error", "not_configured"));
  }

  try {
    // Exchange code for token
    const tokenData = await exchangeCodeForToken(code, redirectUri, clientId, clientSecret);

    // Fetch Discord user info
    const discordUser = await fetchDiscordUser(tokenData.access_token);
    if (!discordUser?.id || typeof discordUser.id !== "string" || !discordUser.username) {
      throw new Error("Invalid Discord user data");
    }

    const db = await getDb();
    const userAgent = request.headers.get("user-agent");
    const cf = getCfFingerprint(request.headers);

    if (isLoginMode) {
      return handleDiscordLogin(db, discordUser, cookieStore, baseUrl, userAgent, cf);
    } else {
      return handleDiscordLink(db, discordUser, cookieStore, baseUrl);
    }
  } catch (err) {
    console.error("Discord OAuth error:", err);
    return NextResponse.redirect(resultUrl("error", "exchange_failed"));
  }
}

/**
 * Handle Discord OAuth for login/register (no existing session required).
 * If a user with this discordId exists, log them in.
 * If not, create a new account and redirect to character setup.
 */
async function handleDiscordLogin(
  db: Awaited<ReturnType<typeof getDb>>,
  discordUser: { id: string; username: string; avatar: string | null },
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  baseUrl: string,
  userAgent: string | null,
  cf: CfFingerprint
) {
  const usersCollection = db.collection<User>("users");

  // Check if a user with this Discord ID already exists
  const existingUser = await usersCollection.findOne({ discordId: discordUser.id });

  if (existingUser) {
    // Check if banned
    if (existingUser.isBanned) {
      const reason = encodeURIComponent(existingUser.banReason || "Violation of rules");
      return NextResponse.redirect(new URL(`/banned?reason=${reason}`, baseUrl));
    }

    // Issue JWT and log them in
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

    // Update last login and Discord info
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
          discordUsername: discordUser.username,
          discordAvatar: discordUser.avatar ?? undefined,
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

    // Redirect via result page for guaranteed feedback. Prefer a stashed
    // Lakeside SSO continuation (ops dash) over the in-game default.
    const next = loginDestination(
      takeOAuthReturnUrlCookie(cookieStore, DISCORD_OAUTH_RETURN_URL_COOKIE),
      {
        role: existingUser.role,
        isAdmin: existingUser.isAdmin === true,
        hasCompletedSetup: existingUser.hasCompletedSetup ?? true,
      }
    );
    return NextResponse.redirect(
      new URL(`/auth/discord/result?status=login_success&next=${encodeURIComponent(next)}`, baseUrl)
    );
  }

  // Block new Discord registrations when maintenance or test mode is enabled
  const gameConfig = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { maintenanceMode: 1, testMode: 1 } });
  if (normalizeMaintenanceMode(gameConfig?.maintenanceMode) !== "off") {
    return NextResponse.redirect(
      new URL(
        `/auth/discord/result?status=error&reason=maintenance&next=${encodeURIComponent("/maintenance")}`,
        baseUrl
      )
    );
  }
  if (gameConfig?.testMode) {
    return NextResponse.redirect(
      new URL(
        `/auth/discord/result?status=error&reason=test_mode&next=${encodeURIComponent("/login")}`,
        baseUrl
      )
    );
  }

  // No existing user — auto-register via Discord. Gate new-user creation only;
  // existing users re-authenticating via OAuth never reach this branch.
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
    if (err instanceof Error && "status" in err && (err as { status: number }).status === 403) {
      return NextResponse.redirect(
        new URL("/auth/discord/result?status=error&reason=registration_blocked", baseUrl)
      );
    }
    throw err;
  }
  const trackingId = existingTrack || randomUUID();
  if (!existingTrack) {
    cookieStore.set("__ahd_track", trackingId, await getTrackingCookieOptions());
  }

  // Generate a unique username from the Discord username (bulletproof against collisions)
  const baseUsername =
    discordUser.username
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 16) || "player";

  let username = baseUsername;
  let attempts = 0;
  const maxAttempts = 15;
  while (attempts < maxAttempts) {
    const taken = await usersCollection.findOne({ username });
    if (!taken) break;
    // Use crypto random for collision-resistant suffix; fallback to discordId if needed
    const suffix = randomBytes(4).toString("hex");
    username = `${baseUsername}_${suffix}`.slice(0, 32);
    attempts++;
  }
  // Final fallback: guarantee uniqueness with discordId (always unique per Discord user)
  if (attempts >= maxAttempts) {
    username = `discord_${discordUser.id}`.slice(0, 32);
  }

  // Use a placeholder email that is unique and clearly identifies Discord-only accounts
  const email = `discord_${discordUser.id}@discord.local`;

  // Single instant for this row's timestamps, including the per-signal `*At`
  // stamps (src/lib/auth/identitySignals.ts).
  const newUserObservedAt = new Date();

  const result = await usersCollection.insertOne({
    email,
    username,
    displayName: discordUser.username,
    password: "", // No password for Discord-only accounts — login route rejects empty-password accounts
    role: "player",
    isAdmin: false,
    hasCompletedSetup: false,
    discordId: discordUser.id,
    discordUsername: discordUser.username,
    discordAvatar: discordUser.avatar ?? undefined,
    discordLinkedAt: new Date(),
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
    ...lakesideAccountFields("ahd-discord"),
    createdAt: newUserObservedAt,
    updatedAt: newUserObservedAt,
  } as unknown as User);

  // Log account creation
  await createAdminLog({
    category: "account",
    action: "account_created",
    username,
    details: `Registered via Discord (${discordUser.username})`,
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
  if (gameConfig?.ipDetectionEnabled) {
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

  // Issue JWT for the new user
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

  // New user → needs character creation (unless Lakeside SSO continuation wins).
  const next = loginDestination(
    takeOAuthReturnUrlCookie(cookieStore, DISCORD_OAUTH_RETURN_URL_COOKIE),
    {
      role: "player",
      isAdmin: false,
      hasCompletedSetup: false,
    }
  );
  return NextResponse.redirect(
    new URL(`/auth/discord/result?status=login_success&next=${encodeURIComponent(next)}`, baseUrl)
  );
}

/**
 * Handle Discord OAuth for account linking (existing session required).
 */
async function handleDiscordLink(
  db: Awaited<ReturnType<typeof getDb>>,
  discordUser: { id: string; username: string; avatar: string | null },
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  baseUrl: string
) {
  // Read the return URL stored by /api/auth/discord so callers outside
  // /settings (e.g. create-character) get redirected back to the right page.
  const returnUrlCookie = cookieStore.get("discord_oauth_return_url")?.value;
  cookieStore.delete("discord_oauth_return_url");
  const returnUrl = returnUrlCookie ?? "/settings";

  // Verify user is logged in
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", baseUrl));
  }

  // Check if this Discord account is already linked to another user
  const existingUser = await db.collection<User>("users").findOne({
    discordId: discordUser.id,
    _id: { $ne: new ObjectId(user.userId) },
  });

  if (existingUser) {
    return NextResponse.redirect(
      new URL(
        `/auth/discord/result?status=error&reason=already_linked&next=${encodeURIComponent(returnUrl)}`,
        baseUrl
      )
    );
  }

  // Update user with Discord info
  await db.collection<User>("users").updateOne(
    { _id: new ObjectId(user.userId) },
    {
      $set: {
        discordId: discordUser.id,
        discordUsername: discordUser.username,
        discordAvatar: discordUser.avatar ?? undefined,
        discordLinkedAt: new Date(),
      },
    }
  );

  return NextResponse.redirect(
    new URL(`/auth/discord/result?status=success&next=${encodeURIComponent(returnUrl)}`, baseUrl)
  );
}
