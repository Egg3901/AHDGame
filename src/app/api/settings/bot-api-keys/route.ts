import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { generateBotApiToken } from "@/lib/api/botApiAuth";
import { getDb } from "@/lib/mongodb";

const createBotApiKeySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Name must be at most 80 characters"),
  scope: z.enum(["campaign", "full"]),
});

const revokeBotApiKeySchema = z.object({
  keyId: schemas.objectId,
});

// GET /api/settings/bot-api-keys - Lists the authenticated user's active bot API keys.
// Auth: requireBasicAuth
// Errors: 401
export async function GET() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const keys = await db
      .collection("botApiKeys")
      .find({ userId: new ObjectId(auth.user.userId), revokedAt: null })
      .project({ tokenHash: 0 })
      .sort({ createdAt: -1 })
      .toArray();
    return NextResponse.json({ keys });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/settings/bot-api-keys - Creates a new bot API key for the authenticated user.
// Auth: requireBasicAuth
// Errors: 400, 401, 429
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, createBotApiKeySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { token, tokenHash, prefix } = generateBotApiToken();
    const db = await getDb();
    await db.collection("botApiKeys").insertOne({
      userId: new ObjectId(auth.user.userId),
      name: parsed.data.name,
      scope: parsed.data.scope,
      prefix,
      tokenHash,
      requestCount: 0,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return NextResponse.json({ token });
  } catch (error) {
    return handleRouteError(error);
  }
}

// DELETE /api/settings/bot-api-keys - Revokes one bot API key owned by the authenticated user.
// Auth: requireBasicAuth
// Errors: 400, 401, 429
export async function DELETE(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, revokeBotApiKeySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    await db.collection("botApiKeys").updateOne(
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
