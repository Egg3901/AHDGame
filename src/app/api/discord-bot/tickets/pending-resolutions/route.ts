import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { getTicketsCollection } from "@/lib/db/collections/tickets";

// GET /api/discord-bot/tickets/pending-resolutions — Legacy tickets without a
// Discord channel. Ops owns channel receipt delivery and its durable retries;
// offering those tickets to the bot would race a second, invisible DM.
// Auth: requireBotToken (private key only). Errors: 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getDb();
    const coll = getTicketsCollection(db);

    const tickets = await coll
      .find({
        status: { $in: ["resolved", "closed"] },
        "resolution.message": { $exists: true },
        "resolution.deliveredAt": null,
        $or: [{ discordChannelId: { $exists: false } }, { discordChannelId: "" }],
      })
      .project({
        _id: 0,
        ticketNumber: 1,
        discordUserId: 1,
        discordChannelId: 1,
        message: "$resolution.message",
      })
      .limit(50)
      .toArray();

    return NextResponse.json({ tickets });
  } catch (error) {
    return handleRouteError(error);
  }
}
