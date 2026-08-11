import { NextResponse } from "next/server";
import { ObjectId, type Filter } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { getNextTicketNumber } from "@/lib/ticketCounter";
import { getTicketsCollection } from "@/lib/db/collections/tickets";
import { buildCharacterHref } from "@/lib/utils/profileUrls";
import type { Ticket, TicketMessage } from "@/lib/db/types/ticket";
import type { Character, Corporation, User } from "@/lib/db/types";

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com").replace(
  /\/$/,
  ""
);

/**
 * Resolve game-side context (profile link + corporation) for a linked user.
 * Best-effort: any missing piece is simply omitted. Returns `undefined` when
 * there's nothing useful to attach.
 */
async function resolveReporter(
  db: Awaited<ReturnType<typeof getDb>>,
  userId: ObjectId,
  username?: string | null
): Promise<Ticket["reporter"] | undefined> {
  const reporter: NonNullable<Ticket["reporter"]> = {};
  if (username) reporter.username = username;

  // Both lookups key off the same userId and are independent — run them together.
  const [character, corp] = await Promise.all([
    db
      .collection<Character>("characters")
      .findOne({ userId }, { projection: { _id: 1, name: 1, sequentialId: 1 } }),
    db
      .collection<Corporation>("corporations")
      .findOne({ userId }, { projection: { _id: 1, name: 1, tickerSymbol: 1, sequentialId: 1 } }),
  ]);

  if (character) {
    reporter.characterName = character.name;
    reporter.profileUrl = `${BASE_URL}${buildCharacterHref(character)}`;
  }

  if (corp) {
    reporter.corporationName = corp.name;
    if (corp.tickerSymbol) reporter.corporationTicker = corp.tickerSymbol;
    reporter.corporationUrl = `${BASE_URL}/corporation/${corp.sequentialId ?? corp._id.toString()}`;
  }

  return Object.keys(reporter).length ? reporter : undefined;
}

/**
 * Hold window before the read-only audit worker is allowed to review a ticket.
 * Bug reports often need the user to attach screenshots / repro steps right
 * after opening, so we wait to capture follow-ups before triaging.
 */
const REVIEW_HOLD_MS = 5 * 60_000;

const messageSchema = z.object({
  discordMessageId: z.string().max(64).optional(),
  authorId: z.string().max(64).optional(),
  authorName: z.string().max(128).optional(),
  content: z.string().max(5000).default(""),
  imageUrls: z.array(z.string().url()).max(20).optional(),
  createdAt: z.string().datetime().optional(),
});

/** Ticket status enum — shared by the create (backfill) and update schemas. */
const ticketStatusEnum = z.enum([
  "open",
  "triaging",
  "assessed",
  "in_progress",
  "resolved",
  "closed",
  "wont_fix",
]);

const createSchema = z.object({
  category: z.enum(["bug", "moderation", "account", "gameplay", "other"]),
  // .trim() before .min(1) so whitespace-only titles/descriptions are rejected.
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  discordChannelId: z.string().max(64).optional(),
  discordUserId: z.string().max(64).optional(),
  discordUsername: z.string().max(64).optional(),
  discordDisplayName: z.string().max(128).optional(),
  imageUrls: z.array(z.string().url()).max(20).optional(),
  /** Initial message snapshot (defaults to the description if omitted). */
  message: messageSchema.optional(),
  // --- Backfill-only fields (omitted for normal live ticket creation) ---
  /** Preserve the bot's original ticket number instead of auto-numbering. */
  ticketNumber: z.number().int().positive().optional(),
  /** Original open time; drives createdAt + reviewAfter on backfilled tickets. */
  createdAt: z.string().datetime().optional(),
  /** Original status; defaults to "open" for live tickets. */
  status: ticketStatusEnum.optional(),
});

// Identify the ticket by its number or by the Discord channel it lives in —
// shared across all PATCH actions.
const ticketIdFields = {
  ticketNumber: z.number().int().positive().optional(),
  discordChannelId: z.string().max(64).optional(),
};

// Discriminated on `action` so each variant only accepts (and requires) the
// fields it actually uses — no runtime-only validation, no non-null assertions.
const updateSchema = z
  .discriminatedUnion("action", [
    z.object({ action: z.literal("append"), ...ticketIdFields, message: messageSchema }),
    z.object({
      action: z.literal("status"),
      ...ticketIdFields,
      status: ticketStatusEnum,
    }),
    z.object({
      action: z.literal("close"),
      ...ticketIdFields,
      closedBy: z.string().max(128).optional(),
      /** Optional resolution message to deliver back to the reporter. */
      resolution: z.string().max(5000).optional(),
    }),
    z.object({ action: z.literal("retriage"), ...ticketIdFields }),
    z.object({ action: z.literal("resolution-delivered"), ...ticketIdFields }),
  ])
  .refine((d) => d.ticketNumber != null || d.discordChannelId, {
    message: "ticketNumber or discordChannelId is required",
  });

function toMessage(
  m: z.infer<typeof messageSchema> | undefined,
  fallback: { content: string; authorId?: string; authorName?: string; imageUrls?: string[] }
): TicketMessage {
  const authorId = m?.authorId ?? fallback.authorId;
  const authorName = m?.authorName ?? fallback.authorName;
  const imageUrls = m?.imageUrls ?? fallback.imageUrls;
  // Spread optionals conditionally so we never persist `undefined` BSON fields.
  return {
    ...(m?.discordMessageId ? { discordMessageId: m.discordMessageId } : {}),
    ...(authorId ? { authorId } : {}),
    ...(authorName ? { authorName } : {}),
    content: (m?.content || fallback.content || "").slice(0, 5000),
    ...(imageUrls && imageUrls.length ? { imageUrls: imageUrls.slice(0, 20) } : {}),
    createdAt: m?.createdAt ? new Date(m.createdAt) : new Date(),
  };
}

// POST /api/discord-bot/tickets — Open a support ticket from the Discord `/ticket` flow.
// Auth: requireBotToken (private key only). Errors: 400, 401, 429
export async function POST(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = await parseJsonBody(request, createSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;

    // Backfill requests carry an explicit ticketNumber; they're bot-authored
    // imports of historical tickets, so they bypass the live-submission rate
    // limit (which would otherwise block a bulk re-run).
    const isBackfill = body.ticketNumber != null;
    if (!isBackfill) {
      const rateKey = body.discordUserId
        ? `discord-ticket:${body.discordUserId}`
        : "discord-ticket:anon";
      const rateLimit = checkRateLimit(rateKey, 3, 5 * 60_000);
      if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    }

    const db = await getDb();
    const coll = getTicketsCollection(db);

    // Idempotency: if a ticket already exists for the provided number or Discord
    // channel, return it without inserting. This makes a backfill safe to re-run
    // and dedupes accidental double-submits of the same channel.
    const dedupeOr: Filter<Ticket>[] = [];
    if (body.ticketNumber != null) dedupeOr.push({ ticketNumber: body.ticketNumber });
    if (body.discordChannelId) dedupeOr.push({ discordChannelId: body.discordChannelId });
    if (dedupeOr.length) {
      const existing = await coll.findOne(
        { $or: dedupeOr },
        { projection: { _id: 1, ticketNumber: 1 } }
      );
      if (existing) {
        return NextResponse.json({
          id: existing._id.toString(),
          ticketNumber: existing.ticketNumber,
          alreadyExists: true,
        });
      }
    }

    // Resolve a linked game account (if any) for richer context.
    let userId: ObjectId | null = null;
    let reporter: Ticket["reporter"] | undefined;
    if (body.discordUserId) {
      const user = await db
        .collection<User>("users")
        .findOne({ discordId: body.discordUserId }, { projection: { _id: 1, username: 1 } });
      if (user) {
        userId = user._id;
        reporter = await resolveReporter(db, user._id, user.username);
      }
    }

    // Backfill preserves the original number; live tickets auto-number. The
    // counter seeds from the current max, so it still advances past any
    // backfilled max for subsequent live tickets.
    const ticketNumber = body.ticketNumber ?? (await getNextTicketNumber());
    // Backfill stamps the ticket with its original open time; live tickets use
    // now. createdAt also anchors reviewAfter so old tickets are immediately
    // eligible for triage rather than held for the live review window.
    const createdAt = body.createdAt ? new Date(body.createdAt) : new Date();
    const status = body.status ?? "open";

    const firstMessage = toMessage(body.message, {
      content: body.description,
      authorId: body.discordUserId,
      authorName: body.discordDisplayName ?? body.discordUsername,
      imageUrls: body.imageUrls,
    });
    const imageUrls = firstMessage.imageUrls ? [...firstMessage.imageUrls] : [];

    const doc: Omit<Ticket, "_id"> = {
      ticketNumber,
      source: "discord",
      ...(body.discordChannelId ? { discordChannelId: body.discordChannelId } : {}),
      ...(body.discordUserId ? { discordUserId: body.discordUserId } : {}),
      ...(body.discordUsername?.trim()
        ? { discordUsername: body.discordUsername.trim().slice(0, 64) }
        : {}),
      ...(body.discordDisplayName?.trim()
        ? { discordDisplayName: body.discordDisplayName.trim().slice(0, 128) }
        : {}),
      userId,
      ...(reporter ? { reporter } : {}),
      category: body.category,
      title: body.title.trim().slice(0, 200),
      description: body.description.trim().slice(0, 5000),
      messages: [firstMessage],
      imageUrls,
      status,
      // Only bug reports get the hold window (they may need repro/screenshots);
      // other categories are eligible for triage immediately. Anchored to
      // createdAt, so backfilled (historical) tickets land in the past and are
      // immediately triageable.
      reviewAfter:
        body.category === "bug"
          ? new Date(createdAt.getTime() + REVIEW_HOLD_MS)
          : new Date(createdAt),
      createdAt,
      updatedAt: createdAt,
    };

    const result = await coll.insertOne(doc as Ticket);

    return NextResponse.json({
      id: result.insertedId.toString(),
      ticketNumber,
      reviewAfter: doc.reviewAfter.toISOString(),
      message: "Ticket opened. Thank you!",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/discord-bot/tickets — Append a follow-up, change status, close a
// ticket (optionally with a resolution), retriage, or mark a resolution as
// delivered. Auth: requireBotToken (private key only). Errors: 400, 401, 404
export async function PATCH(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = await parseJsonBody(request, updateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;

    const db = await getDb();
    const coll = getTicketsCollection(db);

    // The schema's refine guarantees one identifier is present; narrow without
    // a non-null assertion so the channel branch is properly typed as string.
    const filter: Filter<Ticket> | null =
      body.ticketNumber != null
        ? { ticketNumber: body.ticketNumber }
        : body.discordChannelId
          ? { discordChannelId: body.discordChannelId }
          : null;
    if (!filter) {
      return NextResponse.json(
        { error: "ticketNumber or discordChannelId is required" },
        { status: 400 }
      );
    }
    const now = new Date();

    if (body.action === "append") {
      const msg = toMessage(body.message, { content: body.message.content ?? "" });
      const res = await coll.updateOne(filter, {
        $push: { messages: msg },
        ...(msg.imageUrls?.length ? { $addToSet: { imageUrls: { $each: msg.imageUrls } } } : {}),
        $set: { updatedAt: now },
      });
      if (!res.matchedCount) {
        return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "status") {
      const res = await coll.updateOne(filter, {
        $set: { status: body.status, updatedAt: now },
        $push: { statusHistory: { status: body.status, at: now, source: "bot" } },
      });
      if (!res.matchedCount) {
        return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "retriage") {
      // Force the ops triage worker to re-assess on its next tick: clear the
      // prior assessment linkage and reopen the ticket with reviewAfter now.
      // The old `assessments` doc is intentionally left in place as history.
      const res = await coll.updateOne(filter, {
        $unset: { assessmentId: "", assessedAt: "", triageStatus: "" },
        $set: { status: "open", reviewAfter: now, updatedAt: now },
        $push: { statusHistory: { status: "open", at: now, source: "bot", note: "retriage" } },
      });
      if (!res.matchedCount) {
        return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "resolution-delivered") {
      const res = await coll.updateOne(filter, {
        $set: { "resolution.deliveredAt": new Date(), updatedAt: now },
      });
      if (!res.matchedCount) {
        return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }

    // action === "close"
    const closedBy = body.closedBy?.slice(0, 128);
    const res = await coll.updateOne(filter, {
      $set: {
        status: "closed",
        closedAt: now,
        ...(closedBy ? { closedBy } : {}),
        ...(body.resolution
          ? {
              resolution: {
                message: body.resolution,
                createdAt: now,
                ...(closedBy ? { closedBy } : {}),
                deliveredAt: null,
              },
            }
          : {}),
        updatedAt: now,
      },
      $push: {
        statusHistory: {
          status: "closed",
          at: now,
          source: "bot",
          ...(closedBy ? { by: closedBy } : {}),
        },
      },
    });
    if (!res.matchedCount) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
