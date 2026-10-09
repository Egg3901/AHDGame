import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { parseJsonBody } from "@/lib/api/validate";
import { errorResponse, handleRouteError } from "@/lib/api/errors";
import { getNextTicketNumber } from "@/lib/ticketCounter";

const schema = z.object({
  discordFloor: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
});

/** Both Discord and staff-created tickets reserve before creating a channel. */
export async function POST(request: Request) {
  if (!requireBotToken(request, false)) return errorResponse(401, "Unauthorized");
  const parsed = await parseJsonBody(request, schema);
  if (!parsed.success) return errorResponse(parsed.status, parsed.error);
  try {
    return NextResponse.json({ ticketNumber: await getNextTicketNumber(parsed.data.discordFloor) });
  } catch (error) {
    return handleRouteError(error, { request, route: "/api/discord-bot/tickets/reserve" });
  }
}
