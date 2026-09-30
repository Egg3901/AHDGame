import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { randomBytes, randomUUID } from "crypto";
import { SignJWT } from "jose";
import { getDb } from "@/lib/mongodb";
import { recordIdentitySignals } from "@/lib/identityHistory/recordObservation";
import {
  getAuthUser,
  getJwtSecret,
  getAuthCookieOptions,
  getTrackingCookieOptions,
  verifyAuth,
} from "@/lib/auth"; // Optional auth: link mode needs the current session, login mode does not
import { credentialSessionIsCurrent } from "@/lib/auth/credentialSession";
import { invalidateCachedUser } from "@/lib/auth/userDocCache";
import {
  decideProviderLink,
  providerWriteSnapshotFilter,
} from "@/lib/auth/providerCredentialWrite";
import {
  providerLinkContextCookieName,
  verifyProviderLinkContext,
} from "@/lib/auth/providerLinkContext";
import { needsCharacterHint } from "@/lib/auth/characterGate";
import { setCharacterGateCookie } from "@/lib/auth/characterGateCookie";
import { AUTH_COOKIE_NAME } from "@/lib/authCookieName";
import {
  exchangeAppleCode,
  getAppleSignInConfig,
  parseAppleUserName,
  sealAppleRefreshToken,
  verifyAppleIdToken,
  type AppleIdentity,
} from "@/lib/apple";
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
import type { GameConfig, User } from "@/lib/db/types";
import { AUTH_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { normalizeMaintenanceMode } from "@/lib/maintenanceStatus";
import { lakesideAccountFields } from "@/lib/auth/lakesideAccount";
import {
  APPLE_OAUTH_RETURN_URL_COOKIE,
  loginDestination,
  takeOAuthReturnUrlCookie,
} from "@/lib/auth/lakesideLoginReturn";
import { resolveReauthIssuedAt } from "@/lib/auth/sessionIssue";
import { authMigrationFenceAbsentFilter, isAuthMigrationFenced } from "@/lib/auth/sourceFence";

type Db = Awaited<ReturnType<typeof getDb>>;
type CookieStore = Awaited<ReturnType<typeof cookies>>;

interface AppleSignIn extends AppleIdentity {
  /** Display name Apple sent on first authorization only. */
  name: string | null;
  /** Sealed refresh token, when Apple issued one. */
  sealedRefreshToken: string | null;
}

const CALLBACK_PATH = "/api/auth/apple/callback";
const MAX_PARAM_LENGTH = 4096;

function boundedField(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_PARAM_LENGTH
    ? value
    : null;
}

// POST /api/auth/apple/callback — Receives Apple's form_post and bounces it to the GET handler.
// Auth: public
// Errors: (none; every outcome is a redirect)
// Apple POSTs cross-site, so Lax state cookies are not sent with this request.
// A 303 turns it into a top-level same-site GET, which does carry them. No
// state is read or written here.
export async function POST(request: Request) {
  const baseUrl = getBaseUrl(request);
  const target = new URL(CALLBACK_PATH, baseUrl);
  try {
    const form = await request.formData();
    const code = boundedField(form.get("code"));
    const state = boundedField(form.get("state"));
    const error = boundedField(form.get("error"));
    const name = parseAppleUserName(boundedField(form.get("user")));
    if (code) target.searchParams.set("code", code);
    if (state) target.searchParams.set("state", state);
    if (error) target.searchParams.set("error", error);
    if (name) target.searchParams.set("name", name);
  } catch {
    target.searchParams.set("error", "invalid_request");
  }
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

// GET /api/auth/apple/callback — Completes Sign in with Apple: log in, register, or link.
// Auth: public
// Errors: 429
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const name = url.searchParams.get("name")?.slice(0, 64) || null;

  const baseUrl = getBaseUrl(request);
  const clientIp = await getClientIp();
  const limit = checkRateLimit(clientIp, AUTH_LIMITS.maxRequests, AUTH_LIMITS.windowMs);
  if (!limit.ok) {
    const limited = rateLimitResponse(limit.retryAfter);
    limited.headers.set("Cache-Control", "no-store");
    return limited;
  }

  const cookieStore = await cookies();
  const mode = cookieStore.get("apple_oauth_mode")?.value ?? "link";
  cookieStore.delete("apple_oauth_mode");
  const storedNonce = cookieStore.get("apple_oauth_nonce")?.value;
  cookieStore.delete("apple_oauth_nonce");

  const isLoginMode = mode === "login";
  const defaultNext = isLoginMode ? "/login" : "/settings";

  const resultRedirect = (status: string, reason?: string) =>
    appleResult(baseUrl, status, defaultNext, reason);

  if (error) {
    return resultRedirect(
      "error",
      error === "user_cancelled_authorize" ? "access_denied" : "exchange_failed"
    );
  }
  if (!code || !state) {
    return resultRedirect("error", "missing_params");
  }

  const storedState = cookieStore.get("apple_oauth_state")?.value;
  if (!storedState || storedState !== state || !storedNonce) {
    return resultRedirect("error", "invalid_state");
  }
  cookieStore.delete("apple_oauth_state");

  const config = getAppleSignInConfig();
  if (!config) {
    return resultRedirect("error", "not_configured");
  }

  try {
    const tokens = await exchangeAppleCode(config, code);
    const identity = await verifyAppleIdToken(config, tokens.id_token, storedNonce);
    const apple: AppleSignIn = {
      ...identity,
      name,
      sealedRefreshToken: tokens.refresh_token ? sealAppleRefreshToken(tokens.refresh_token) : null,
    };

    const db = await getDb();
    if (isLoginMode) {
      const userAgent = request.headers.get("user-agent");
      const cf = getCfFingerprint(request.headers);
      return await handleAppleLogin(db, apple, cookieStore, baseUrl, userAgent, cf);
    }
    return await handleAppleLink(db, apple, cookieStore, baseUrl, state);
  } catch (err) {
    if (isLoginMode) console.error("Apple sign-in error:", err);
    else console.error("Apple account link is temporarily unavailable");
    return resultRedirect("error", "exchange_failed");
  }
}

function appleResult(baseUrl: string, status: string, next: string, reason?: string) {
  const params = new URLSearchParams({ status, next });
  if (reason) params.set("reason", reason);
  const response = NextResponse.redirect(new URL(`/auth/apple/result?${params}`, baseUrl));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** Username seed: Apple's name when shared, else a neutral base. */
function baseUsernameFor(name: string | null): string {
  return (
    (name ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 16) || "player"
  );
}

async function handleAppleLogin(
  db: Db,
  apple: AppleSignIn,
  cookieStore: CookieStore,
  baseUrl: string,
  userAgent: string | null,
  cf: CfFingerprint
) {
  const usersCollection = db.collection<User>("users");
  const existingUser = await usersCollection.findOne({ appleId: apple.sub });

  if (existingUser) {
    if (existingUser.isBanned) {
      const reason = encodeURIComponent(existingUser.banReason || "Violation of rules");
      return NextResponse.redirect(new URL(`/banned?reason=${reason}`, baseUrl));
    }
    // Fenced accounts never log in via legacy OAuth. Same session_expired
    // redirect as a revocation race so fenced is not an oracle, and it returns
    // before registration so a fenced alias never becomes a duplicate account.
    if (isAuthMigrationFenced(existingUser)) {
      return appleResult(baseUrl, "error", "/login", "session_expired");
    }

    const existingTrack = cookieStore.get("__ahd_track")?.value;
    const trackingId = existingTrack || randomUUID();
    const oauthDeviceKey = cookieStore.get(OAUTH_DEVICE_KEY_COOKIE)?.value;
    cookieStore.delete(OAUTH_DEVICE_KEY_COOKIE);

    const clientIp = await getClientIp();
    const device = classifyDevice(userAgent);
    const observedAt = new Date();
    const issued = await resolveReauthIssuedAt(existingUser.authRevokedAt);
    if (!issued.ok) {
      return appleResult(baseUrl, "error", "/login", "session_expired");
    }
    const token = await new SignJWT({
      userId: existingUser._id.toString(),
      email: existingUser.email,
      username: existingUser.username,
      role: existingUser.role,
      isAdmin: existingUser.isAdmin || false,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(issued.iat)
      .setExpirationTime("7d")
      .sign(getJwtSecret());

    const updateResult = await usersCollection.updateOne(
      {
        _id: existingUser._id,
        isBanned: { $ne: true },
        appleId: apple.sub,
        ...issued.snapshotFilter,
        ...authMigrationFenceAbsentFilter(),
      },
      {
        $set: {
          lastLogin: observedAt,
          lastKnownIp: clientIp,
          lastKnownIpAt: observedAt,
          lastAuthToken: token.slice(-12),
          trackingId,
          trackingIdAt: observedAt,
          lastDevice: device,
          // Apple sends email only when the user shares it; keep the last known one otherwise.
          ...(apple.email ? { appleEmail: apple.email } : {}),
          ...(apple.sealedRefreshToken ? { appleRefreshToken: apple.sealedRefreshToken } : {}),
          ...(oauthDeviceKey ? { deviceKey: oauthDeviceKey, deviceKeyAt: observedAt } : {}),
          ...(isEmptyCfFingerprint(cf)
            ? {}
            : {
                lastCf: cf,
                ...(existingUser.registrationCf == null ? { registrationCf: cf } : {}),
              }),
        },
      }
    );
    if (updateResult.matchedCount !== 1) {
      return appleResult(baseUrl, "error", "/login", "session_expired");
    }

    cookieStore.set(AUTH_COOKIE_NAME, token, await getAuthCookieOptions());
    await setCharacterGateCookie(
      cookieStore,
      needsCharacterHint({
        role: existingUser.role,
        isAdmin: existingUser.isAdmin === true,
        hasCharacter: existingUser.hasCompletedSetup ?? true,
      })
    );
    if (!existingTrack) {
      cookieStore.set("__ahd_track", trackingId, await getTrackingCookieOptions());
    }

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

    recordIdentitySignals(db, {
      userId: existingUser._id,
      ip: clientIp,
      observedAt,
      source: "oauth",
    });

    const next = loginDestination(
      takeOAuthReturnUrlCookie(cookieStore, APPLE_OAUTH_RETURN_URL_COOKIE),
      {
        role: existingUser.role,
        isAdmin: existingUser.isAdmin === true,
        hasCompletedSetup: existingUser.hasCompletedSetup ?? true,
      }
    );
    return appleResult(baseUrl, "login_success", next);
  }

  // No existing user: register via Apple. Same maintenance and registration
  // gates as the email, Google and Discord signup paths.
  const maintConfig = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { maintenanceMode: 1 } });
  if (normalizeMaintenanceMode(maintConfig?.maintenanceMode) !== "off") {
    return appleResult(baseUrl, "error", "/maintenance", "maintenance");
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
    if (err instanceof Error && "status" in err && (err as { status: number }).status === 403) {
      return appleResult(baseUrl, "error", "/login", "registration_blocked");
    }
    throw err;
  }
  const trackingId = existingTrack || randomUUID();
  if (!existingTrack) {
    cookieStore.set("__ahd_track", trackingId, await getTrackingCookieOptions());
  }

  const baseUsername = baseUsernameFor(apple.name);
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
    username = `apple_${randomBytes(8).toString("hex")}`;
  }

  // Unique placeholder that marks an Apple-only account. The Apple subject
  // contains dots, so it is reduced to a safe local part.
  const email = `apple_${apple.sub.replace(/[^A-Za-z0-9]/g, "_").slice(0, 64)}@apple.local`;
  const displayName = apple.name ?? username;
  const newUserObservedAt = new Date();

  const result = await usersCollection.insertOne({
    email,
    username,
    displayName,
    password: "", // No password for Apple-only accounts; the login route rejects empty passwords
    role: "player",
    isAdmin: false,
    hasCompletedSetup: false,
    appleId: apple.sub,
    ...(apple.email ? { appleEmail: apple.email } : {}),
    appleLinkedAt: newUserObservedAt,
    ...(apple.sealedRefreshToken ? { appleRefreshToken: apple.sealedRefreshToken } : {}),
    registrationIp: normalizeIp(clientIp) ?? clientIp,
    lastKnownIp: clientIp,
    lastKnownIpAt: newUserObservedAt,
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
    ...lakesideAccountFields("ahd-apple"),
    createdAt: newUserObservedAt,
    updatedAt: newUserObservedAt,
  } as unknown as User);

  await createAdminLog({
    category: "account",
    action: "account_created",
    username,
    details: "Registered via Apple",
  });

  recordIdentitySignals(db, {
    userId: result.insertedId,
    ip: clientIp,
    fingerprint: oauthFingerprint,
    observedAt: newUserObservedAt,
    source: "oauth",
  });

  if (gateDecision.softAllow) {
    const sa = gateDecision.softAllow;
    await createAdminLog({
      category: "account",
      action: "cgnat_soft_allow",
      username,
      details: `Allowed despite IP collision (${sa.device}): shared IP ${sa.sharedIp} already used by ${sa.existingCount} account${sa.existingCount === 1 ? "" : "s"}.`,
    });
  }

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
      "Create your character, choose a home state, and pick a party, then start building influence. " +
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
  // Brand-new account: no character yet, so gate it into /create-character.
  await setCharacterGateCookie(cookieStore, true);

  await usersCollection.updateOne(
    { _id: result.insertedId },
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
    takeOAuthReturnUrlCookie(cookieStore, APPLE_OAUTH_RETURN_URL_COOKIE),
    { role: "player", isAdmin: false, hasCompletedSetup: false }
  );
  return appleResult(baseUrl, "login_success", next);
}

async function handleAppleLink(
  db: Db,
  apple: AppleSignIn,
  cookieStore: CookieStore,
  baseUrl: string,
  state: string
) {
  const linkError = (reason: string) => appleResult(baseUrl, "error", "/settings", reason);

  const grant = await getAuthUser();
  if (!grant) {
    return NextResponse.redirect(new URL("/login", baseUrl));
  }

  const usersCollection = db.collection<User>("users");
  // Credential writes require the uncached account state, never the cached grant.
  const account = await usersCollection.findOne({ _id: new ObjectId(grant.userId) });
  if (!account) {
    return NextResponse.redirect(new URL("/login", baseUrl));
  }
  const auth = await verifyAuth();
  if (!credentialSessionIsCurrent(grant.userId, account, auth)) {
    return NextResponse.redirect(new URL("/login", baseUrl));
  }
  if (isAuthMigrationFenced(account)) {
    return linkError("session_expired");
  }

  // The flow started by one account/session must not complete for another.
  // See the Google callback for the full reasoning.
  const linkCtxCookie = providerLinkContextCookieName("apple");
  const linkCtx = cookieStore.get(linkCtxCookie)?.value;
  cookieStore.delete(linkCtxCookie);
  if (
    !verifyProviderLinkContext(linkCtx, {
      provider: "apple",
      userId: grant.userId,
      iat: auth?.iat ?? -1,
      state,
    }).ok
  ) {
    return linkError("session_expired");
  }

  const existingUser = await usersCollection.findOne({
    appleId: apple.sub,
    _id: { $ne: new ObjectId(grant.userId) },
  });
  if (existingUser) {
    return linkError("already_linked");
  }

  // Never silently replace a different existing Apple link.
  const link = decideProviderLink(account, "apple", apple.sub);
  if (!link.ok) {
    return linkError("already_linked");
  }
  if (link.mode === "idempotent") {
    return appleResult(baseUrl, "success", "/settings");
  }

  const cacheKey = account._id.toHexString();
  invalidateCachedUser(cacheKey);
  const linkedAt = new Date();
  let write;
  try {
    write = await usersCollection.updateOne(
      {
        _id: new ObjectId(grant.userId),
        ...providerWriteSnapshotFilter(account),
      },
      {
        $set: {
          appleId: apple.sub,
          ...(apple.email ? { appleEmail: apple.email } : {}),
          appleLinkedAt: linkedAt,
          ...(apple.sealedRefreshToken ? { appleRefreshToken: apple.sealedRefreshToken } : {}),
        },
        // The credential relationship changed: revoke existing sessions so
        // the caller reauthenticates before further credential writes.
        $max: { authRevokedAt: linkedAt },
      }
    );
  } catch {
    return linkError("exchange_failed");
  } finally {
    invalidateCachedUser(cacheKey);
  }
  if (write.acknowledged !== true) {
    return linkError("exchange_failed");
  }
  if (write.matchedCount !== 1) {
    return linkError("session_expired");
  }

  return appleResult(baseUrl, "success", "/settings");
}
