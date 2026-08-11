import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { PartyHistorySnapshot } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

// Per-turn party-history snapshots are immutable once written during turn
// processing, so the result for a given (country, currentTurn, lookback) window
// never changes mid-turn. We key the cache on `currentTurn`, which means the
// key rotates automatically the moment a turn advances — no explicit
// invalidation needed. The TTL is only a safety backstop in case the current
// turn's snapshot lands a beat after `currentTurn` increments.
async function fetchPartyHistory(
  countryId: CountryId,
  currentTurn: number,
  lookbackTurns: number
): Promise<PartyHistorySnapshot[]> {
  const db = await getDb();
  const minTurn = Math.max(1, currentTurn - lookbackTurns + 1);
  return db
    .collection<PartyHistorySnapshot>("partyHistory")
    .find({ countryId, turn: { $gte: minTurn, $lte: currentTurn } })
    .sort({ partyId: 1, turn: 1 })
    .toArray();
}

function getCachedPartyHistory(
  countryId: CountryId,
  currentTurn: number,
  lookbackTurns: number
): Promise<PartyHistorySnapshot[]> {
  return unstable_cache(
    () => fetchPartyHistory(countryId, currentTurn, lookbackTurns),
    ["parties-history", countryId, String(currentTurn), String(lookbackTurns)],
    { revalidate: 600, tags: ["parties-history", `parties-history:${countryId}`] }
  )();
}

// GET /api/country/[code]/parties/history — Return per-party org and membership history
// Auth: public
// Errors: 400
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const db = await getDb();
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    // currentTurn is read uncached (getGameState is intentionally uncached for
    // immediate visibility) so we always select the correct per-turn cache key.
    const gameState = await db
      .collection<{ _id: "current"; currentTurn: number }>("gameState")
      .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
    const currentTurn = Math.max(1, gameState?.currentTurn ?? 1);
    const lookbackTurnsParam = new URL(request.url).searchParams.get("turns");
    const requestedTurns = Number.parseInt(lookbackTurnsParam ?? "48", 10);
    const lookbackTurns = Number.isFinite(requestedTurns)
      ? Math.max(1, Math.min(48, requestedTurns))
      : 48;

    const history = await getCachedPartyHistory(countryId, currentTurn, lookbackTurns);

    return NextResponse.json({
      countryId,
      currentTurn,
      lookbackTurns,
      history,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
