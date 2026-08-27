import { NextResponse } from "next/server";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { handleRouteError } from "@/lib/api/errors";

/**
 * GET /api/public/v1/meta
 *
 * Machine-readable catalog of the public v1 API so bot/dashboard authors can
 * discover endpoints programmatically. Kept in sync by review: any PR that
 * adds or changes a route under /api/public/v1 must update this table.
 */
const ENDPOINTS = [
  {
    method: "GET",
    path: "/api/public/v1/game",
    description: "Current game state and turn timing.",
    params: [],
  },
  {
    method: "GET",
    path: "/api/public/v1/character",
    description: "Search characters by name (partial) or discordId.",
    params: [
      { name: "name", required: false },
      { name: "discordId", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/characterSearch",
    description: "Alias of /character.",
    params: [],
  },
  {
    method: "GET",
    path: "/api/public/v1/characters/bulk",
    description: "Bulk character lookup by comma-separated sequential ids (max 100).",
    params: [{ name: "ids", required: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/character/[id]",
    description: "Full character detail by sequential id or ObjectId.",
    params: [{ name: "id", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/character/[id]/career",
    description: "Character career history.",
    params: [{ name: "id", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/character/[id]/achievements",
    description: "Character achievements.",
    params: [{ name: "id", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/party",
    description: "Party details.",
    params: [
      { name: "id", required: true },
      { name: "country", required: true },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/parties",
    description: "All parties for a country with seat counts.",
    params: [{ name: "country", required: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/country",
    description: "List all countries.",
    params: [],
  },
  {
    method: "GET",
    path: "/api/public/v1/country/[code]",
    description: "Country details.",
    params: [{ name: "code", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/country/[code]/legislature",
    description: "Legislature composition and bills.",
    params: [{ name: "code", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/country/[code]/economy",
    description: "Economic indicators for a country.",
    params: [{ name: "code", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/country/[code]/history",
    description: "Country event log (leader changes, bills, referendums).",
    params: [
      { name: "limit", required: false },
      { name: "type", required: false },
      { name: "beforeTurn", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/country/[code]/battles",
    description: "Recent battle reports involving a country.",
    params: [
      { name: "limit", required: false },
      { name: "code", required: true, inPath: true },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/conflicts",
    description: "Conflicts filtered by country and/or status.",
    params: [
      { name: "country", required: false },
      { name: "status", required: false },
      { name: "limit", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/government",
    description: "Government overview for a country.",
    params: [{ name: "country", required: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/elections",
    description: "Active elections for a country.",
    params: [
      { name: "country", required: true },
      { name: "state", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/elections/archives",
    description: "Completed elections with winners.",
    params: [
      { name: "country", required: true },
      { name: "type", required: false },
      { name: "limit", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/elections/[id]",
    description: "Election detail with candidates, votes, phases.",
    params: [{ name: "id", required: true, inPath: true }],
  },
  {
    method: "GET",
    path: "/api/public/v1/news",
    description: "News feed.",
    params: [
      { name: "limit", required: false },
      { name: "category", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/legislation",
    description: "Bills and votes, filterable by status.",
    params: [
      { name: "country", required: false },
      { name: "status", required: false },
      { name: "limit", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/market",
    description: "Stock market data by sector.",
    params: [
      { name: "type", required: true },
      { name: "country", required: false },
      { name: "page", required: false },
      { name: "view", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/bonds",
    description: "Bond market data.",
    params: [
      { name: "corp", required: false },
      { name: "page", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/commodities",
    description: "Commodity market data.",
    params: [],
  },
  {
    method: "GET",
    path: "/api/public/v1/funds",
    description: "Index funds; ?slug=SLUG for detail with top holdings.",
    params: [
      { name: "slug", required: false },
      { name: "country", required: false },
      { name: "scope", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/corporations",
    description: "List all corporations.",
    params: [],
  },
  {
    method: "GET",
    path: "/api/public/v1/corporation",
    description: "Corporation detail; id is the sequentialId.",
    params: [
      { name: "name", required: false },
      { name: "id", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/corporation/shares/history",
    description: "Public share-trade tape for one corporation.",
    params: [
      { name: "name", required: false },
      { name: "id", required: false },
      { name: "page", required: false },
      { name: "pageSize", required: false },
    ],
  },
  {
    method: "GET",
    path: "/api/public/v1/leaderboard",
    description: "Player rankings by metric.",
    params: [
      { name: "metric", required: false },
      { name: "country", required: false },
      { name: "limit", required: false },
    ],
  },
] as const;

export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "meta");
    if (!guard.ok) return guard.response;

    return NextResponse.json(
      {
        ok: true,
        version: 1,
        baseUrl: process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com",
        docsUrl: process.env.NEXT_PUBLIC_DOCS_URL || "https://docs.lakesidegames.net/api/public-v1.html",
        authentication: "X-API-Key header (public or private scope)",
        rateLimits: {
          publicRead: "60 req/min per key",
          transfers: "20 req/min per key (private scope only)",
          forex: "30 req/min per key (private scope only)",
          limitedResponse: "HTTP 429 + Retry-After header",
        },
        stability:
          "v1 is additive-only: fields may be added, existing fields are never removed or renamed.",
        writeEndpoints: ["POST /api/v1/transfer", "POST /api/v1/forex/exchange"],
        endpoints: ENDPOINTS,
      },
      { headers: guard.headers }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
