import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getMarketedWorldSafe } from "@/lib/marketing/marketedWorldServer";

/**
 * GET /api/public/facts — what the game currently IS, for surfaces we do not
 * render.
 *
 * The studio site (lakesidegames.net) is static HTML on a different host, so it
 * cannot import `marketedWorld`. Before this route existed it kept its own
 * hand-typed copy of the same facts, and on 2026-09-06 it was advertising
 * twenty-one playable countries and an intermission before v1.0 while the live
 * game was on 1.6.0 with four. Anything off-origin reads this instead.
 *
 * Deliberately NOT under `/api/public/v1`: those routes require an API key, and
 * a marketing page cannot hold one. Everything here is a public claim we print
 * on our own front page, so there is nothing to gate. It is rate-limit-free by
 * design and cheap: the underlying read is served from a 5-minute in-process
 * cache, and the response is edge-cacheable.
 *
 * CORS is open for the same reason: the whole point is for other origins to
 * read it. It exposes no per-user data, so the CDN-caching hazard that applies
 * to the rest of `/api/*` does not apply here.
 */
export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
} as const;

export async function GET() {
  try {
    const world = await getMarketedWorldSafe();
    return NextResponse.json(
      {
        ok: true,
        version: world.version,
        era: world.eraId,
        seedYear: world.seedYear,
        playable: world.playable,
        playableCount: world.playable.length,
        economy: world.economy,
        registeredCountries: world.registeredCountryCount,
      },
      { headers: CACHE_HEADERS }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CACHE_HEADERS });
}
