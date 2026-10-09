import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { errorResponse, handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { resolveCasinoPlayer } from "@/lib/casino/house";
import {
  cancelRound,
  enterRound,
  getRound,
  publicRound,
  settleRound,
  startRound,
} from "@/lib/casino/rounds";
import { casinoFailure, guardCasinoPlayer, guardCasinoRequest } from "@/lib/casino/routeSupport";
import { maybeSweepCasino } from "@/lib/casino/sweep";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("enter"),
    discordId: z.string().min(1),
    stake: z.number().int().positive().optional(),
    selection: z.string().optional(),
    tickets: z.number().int().positive().optional(),
  }),
  z.object({ action: z.literal("start"), discordId: z.string().min(1) }),
  z.object({
    action: z.literal("settle"),
    discordId: z.string().min(1),
    chips: z.record(z.string(), z.number().int().nonnegative()).optional(),
  }),
  z.object({
    action: z.literal("cancel"),
    discordId: z.string().min(1),
    reason: z.string().max(200).optional(),
  }),
]);

type Params = { params: Promise<{ id: string }> };

// GET /api/discord-bot/casino/rounds/:id — One round with its entries and, once drawn, the result.
// POST /api/discord-bot/casino/rounds/:id — enter (stake into the pot), start (poker host closes the
// table), settle (draw a race or lottery after betting closes, or cash a poker table out by final
// chip counts) or cancel (host refunds every stake).
// Auth: X-Bot-Token. Errors: 400, 401, 402, 403 (not the host), 404, 409 (round closed or moved).
export async function GET(request: Request, { params }: Params) {
  try {
    const denied = guardCasinoRequest(request);
    if (denied) return denied;
    const { id } = await params;
    const round = await getRound(await getDb(), id);
    if (!round) return errorResponse(404, "Round not found");
    return NextResponse.json({ round: publicRound(round) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const denied = guardCasinoRequest(request);
    if (denied) return denied;
    const parsed = await parseJsonBody(request, actionSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const body = parsed.data;
    const limited = guardCasinoPlayer(body.discordId);
    if (limited) return limited;
    const { id } = await params;
    const db = await getDb();
    maybeSweepCasino(db);

    if (body.action === "enter") {
      const resolved = await resolveCasinoPlayer(db, body.discordId);
      if (!resolved.ok) return casinoFailure(resolved);
      const entered = await enterRound(db, id, resolved.player, body);
      if (!entered.ok) return casinoFailure(entered);
      return NextResponse.json({
        round: publicRound(entered.round),
        stake: entered.stake,
        currency: resolved.player.currency,
      });
    }
    if (body.action === "start") {
      const started = await startRound(db, id, body.discordId);
      if (!started.ok) return casinoFailure(started);
      return NextResponse.json({ round: publicRound(started.round) });
    }

    const round = await getRound(db, id);
    if (!round) return errorResponse(404, "Round not found");
    if (body.action === "cancel" || round.game === "poker") {
      // Only the host can refund a table or cash it out. Races and lotteries draw for anyone.
      if (round.hostDiscordId !== body.discordId) {
        return errorResponse(403, "Only the host can do that");
      }
    }
    const result =
      body.action === "cancel"
        ? await cancelRound(db, round, body.reason ?? "Cancelled by the host")
        : await settleRound(db, id, { chips: body.chips });
    if (!result.ok) return casinoFailure(result);
    return NextResponse.json({ round: publicRound(result.round) });
  } catch (error) {
    return handleRouteError(error);
  }
}
