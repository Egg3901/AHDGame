import crypto from "crypto";
import { getDb } from "@/lib/mongodb";

/** Scopes for user-facing API keys (distinct from bot keys). */
export type UserApiScope = "public" | "private";

export type UserApiKeySource = "user";

type UserApiAccessFailureReason = "missing" | "invalid" | "insufficient_scope" | "revoked";

export type UserApiAccessFailure = {
  ok: false;
  reason: UserApiAccessFailureReason;
};

export type UserApiAccessSuccess = {
  ok: true;
  scope: UserApiScope;
  keyId: string;
  ownerUserId: string;
};

export type UserApiAccessResult = UserApiAccessFailure | UserApiAccessSuccess;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generate an API key for the user-facing system.
 * Prefix distinguishes key type: ahd_pub_ for public (read-only),
 * ahd_priv_ for private (read + send funds/forex).
 */
export function generateUserApiToken(scope: UserApiScope): {
  token: string;
  tokenHash: string;
  prefix: string;
} {
  const raw = crypto.randomBytes(24).toString("base64url");
  const prefix = scope === "public" ? "ahd_pub_" : "ahd_priv_";
  const token = `${prefix}${raw}`;
  return { token, tokenHash: hashToken(token), prefix: token.slice(0, 14) };
}

/**
 * Validate an X-API-Key header against the userApiKeys collection.
 * Returns the key's scope and owner userId on success.
 */
export async function requireUserApiKey(
  request: Request,
  requiredScope: UserApiScope = "public"
): Promise<UserApiAccessResult> {
  const token = request.headers.get("X-API-Key");
  if (!token) return { ok: false as const, reason: "missing" };

  // Determine scope from prefix to do a targeted lookup
  let inferredScope: UserApiScope | null = null;
  if (token.startsWith("ahd_pub_")) {
    inferredScope = "public";
  } else if (token.startsWith("ahd_priv_")) {
    inferredScope = "private";
  } else {
    return { ok: false as const, reason: "invalid" };
  }

  const db = await getDb();
  const keyDoc = await db.collection("userApiKeys").findOne({
    tokenHash: hashToken(token),
    revokedAt: null,
    // Honor a rotation grace window: a key whose `revokeAt` is in the past is
    // treated as revoked. Missing/null `revokeAt` (the common case) still matches.
    revokeAt: { $not: { $lte: new Date() } },
  });

  if (!keyDoc) return { ok: false as const, reason: "invalid" };

  // Verify the inferred scope matches the stored scope (tamper protection)
  if (keyDoc.scope !== inferredScope) {
    return { ok: false as const, reason: "invalid" };
  }

  // Scope check: private keys satisfy both scopes; public keys only satisfy public
  if (requiredScope === "private" && keyDoc.scope !== "private") {
    return { ok: false as const, reason: "insufficient_scope" };
  }

  // Update usage stats
  await db.collection("userApiKeys").updateOne(
    { _id: keyDoc._id },
    {
      $set: { lastUsedAt: new Date(), updatedAt: new Date() },
      $inc: { requestCount: 1 },
    }
  );

  return {
    ok: true as const,
    scope: keyDoc.scope,
    keyId: String(keyDoc._id),
    ownerUserId: String(keyDoc.userId),
  };
}

/**
 * Lightweight check — does the request carry a valid user API key (any scope)?
 * Used by public API middleware as an alternative auth path.
 */
export async function validateUserApiKey(
  request: Request
): Promise<{ valid: true; ownerUserId: string; keyId: string } | { valid: false }> {
  const token = request.headers.get("X-API-Key");
  if (!token) return { valid: false };

  let inferredScope: UserApiScope | null = null;
  if (token.startsWith("ahd_pub_")) {
    inferredScope = "public";
  } else if (token.startsWith("ahd_priv_")) {
    inferredScope = "private";
  } else {
    return { valid: false };
  }

  const db = await getDb();
  const keyDoc = await db.collection("userApiKeys").findOne({
    tokenHash: hashToken(token),
    revokedAt: null,
    // Honor a rotation grace window: a key whose `revokeAt` is in the past is
    // treated as revoked. Missing/null `revokeAt` (the common case) still matches.
    revokeAt: { $not: { $lte: new Date() } },
  });

  if (!keyDoc || keyDoc.scope !== inferredScope) return { valid: false };

  // Update usage stats (background, don't await)
  void db.collection("userApiKeys").updateOne(
    { _id: keyDoc._id },
    {
      $set: { lastUsedAt: new Date(), updatedAt: new Date() },
      $inc: { requestCount: 1 },
    }
  );

  return { valid: true, ownerUserId: String(keyDoc.userId), keyId: String(keyDoc._id) };
}
