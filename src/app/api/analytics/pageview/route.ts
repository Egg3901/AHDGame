import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { getTrackingCookieOptions, getAuthUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { ANALYTICS_PAGE_VIEW_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getClientIp } from "@/lib/utils/network";
import { getSiteTrafficPageviewsCollection } from "@/lib/db/collections/siteTrafficPageviews";
import {
  classifyDevice,
  isLikelyBotUserAgent,
  MAX_LOAD_TIME_MS,
  normalizeAnalyticsPath,
} from "@/lib/analytics/siteTraffic";

const bodySchema = z.object({
  path: z.string().min(1).max(520),
  /** Client-reported navigation timing in ms. Optional. */
  loadTimeMs: z.number().finite().nonnegative().max(120_000).optional(),
});

/** Read ISO country from known edge geo headers (Vercel / Cloudflare). */
function readCountryHeader(h: Headers): string | undefined {
  const raw = h.get("x-vercel-ip-country") ?? h.get("cf-ipcountry") ?? h.get("x-country-code");
  if (!raw) return undefined;
  const v = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : undefined;
}

// POST /api/analytics/pageview — Records a single SPA page view (first-party analytics).
// Auth: public (optional JWT read for authenticated flag only)
// Errors: 400, 429
export async function POST(request: Request) {
  try {
    const clientIp = await getClientIp();
    const limit = checkRateLimit(
      `analytics-pv:${clientIp}`,
      ANALYTICS_PAGE_VIEW_LIMITS.maxRequests,
      ANALYTICS_PAGE_VIEW_LIMITS.windowMs
    );
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const hdrs = await headers();
    const ua = hdrs.get("user-agent");
    if (isLikelyBotUserAgent(ua)) {
      return new NextResponse(null, { status: 204 });
    }

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const path = normalizeAnalyticsPath(parsed.data.path);
    if (!path) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const cookieStore = await cookies();
    let visitorId = cookieStore.get("__ahd_track")?.value;
    if (!visitorId) {
      visitorId = randomUUID();
      cookieStore.set("__ahd_track", visitorId, await getTrackingCookieOptions());
    }

    const authUser = await getAuthUser();
    const authenticated = authUser !== null;

    const deviceType = classifyDevice(ua);
    const country = readCountryHeader(hdrs) ?? "ZZ";
    const rawLoad = parsed.data.loadTimeMs;
    const loadTimeMs =
      rawLoad !== undefined && rawLoad > 0 && rawLoad <= MAX_LOAD_TIME_MS
        ? Math.round(rawLoad)
        : undefined;

    const coll = await getSiteTrafficPageviewsCollection();
    await coll.insertOne({
      path,
      recordedAt: new Date(),
      visitorId,
      authenticated,
      deviceType,
      country,
      ...(loadTimeMs !== undefined ? { loadTimeMs } : {}),
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
