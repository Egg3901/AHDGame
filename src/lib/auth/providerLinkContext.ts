import { createHmac, timingSafeEqual } from "crypto";

/**
 * Start-to-callback binding for provider link flows (Google/Discord).
 *
 * A link flow spans an external OAuth round-trip. The session check at link
 * start is stale by the time the callback runs: the browser account may have
 * changed (A starts, B finishes) or the session may have rotated. Checking
 * only the *current* session at callback would then link the provider to the
 * wrong account. This module seals the initiating binding (canonical userId
 * plus the verified session iat, provider, and CSRF state) into a short-lived
 * opaque cookie envelope at link start; the callback verifies the current
 * session still matches that binding before any link write.
 *
 * Deliberately NOT a JWT: the envelope is `v1.<payload>.<sig>`, signed with a
 * domain-separated HMAC key derived from AUTH_SECRET. The game
 * AUTH_COOKIE verifier (HS256 `jwtVerify` + `userPayloadSchema`) cannot parse
 * or accept it, so a link-context value is never interchangeable with a
 * session token. There is no default secret: sealing and verification throw
 * when AUTH_SECRET is missing so link start fails closed.
 */

export type ProviderLinkProvider = "google" | "discord";

export const PROVIDER_LINK_CONTEXT_TTL_SECONDS = 600;

/**
 * Upper bounds so envelope parsing never allocates on unbounded input.
 * Cookies already cap near 4KB; these sit well under that while far above
 * real values (24-char canonical account id, 64-char CSRF state).
 */
export const MAX_PROVIDER_LINK_USER_ID_LENGTH = 256;
export const MAX_PROVIDER_LINK_STATE_LENGTH = 1024;

export const GOOGLE_PROVIDER_LINK_CONTEXT_COOKIE = "google_oauth_link_ctx";
export const DISCORD_PROVIDER_LINK_CONTEXT_COOKIE = "discord_oauth_link_ctx";

/** Cookie name carrying the link-intent envelope for a provider. */
export function providerLinkContextCookieName(provider: ProviderLinkProvider): string {
  return provider === "google"
    ? GOOGLE_PROVIDER_LINK_CONTEXT_COOKIE
    : DISCORD_PROVIDER_LINK_CONTEXT_COOKIE;
}

const KEY_DOMAIN = "ahd-provider-link-context-key-v1";
const ENVELOPE_DOMAIN = "ahd-provider-link-v1";
const ENVELOPE_VERSION = "v1";

/** Domain-separated HMAC key. Never the raw AUTH_SECRET, never a default. */
function getLinkContextKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("providerLinkContext: AUTH_SECRET is not configured");
  }
  return createHmac("sha256", secret).update(KEY_DOMAIN).digest();
}

export interface LinkContextSealInput {
  provider: ProviderLinkProvider;
  /** Canonical account id that started the link flow. */
  userId: string;
  /** Verified `iat` (seconds) of the session that started the link flow. */
  iat: number;
  /** The CSRF state issued for this OAuth round-trip. */
  state: string;
}

interface SealOptions {
  nowMs?: number;
  ttlSeconds?: number;
}

function base64UrlEncode(raw: Buffer | string): string {
  return Buffer.from(typeof raw === "string" ? raw : raw).toString("base64url");
}

function base64UrlDecode(segment: string): Buffer {
  if (!segment) throw new Error("empty segment");
  return Buffer.from(segment, "base64url");
}

/**
 * Seal a link-intent envelope. Throws when AUTH_SECRET is missing or the
 * binding fields are malformed, so link start fails closed.
 */
export function sealProviderLinkContext(
  input: LinkContextSealInput,
  options: SealOptions = {}
): string {
  if (input.provider !== "google" && input.provider !== "discord") {
    throw new Error("providerLinkContext: unknown provider");
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    throw new Error("providerLinkContext: userId is required");
  }
  if (!Number.isSafeInteger(input.iat) || input.iat < 0) {
    throw new Error("providerLinkContext: session iat is required");
  }
  if (typeof input.state !== "string" || input.state.length === 0) {
    throw new Error("providerLinkContext: state is required");
  }
  if (input.userId.length > MAX_PROVIDER_LINK_USER_ID_LENGTH) {
    throw new Error("providerLinkContext: userId is too long");
  }
  if (input.state.length > MAX_PROVIDER_LINK_STATE_LENGTH) {
    throw new Error("providerLinkContext: state is too long");
  }
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) {
    throw new Error("providerLinkContext: clock is unavailable");
  }
  const ttlSeconds = options.ttlSeconds ?? PROVIDER_LINK_CONTEXT_TTL_SECONDS;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("providerLinkContext: ttl must be a positive integer");
  }
  const payload = {
    v: 1,
    provider: input.provider,
    userId: input.userId,
    iat: input.iat,
    state: input.state,
    exp: Math.floor(nowMs / 1000) + ttlSeconds,
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = createHmac("sha256", getLinkContextKey())
    .update(`${ENVELOPE_DOMAIN}.${body}`)
    .digest();
  return `${ENVELOPE_VERSION}.${body}.${base64UrlEncode(sig)}`;
}

export type LinkContextFailure =
  | "missing"
  | "malformed"
  | "expired"
  | "wrong_provider"
  | "wrong_state"
  | "account_mismatch"
  | "session_mismatch";

export type LinkContextExpected = LinkContextSealInput;

export type LinkContextResult = { ok: true } | { ok: false; reason: LinkContextFailure };

/**
 * Verify a link-intent envelope against the current callback binding.
 * Fails closed on every mismatch: the caller must not write on `{ ok: false }`.
 */
export function verifyProviderLinkContext(
  token: string | null | undefined,
  expected: LinkContextExpected,
  options: { nowMs?: number } = {}
): LinkContextResult {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "missing" };
  }
  // Bound the parse input first: real envelopes are under 1KB.
  if (token.length > 8192) {
    return { ok: false, reason: "malformed" };
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== ENVELOPE_VERSION) {
    return { ok: false, reason: "malformed" };
  }
  const [, body, sigSegment] = parts;
  let receivedSig: Buffer;
  let payload: unknown;
  try {
    receivedSig = base64UrlDecode(sigSegment);
    payload = JSON.parse(base64UrlDecode(body).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  let expectedSig: Buffer;
  try {
    expectedSig = createHmac("sha256", getLinkContextKey())
      .update(`${ENVELOPE_DOMAIN}.${body}`)
      .digest();
  } catch {
    // No signing key available: cannot authenticate anything.
    return { ok: false, reason: "malformed" };
  }
  if (receivedSig.length !== expectedSig.length || !timingSafeEqual(receivedSig, expectedSig)) {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as { v?: unknown }).v !== 1 ||
    typeof (payload as { provider?: unknown }).provider !== "string" ||
    typeof (payload as { userId?: unknown }).userId !== "string" ||
    !Number.isSafeInteger((payload as { iat?: unknown }).iat) ||
    typeof (payload as { state?: unknown }).state !== "string" ||
    !Number.isSafeInteger((payload as { exp?: unknown }).exp)
  ) {
    return { ok: false, reason: "malformed" };
  }
  const parsed = payload as {
    provider: string;
    userId: string;
    iat: number;
    state: string;
    exp: number;
  };
  if (
    parsed.userId.length > MAX_PROVIDER_LINK_USER_ID_LENGTH ||
    parsed.state.length > MAX_PROVIDER_LINK_STATE_LENGTH
  ) {
    return { ok: false, reason: "malformed" };
  }
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs) || parsed.exp <= Math.floor(nowMs / 1000)) {
    return { ok: false, reason: "expired" };
  }
  if (parsed.provider !== expected.provider) {
    return { ok: false, reason: "wrong_provider" };
  }
  if (parsed.state !== expected.state) {
    return { ok: false, reason: "wrong_state" };
  }
  if (parsed.userId !== expected.userId) {
    return { ok: false, reason: "account_mismatch" };
  }
  if (parsed.iat !== expected.iat) {
    return { ok: false, reason: "session_mismatch" };
  }
  return { ok: true };
}
