import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "crypto";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "jose";

/**
 * Sign in with Apple (web flow) for the site and the AHDClient phone app.
 *
 * App Store rule 4.8 requires an Apple option next to Google and Discord.
 * Apple has no client secret string: the secret is a short-lived ES256 JWT
 * signed with the Services ID key. Identity comes from the verified id_token,
 * never from the unsigned `user` form field.
 */

export const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_AUTHORIZE_URL = "https://appleid.apple.com/auth/authorize";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

export interface AppleSignInConfig {
  /** Services ID, the OAuth `client_id`. */
  clientId: string;
  teamId: string;
  keyId: string;
  /** PKCS8 PEM, or the same PEM base64 encoded. */
  privateKey: string;
  redirectUri: string;
}

/** The only return URL registered on the Services ID. */
export const APPLE_DEFAULT_REDIRECT_URI = "https://ahousedividedgame.com/api/auth/apple/callback";

/**
 * Null until APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_CLIENT_ID and
 * APPLE_PRIVATE_KEY are all set, so the feature stays dark until then.
 * APPLE_REDIRECT_URI is an optional override for non-production hosts, which
 * must also be registered on the Services ID.
 */
export function getAppleSignInConfig(): AppleSignInConfig | null {
  const clientId = process.env.APPLE_CLIENT_ID;
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const rawKey = process.env.APPLE_PRIVATE_KEY;
  const redirectUri = process.env.APPLE_REDIRECT_URI || APPLE_DEFAULT_REDIRECT_URI;
  if (!clientId || !teamId || !keyId || !rawKey) return null;
  const trimmed = rawKey.trim();
  const privateKey = trimmed.startsWith("-----BEGIN")
    ? trimmed.replace(/\\n/g, "\n")
    : Buffer.from(trimmed, "base64").toString("utf8");
  return { clientId, teamId, keyId, privateKey, redirectUri };
}

export function isAppleSignInConfigured(): boolean {
  return getAppleSignInConfig() !== null;
}

/**
 * Requesting `name email` forces `response_mode=form_post`: Apple POSTs the
 * result cross-site, so the callback bounces it to a same-site GET before it
 * reads the Lax state cookies.
 */
export function getAppleAuthorizeUrl(
  config: AppleSignInConfig,
  state: string,
  nonce: string
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    response_mode: "form_post",
    scope: "name email",
    state,
    nonce,
  });
  return `${APPLE_AUTHORIZE_URL}?${params.toString()}`;
}

/** Five-minute client secret; Apple allows up to six months, short is safer. */
export async function createAppleClientSecret(
  config: AppleSignInConfig,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<string> {
  const key = await importPKCS8(config.privateKey, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId })
    .setIssuer(config.teamId)
    .setSubject(config.clientId)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + 300)
    .sign(key);
}

export interface AppleTokenResponse {
  id_token: string;
  refresh_token?: string;
}

export async function exchangeAppleCode(
  config: AppleSignInConfig,
  code: string
): Promise<AppleTokenResponse> {
  const response = await fetch(APPLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: await createAppleClientSecret(config),
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
  });
  if (!response.ok) {
    throw new Error(`Apple token exchange failed: ${response.status}`);
  }
  const body = (await response.json()) as Partial<AppleTokenResponse>;
  if (typeof body.id_token !== "string" || body.id_token.length === 0) {
    throw new Error("Apple token exchange returned no id_token");
  }
  return {
    id_token: body.id_token,
    ...(typeof body.refresh_token === "string" && body.refresh_token.length > 0
      ? { refresh_token: body.refresh_token }
      : {}),
  };
}

export interface AppleIdentity {
  /** Stable Apple subject for this team. */
  sub: string;
  /** Present when the user granted email; may be a private relay address. */
  email: string | null;
}

const MAX_APPLE_SUB_LENGTH = 255;

/**
 * Verify signature, issuer, audience, expiry and nonce. The nonce was minted
 * at login start and held in a Lax cookie, so a code from another browser's
 * flow cannot be replayed here.
 */
export async function verifyAppleIdToken(
  config: AppleSignInConfig,
  idToken: string,
  expectedNonce: string
): Promise<AppleIdentity> {
  const { payload } = await jwtVerify(idToken, APPLE_JWKS, {
    issuer: APPLE_ISSUER,
    audience: config.clientId,
    algorithms: ["RS256"],
  });
  if (payload.nonce !== expectedNonce) {
    throw new Error("Apple id_token nonce mismatch");
  }
  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length === 0 || sub.length > MAX_APPLE_SUB_LENGTH) {
    throw new Error("Apple id_token has no usable subject");
  }
  const email =
    typeof payload.email === "string" && payload.email.length > 0 && payload.email.length <= 320
      ? payload.email
      : null;
  return { sub, email };
}

/**
 * Best effort: account deletion must revoke the Apple grant (App Store rule
 * 5.1.1(v)). A failure is logged by the caller and never blocks deletion.
 */
export async function revokeAppleRefreshToken(
  config: AppleSignInConfig,
  refreshToken: string
): Promise<boolean> {
  const response = await fetch(APPLE_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: await createAppleClientSecret(config),
      token: refreshToken,
      token_type_hint: "refresh_token",
    }),
  });
  return response.ok;
}

/**
 * The name Apple sends once, on first authorization, in the unsigned `user`
 * form field. Used only to suggest a username; never trusted for identity.
 */
export function parseAppleUserName(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048) return null;
  try {
    const parsed = JSON.parse(raw) as { name?: { firstName?: unknown; lastName?: unknown } };
    const parts = [parsed?.name?.firstName, parsed?.name?.lastName].filter(
      (part): part is string => typeof part === "string" && part.trim().length > 0
    );
    const name = parts.join(" ").trim().slice(0, 64);
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

// Refresh tokens are long-lived credentials, so they are stored sealed with a
// domain-separated key derived from AUTH_SECRET (same pattern as
// providerLinkContext). No default key: sealing throws without AUTH_SECRET.
const REFRESH_KEY_DOMAIN = "ahd-apple-refresh-token-key-v1";
const REFRESH_ENVELOPE_VERSION = "v1";

function refreshTokenKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("apple: AUTH_SECRET is not configured");
  return createHmac("sha256", secret).update(REFRESH_KEY_DOMAIN).digest();
}

export function sealAppleRefreshToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", refreshTokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [REFRESH_ENVELOPE_VERSION, iv, ciphertext, tag]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/** Null on any tampering, key change, or malformed input. */
export function openAppleRefreshToken(sealed: string | null | undefined): string | null {
  if (typeof sealed !== "string" || sealed.length === 0 || sealed.length > 8192) return null;
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== REFRESH_ENVELOPE_VERSION) return null;
  try {
    const [, iv, ciphertext, tag] = parts.map((part) => Buffer.from(part, "base64url"));
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", refreshTokenKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
