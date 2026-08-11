import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { durableRateLimit } from "@/lib/api/rateLimit.mongo";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { generateUserApiToken, type UserApiScope } from "@/lib/api/userApiAuth";
import { getDb } from "@/lib/mongodb";

const createUserApiKeySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Name must be at most 80 characters"),
  scope: z.enum(["public", "private"]),
});

const revokeUserApiKeySchema = z.object({
  keyId: schemas.objectId,
});

// GET /api/settings/user-api-keys — List the authenticated user's API keys.
export async function GET() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const keys = await db
      .collection("userApiKeys")
      .find({ userId: new ObjectId(auth.user.userId), revokedAt: null })
      .project({ tokenHash: 0 })
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json({ keys });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/settings/user-api-keys — Create a new API key for the authenticated user.
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = await durableRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, createUserApiKeySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const scope: UserApiScope = parsed.data.scope;
    const { token, tokenHash, prefix } = generateUserApiToken(scope);

    const db = await getDb();

    // Limit to 3 active keys per user per scope
    const activeCount = await db.collection("userApiKeys").countDocuments({
      userId: new ObjectId(auth.user.userId),
      scope,
      revokedAt: null,
    });
    if (activeCount >= 3) {
      return NextResponse.json(
        { error: `You can have at most 3 active ${scope} keys. Revoke one first.` },
        { status: 400 }
      );
    }

    await db.collection("userApiKeys").insertOne({
      userId: new ObjectId(auth.user.userId),
      name: parsed.data.name,
      scope,
      prefix,
      tokenHash,
      requestCount: 0,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return NextResponse.json({ token, scope });
  } catch (error) {
    return handleRouteError(error);
  }
}

// DELETE /api/settings/user-api-keys — Revoke an API key owned by the authenticated user.
export async function DELETE(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, revokeUserApiKeySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    await db.collection("userApiKeys").updateOne(
      {
        _id: new ObjectId(parsed.data.keyId),
        userId: new ObjectId(auth.user.userId),
        revokedAt: null,
      },
      { $set: { revokedAt: new Date(), updatedAt: new Date() } }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
