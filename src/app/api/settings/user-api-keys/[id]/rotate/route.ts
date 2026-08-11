import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { generateUserApiToken, type UserApiScope } from "@/lib/api/userApiAuth";
import { getDb } from "@/lib/mongodb";

/** Old key stays valid for this long after rotation, so callers can swap over. */
const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

// POST /api/settings/user-api-keys/[id]/rotate
// Issues a fresh token for the same scope/name and schedules the old key to be
// revoked after a grace window. The new token is returned once and never again.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid key id" }, { status: 400 });
    }

    const db = await getDb();
    const now = new Date();

    // Only the owner can rotate, and only a key that is currently active.
    const existing = await db.collection("userApiKeys").findOne({
      _id: new ObjectId(id),
      userId: new ObjectId(auth.user.userId),
      revokedAt: null,
      revokeAt: { $not: { $lte: now } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Key not found or already revoked" }, { status: 404 });
    }

    const scope: UserApiScope = existing.scope;
    const { token, tokenHash, prefix } = generateUserApiToken(scope);
    const revokeAt = new Date(now.getTime() + ROTATION_GRACE_MS);

    // Insert the replacement key, linked back to the one it rotates.
    const inserted = await db.collection("userApiKeys").insertOne({
      userId: new ObjectId(auth.user.userId),
      name: existing.name,
      scope,
      prefix,
      tokenHash,
      requestCount: 0,
      lastUsedAt: null,
      revokedAt: null,
      revokeAt: null,
      rotatedFrom: existing._id,
      createdAt: now,
      updatedAt: now,
    });

    // Schedule the old key for revocation after the grace window. Re-scope the
    // update to the owner so a leaked id cannot retire someone else's key.
    await db
      .collection("userApiKeys")
      .updateOne(
        { _id: existing._id, userId: new ObjectId(auth.user.userId) },
        { $set: { revokeAt, rotatedAt: now, rotatedTo: inserted.insertedId, updatedAt: now } }
      );

    return NextResponse.json({
      token,
      scope,
      gracePeriodEndsAt: revokeAt.toISOString(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
