import { NextResponse } from "next/server";
import type { Document, Filter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { getTicketsCollection } from "@/lib/db/collections/tickets";
import type { Ticket } from "@/lib/db/types/ticket";

// GET /api/discord-bot/tickets/pending-resolutions — Closed tickets whose
// reporter still needs the final DM. Ops and the bot record channel delivery
// separately so the bot can also close the channel without duplicating receipts.
// Auth: requireBotToken (private key only). Errors: 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getDb();
    const coll = getTicketsCollection(db);

    // Ops writes channel delivery metadata alongside Ticket fields; keep this
    // selector local instead of widening the player ticket schema for Ops data.
    const pendingFilter = {
      status: { $in: ["resolved", "closed"] },
      "resolution.message": { $exists: true },
      "resolution.deliveredAt": null,
      $or: [
        { discordChannelId: { $in: [null, ""] } },
        { "resolution.channelDelivery.status": "posted" },
        { "statusHistory.note": "resolution-channel-delivered" },
        {
          $and: [
            { "statusHistory.note": "discord-ticket-close" },
            { $nor: [{ "statusHistory.note": "resolution-channel-delivered" }] },
          ],
        },
        {
          publicUpdates: {
            $elemMatch: {
              kind: "resolution",
              "delivery.status": { $in: ["failed", "skipped"] },
              "delivery.attempts": { $gte: 5 },
            },
          },
        },
      ],
    } as Filter<Ticket>;
    const pendingProjection = {
      _id: 0,
      ticketNumber: 1,
      discordUserId: 1,
      discordChannelId: 1,
      mergedFromUserIds: 1,
      message: "$resolution.message",
      channelUpdatePosted: {
        $or: [
          { $eq: ["$resolution.channelDelivery.status", "posted"] },
          {
            $in: ["resolution-channel-delivered", { $ifNull: ["$statusHistory.note", []] }],
          },
        ],
      },
    };

    const tickets = await coll
      .find(pendingFilter)
      .project(pendingProjection as Document)
      .limit(50)
      .toArray();

    return NextResponse.json({ tickets });
  } catch (error) {
    return handleRouteError(error);
  }
}
