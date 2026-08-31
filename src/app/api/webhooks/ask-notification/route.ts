import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAskToken } from "@/lib/api/requireAskToken";
import { BOT_READ_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import type { User } from "@/lib/db/types";

// POST /api/webhooks/ask-notification
// The Ask service (ask.lakesidegames.net) pushes player notifications here:
// a question credited back after a quality check flagged its answer, an
// answer that staff corrected, or a watch the player set firing. Each event
// names its player by AHD userId (web sessions) or by linked discordId
// (Discord /ask users).
//
// Auth: Authorization: Bearer $ASK_S2S_TOKEN (requireAskToken).
//
// Results are positional per event: { ok: true } delivered, or
// { error: "unknown_user" } when no account matches, which the sender treats
// as permanent and retires. Unknown users are expected (Discord askers who
// never linked an account) and are not an error at the batch level.
//
// Errors: 400, 401, 429.

const ASK_ORIGIN = "https://ask.lakesidegames.net";

const eventSchema = z
  .object({
    userId: z
      .string()
      .regex(/^[0-9a-f]{24}$/i)
      .optional(),
    discordId: z.string().min(1).max(64).optional(),
    kind: z.enum(["ask_refund", "ask_correction", "ask_watch"]),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(2000),
    url: z.string().max(300).optional(),
  })
  .refine((event) => event.userId || event.discordId, {
    message: "each event needs a userId or a discordId",
  });

const schema = z.object({ events: z.array(eventSchema).min(1).max(20) });

export async function POST(request: Request) {
  try {
    if (!requireAskToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const rateLimit = checkRateLimit(
      "webhooks:ask-notification",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const users = db.collection<User>("users");
    const results: Array<{ ok: true } | { error: "unknown_user" }> = [];
    const notifications: NotificationInput[] = [];

    for (const event of parsed.data.events) {
      const user = event.userId
        ? await users.findOne({ _id: new ObjectId(event.userId) }, { projection: { _id: 1 } })
        : await users.findOne({ discordId: event.discordId }, { projection: { _id: 1 } });
      if (!user) {
        results.push({ error: "unknown_user" });
        continue;
      }
      // Only the Ask site may be linked from these notifications.
      const href = event.url && event.url.startsWith(ASK_ORIGIN) ? event.url : ASK_ORIGIN;
      notifications.push({
        userId: user._id,
        type: event.kind,
        title: event.title,
        message: event.body,
        metadata: { href, source: "ask" },
      });
      results.push({ ok: true });
    }

    if (notifications.length > 0) await createNotifications(notifications);

    return NextResponse.json({ results });
  } catch (error) {
    return handleRouteError(error);
  }
}
