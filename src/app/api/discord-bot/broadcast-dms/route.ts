import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_READ_LIMITS } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { BROADCAST_DMS_COLLECTION, type BroadcastDmDoc } from "@/lib/broadcastDms";

// GET /api/discord-bot/broadcast-dms - Returns queued, unsent broadcast DMs for the bot to deliver.
// Auth: requireBotToken (private key only)
// Errors: 401, 429
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:broadcast-dms-get",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const docs = await db
      .collection<BroadcastDmDoc>(BROADCAST_DMS_COLLECTION)
      .find({
        deliveredAt: null,
        $or: [{ failedAt: null }, { failedAt: { $exists: false } }],
      })
      .sort({ queuedAt: 1 })
      .limit(25)
      .toArray();

    return NextResponse.json({
      dms: docs.map((doc) => ({
        id: doc._id.toString(),
        discordId: doc.discordId,
        title: doc.title,
        body: doc.body,
        imageUrl: doc.imageUrl ?? null,
        url: doc.url ?? null,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

const idArraySchema = z.array(z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id")).max(25);

const markSchema = z
  .object({
    delivered: idArraySchema.optional(),
    failed: idArraySchema.optional(),
  })
  .refine((data) => (data.delivered?.length ?? 0) + (data.failed?.length ?? 0) > 0, {
    message: "At least one of delivered or failed must be non-empty",
  });

// POST /api/discord-bot/broadcast-dms - Marks queued broadcast DMs as delivered or failed.
// Auth: requireBotToken (private key only)
// Errors: 400, 401, 429
export async function POST(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:broadcast-dms-post",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, markSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const collection = db.collection<BroadcastDmDoc>(BROADCAST_DMS_COLLECTION);
    const now = new Date();
    let marked = 0;

    const deliveredIds = parsed.data.delivered ?? [];
    if (deliveredIds.length > 0) {
      const result = await collection.updateMany(
        { _id: { $in: deliveredIds.map((id) => new ObjectId(id)) }, deliveredAt: null },
        { $set: { deliveredAt: now } }
      );
      marked += result.modifiedCount;
    }

    const failedIds = parsed.data.failed ?? [];
    if (failedIds.length > 0) {
      const result = await collection.updateMany(
        { _id: { $in: failedIds.map((id) => new ObjectId(id)) }, deliveredAt: null },
        { $set: { failedAt: now } }
      );
      marked += result.modifiedCount;
    }

    return NextResponse.json({ marked });
  } catch (error) {
    return handleRouteError(error);
  }
}
