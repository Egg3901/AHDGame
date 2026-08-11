import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { getTicketsCollection } from "@/lib/db/collections/tickets";

// GET /api/discord-bot/tickets/pending-resolutions — Closed tickets that carry a
// resolution message the bot has not yet delivered back to the reporter.
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
        status: "closed",
        "resolution.message": { $exists: true },
        "resolution.deliveredAt": null,
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
