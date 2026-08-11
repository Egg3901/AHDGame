import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_READ_LIMITS } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { PASSWORD_RESETS_COLLECTION, type PasswordResetDoc } from "@/lib/passwordReset";

// GET /api/discord-bot/password-resets - Returns queued, undelivered, still-valid password reset links for the bot to DM.
// Auth: requireBotToken (private key only)
// Errors: 401, 429
export async function GET(request: Request) {
  try {
    // Private key only: these payloads contain live reset links.
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:password-resets-get",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const docs = await db
      .collection<PasswordResetDoc>(PASSWORD_RESETS_COLLECTION)
      .find({
        "discordDelivery.queuedAt": { $ne: null },
        "discordDelivery.deliveredAt": null,
        usedAt: null,
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: 1 })
      .limit(20)
      .toArray();

    return NextResponse.json({
      resets: docs.map((doc) => ({
        id: doc._id.toString(),
        discordId: doc.discordDelivery?.discordId,
        url: doc.discordDelivery?.url,
        expiresAt: doc.expiresAt,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

const markDeliveredSchema = z.object({
  ids: z
    .array(z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id"))
    .min(1)
    .max(20),
});

// POST /api/discord-bot/password-resets - Marks queued reset links as DM-delivered.
// Auth: requireBotToken (private key only)
// Errors: 400, 401, 429
export async function POST(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:password-resets-post",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, markDeliveredSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const result = await db.collection<PasswordResetDoc>(PASSWORD_RESETS_COLLECTION).updateMany(
      {
        _id: { $in: parsed.data.ids.map((id) => new ObjectId(id)) },
        "discordDelivery.deliveredAt": null,
      },
      { $set: { "discordDelivery.deliveredAt": new Date() } }
    );

    return NextResponse.json({ marked: result.modifiedCount });
  } catch (error) {
    return handleRouteError(error);
  }
}
