import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getAuthUser } from "@/lib/auth";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import type { CountryId } from "@/lib/constants/countries";
import type { MarketCapHistory } from "@/lib/db/types";
import type { ShareTradeHistory, ShareTradeKind } from "@/lib/db/types/shareTradeHistory";
import type { Corporation } from "@/lib/db/types";
import type { WireEvent } from "@/lib/wireEvent";
import { EXCHANGE_API_KEYS, getCountryForExchange } from "@/lib/constants/exchangeRegistry";
import { conditionalJson } from "@/lib/api/conditionalJson";

const SPLIT_KINDS: ShareTradeKind[] = ["stock_split", "reverse_split"];
const WIRE_TYPES: WireEvent["type"][] = [
  "dividend_changed",
  "corporation_ipo",
  "corporation_founded",
  "corporation_dissolved",
];
const MARKER_LIMIT = 200;
const MAX_SPAN = 9000;

/**
 * GET /api/stock-exchange/markers?exchange=global|nyse|...&fromTurn=1&toTurn=200
 * Corporate-action markers for the chart time scale.
 * - Splits come from the immutable shareTradeHistory audit trail (full range).
 * - Dividends, IPOs, foundings, and dissolutions come from wireEvents, which
 *   expire after 48h via TTL — long ranges only carry splits. Venue views
 *   scope splits to that venue's corporations; wire markers are global-view
 *   only to avoid cross-venue noise.
 */
export async function GET(request: Request) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const exchange = searchParams.get("exchange")?.toLowerCase() ?? "global";
    const fromTurn = Number(searchParams.get("fromTurn"));
    const toTurn = Number(searchParams.get("toTurn"));

    if (!EXCHANGE_API_KEYS.has(exchange)) {
      return NextResponse.json(
        { error: `Invalid exchange. Use one of: ${[...EXCHANGE_API_KEYS].join(", ")}` },
        { status: 400 }
      );
    }
    if (
      !Number.isInteger(fromTurn) ||
      !Number.isInteger(toTurn) ||
      fromTurn < 1 ||
      toTurn < fromTurn ||
      toTurn - fromTurn > MAX_SPAN
    ) {
      return NextResponse.json(
        { error: "fromTurn/toTurn must be integers with toTurn >= fromTurn and span <= 9000." },
        { status: 400 }
      );
    }

    const authUser = await getAuthUser();
    const isAdmin = authUser?.isAdmin === true;
    const venueCountry = getCountryForExchange(exchange);
    if (!isAdmin && venueCountry) {
      const enabledCountries = await getEnabledCountryIds();
      if (!enabledCountries.includes(venueCountry as CountryId)) {
        return NextResponse.json({ exchange, splits: [], wire: [] });
      }
    }

    let venueCorpIds: Set<string> | null = null;
    let corpNames = new Map<string, string>();
    if (venueCountry) {
      const corps = await db
        .collection<Corporation>("corporations")
        .find({})
        .project({ name: 1, countryId: 1 })
        .toArray();
      corpNames = new Map(corps.map((c) => [c._id.toString(), c.name]));
      venueCorpIds = new Set(
        corps.filter((c) => c.countryId === venueCountry).map((c) => c._id.toString())
      );
    } else {
      const corps = await db
        .collection<Corporation>("corporations")
        .find({})
        .project({ name: 1 })
        .toArray();
      corpNames = new Map(corps.map((c) => [c._id.toString(), c.name]));
    }

    const splitRows = await db
      .collection<ShareTradeHistory>("shareTradeHistory")
      .find({ turn: { $gte: fromTurn, $lte: toTurn }, kind: { $in: SPLIT_KINDS } })
      .sort({ turn: 1 })
      .limit(MARKER_LIMIT)
      .project({ corporationId: 1, kind: 1, turn: 1, createdAt: 1 })
      .toArray();
    const splits = splitRows
      .filter((r) => !venueCorpIds || venueCorpIds.has(r.corporationId.toString()))
      .map((r) => {
        const corpId = r.corporationId.toString();
        const forward = r.kind === "stock_split";
        return {
          turn: r.turn,
          kind: r.kind as string,
          corporationId: corpId,
          corporationName: corpNames.get(corpId) ?? corpId.slice(0, 8),
          headline: `${corpNames.get(corpId) ?? "A corporation"} ${forward ? "split" : "reverse-split"} its shares`,
        };
      });

    // Wire archive: timestamp-bounded (TTL keeps the window small, so the
    // existing timestamp index serves it). Global view only.
    let wire: { timestamp: string; type: string; headline: string; href: string | null }[] = [];
    if (!venueCountry) {
      const bounds = await db
        .collection<MarketCapHistory>("marketCapHistory")
        .find({ turn: { $gte: fromTurn, $lte: toTurn } })
        .sort({ turn: 1 })
        .limit(MAX_SPAN)
        .project({ createdAt: 1 })
        .toArray();
      if (bounds.length > 0) {
        const minDate = bounds[0].createdAt;
        const maxDate = bounds[bounds.length - 1].createdAt;
        const wireRows = await db
          .collection<WireEvent>("wireEvents")
          .find({ type: { $in: WIRE_TYPES }, timestamp: { $gte: minDate, $lte: maxDate } })
          .sort({ timestamp: 1 })
          .limit(MARKER_LIMIT)
          .project({ type: 1, headline: 1, timestamp: 1, href: 1 })
          .toArray();
        wire = wireRows.map((w) => ({
          timestamp: new Date(w.timestamp).toISOString(),
          type: w.type,
          headline: w.headline,
          href: w.href ?? null,
        }));
      }
    }

    return conditionalJson(request, {
      exchange,
      fromTurn,
      toTurn,
      splits,
      wire,
      wireTruncatedByTtl: true,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
