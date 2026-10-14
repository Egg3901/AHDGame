import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { ANALYTICS_PAGE_VIEW_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getClientIp } from "@/lib/utils/network";
import { classifyDevice, isLikelyBotUserAgent } from "@/lib/analytics/siteTraffic";
import { captureIntakeEvent } from "@/lib/analytics/intakeEvents";
import { isSingleplayer } from "@/lib/singleplayer";

/** Events a browser may report. Completions are server-side only. */
const CLIENT_EVENTS = [
  "signup_viewed",
  "signup_started",
  "create_character_viewed",
  "intake_blocked",
  "create_character_load_failed",
  "create_character_submit_failed",
] as const;

const token = z.string().regex(/^[a-z0-9_]{1,40}$/);

const bodySchema = z.object({
  event: z.enum(CLIENT_EVENTS),
  surface: z.enum(["register", "login", "create_character"]).optional(),
  method: z.enum(["email", "google", "discord", "apple"]).optional(),
  reason: token.optional(),
  step: token.optional(),
});

// POST /api/analytics/intake — Records one anonymous intake funnel event (no account, no person profile).
// Auth: public
// Errors: 400, 429
export async function POST(request: Request) {
  try {
    if (isSingleplayer()) return new NextResponse(null, { status: 204 });
    const clientIp = await getClientIp();
    const limit = checkRateLimit(
      `analytics-intake:${clientIp}`,
      ANALYTICS_PAGE_VIEW_LIMITS.maxRequests,
      ANALYTICS_PAGE_VIEW_LIMITS.windowMs
    );
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const ua = (await headers()).get("user-agent");
    if (isLikelyBotUserAgent(ua)) return new NextResponse(null, { status: 204 });

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);

    const { event, ...properties } = parsed.data;
    await captureIntakeEvent(event, { ...properties, device_class: classifyDevice(ua) });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error);
  }
}
