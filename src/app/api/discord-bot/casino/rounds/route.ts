import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { errorResponse, handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { resolveCasinoPlayer } from "@/lib/casino/house";
import {
  createRound,
  listRounds,
  publicRound,
  type RoundGame,
  type RoundStatus,
} from "@/lib/casino/rounds";
import { casinoFailure, guardCasinoPlayer, guardCasinoRequest } from "@/lib/casino/routeSupport";
import { maybeSweepCasino } from "@/lib/casino/sweep";

const createSchema = z.discriminatedUnion("game", [
  z.object({
    game: z.literal("race"),
    discordId: z.string().min(1),
    channelId: z.string().nullable().optional(),
    bettingSeconds: z.number().int().positive().optional(),
  }),
  z.object({
    game: z.literal("lottery"),
    discordId: z.string().min(1),
    tier: z.enum(["low", "high"]),
    channelId: z.string().nullable().optional(),
    hours: z.number().int().positive().optional(),
  }),
  z.object({
    game: z.literal("poker"),
    discordId: z.string().min(1),
    channelId: z.string().nullable().optional(),
    buyIn: z.number().int().positive(),
    maxPlayers: z.number().int().positive().optional(),
  }),
]);

const GAMES = new Set<RoundGame>(["race", "lottery", "poker"]);
const STATUSES = new Set<RoundStatus>(["open", "running", "settling", "settled", "cancelled"]);

// GET /api/discord-bot/casino/rounds?game=&status=&due=1&channelId= — Open shared-pot rounds,
// or with due=1 the races and lotteries whose betting has closed and that are ready to draw.
// POST /api/discord-bot/casino/rounds — Open a race, a lottery draw (joins the open draw for
// that tier if one exists) or a poker table.
// Auth: X-Bot-Token. Errors: 400, 401, 403, 404.
export async function GET(request: Request) {
  try {
    const denied = guardCasinoRequest(request);
    if (denied) return denied;
    const params = new URL(request.url).searchParams;
    const game = params.get("game") as RoundGame | null;
    const status = params.get("status") as RoundStatus | null;
    const db = await getDb();
    maybeSweepCasino(db);
    const found = await listRounds(db, {
      game: game && GAMES.has(game) ? game : undefined,
      status: status && STATUSES.has(status) ? status : undefined,
      due: params.get("due") === "1",
      channelId: params.get("channelId") ?? undefined,
    });
    return NextResponse.json({ rounds: found.map(publicRound) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const denied = guardCasinoRequest(request);
    if (denied) return denied;
    const parsed = await parseJsonBody(request, createSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const body = parsed.data;
    const limited = guardCasinoPlayer(body.discordId);
    if (limited) return limited;

    const db = await getDb();
    maybeSweepCasino(db);
    const channelId = body.channelId ?? null;
    let result;
    if (body.game === "race") {
      result = await createRound(db, {
        game: "race",
        hostDiscordId: body.discordId,
        channelId,
        bettingSeconds: body.bettingSeconds,
      });
    } else if (body.game === "lottery") {
      result = await createRound(db, {
        game: "lottery",
        tier: body.tier,
        channelId,
        hours: body.hours,
      });
    } else {
      const resolved = await resolveCasinoPlayer(db, body.discordId);
      if (!resolved.ok) return casinoFailure(resolved);
      result = await createRound(db, {
        game: "poker",
        host: resolved.player,
        channelId,
        buyIn: body.buyIn,
        maxPlayers: body.maxPlayers,
      });
    }
    if (!result.ok) return casinoFailure(result);
    return NextResponse.json({ round: publicRound(result.round), created: result.created });
  } catch (error) {
    return handleRouteError(error);
  }
}
