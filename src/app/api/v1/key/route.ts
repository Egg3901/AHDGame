import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitHeaders, rateLimitResponse } from "@/lib/api/rateLimit";
import { requireUserApiKey, type UserApiScope } from "@/lib/api/userApiAuth";
import { withNoStore } from "@/lib/api/withNoStore";

/**
 * Operation classes unlocked by each key scope. `read` covers every GET under
 * /api/public/v1 plus this endpoint; `transfer` and `forex` are the private
 * write endpoints. Keep in sync with the writeEndpoints list in
 * /api/public/v1/meta.
 */
const ALLOWED_OPERATIONS: Record<UserApiScope, string[]> = {
  public: ["read"],
  private: ["read", "transfer", "forex"],
};

// GET /api/v1/key — Introspect the presented X-API-Key: its scope, allowed
// operation classes, and non-secret metadata (name, prefix, usage counters).
// Auth: X-API-Key, any scope. A key can only ever describe itself; the secret
// (token/tokenHash) and other accounts' data are never returned.
// Errors: 401 missing/invalid key, 429 rate limited.
async function handleGET(request: Request) {
  try {
    const apiAuth = await requireUserApiKey(request, "public");
    if (!apiAuth.ok) {
      const status = apiAuth.reason === "insufficient_scope" ? 403 : 401;
      return NextResponse.json(
        { error: `API key ${apiAuth.reason.replace("_", " ")}` },
        { status }
      );
    }

    const rateLimit = checkRateLimit(apiAuth.ownerUserId, 30, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    // Re-read the caller's own key document for display metadata. Explicit
    // projection: tokenHash, userId internals, and rotation linkage stay out.
    const db = await getDb();
    const keyDoc = await db.collection("userApiKeys").findOne(
      { _id: new ObjectId(apiAuth.keyId), revokedAt: null },
      {
        projection: {
          name: 1,
          prefix: 1,
          createdAt: 1,
          lastUsedAt: 1,
          requestCount: 1,
          revokeAt: 1,
        },
      }
    );
    if (!keyDoc) {
      return NextResponse.json({ error: "API key invalid" }, { status: 401 });
    }

    return NextResponse.json(
      {
        success: true,
        key: {
          id: apiAuth.keyId,
          name: keyDoc.name ?? null,
          prefix: keyDoc.prefix ?? null,
          scope: apiAuth.scope,
          createdAt: keyDoc.createdAt ?? null,
          lastUsedAt: keyDoc.lastUsedAt ?? null,
          requestCount: keyDoc.requestCount ?? 0,
          // Set when a rotation grace window is running; the key stops working
          // at this time. Null means no revocation is scheduled.
          revokeAt: keyDoc.revokeAt ?? null,
        },
        ownerUserId: apiAuth.ownerUserId,
        allowedOperations: ALLOWED_OPERATIONS[apiAuth.scope],
      },
      { headers: rateLimitHeaders(rateLimit) }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export const GET = withNoStore(handleGET);
