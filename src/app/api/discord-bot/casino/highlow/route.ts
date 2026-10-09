import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { errorResponse, handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { resolveCasinoPlayer } from "@/lib/casino/house";
import {
  actHighLow,
  activeHighLow,
  publicSession,
  startHighLow,
} from "@/lib/casino/highlowSessions";
import { casinoFailure, guardCasinoPlayer, guardCasinoRequest } from "@/lib/casino/routeSupport";
import { maybeSweepCasino } from "@/lib/casino/sweep";

const highLowSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    discordId: z.string().min(1),
    stake: z.number().int().positive(),
  }),
  z.object({ action: z.literal("status"), discordId: z.string().min(1) }),
  z.object({
    action: z.enum(["higher", "lower", "cashout"]),
    discordId: z.string().min(1),
    sessionId: z.string().min(1),
  }),
]);

// POST /api/discord-bot/casino/highlow — Start a high-low hand, call higher or lower, or cash out.
// The server holds the hand and draws every card. Idle hands are cashed out after ten minutes.
// Auth: X-Bot-Token. Errors: 400, 402, 403, 404, 409 (hand already open or already moved), 503.
export async function POST(request: Request) {
  try {
    const denied = guardCasinoRequest(request);
    if (denied) return denied;
    const parsed = await parseJsonBody(request, highLowSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const body = parsed.data;
    const limited = guardCasinoPlayer(body.discordId);
    if (limited) return limited;

    const db = await getDb();
    maybeSweepCasino(db);

    if (body.action === "status") {
      const session = await activeHighLow(db, body.discordId);
      return NextResponse.json({ session: session ? publicSession(session) : null });
    }
    if (body.action === "start") {
      const resolved = await resolveCasinoPlayer(db, body.discordId);
      if (!resolved.ok) return casinoFailure(resolved);
      const started = await startHighLow(db, resolved.player, body.stake);
      if (!started.ok) return casinoFailure(started);
      return NextResponse.json({ session: publicSession(started.session) });
    }
    const acted = await actHighLow(db, body.discordId, body.sessionId, body.action);
    if (!acted.ok) return casinoFailure(acted);
    return NextResponse.json({ session: publicSession(acted.session) });
  } catch (error) {
    return handleRouteError(error);
  }
}
