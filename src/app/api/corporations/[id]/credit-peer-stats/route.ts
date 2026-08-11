import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import type { Corporation } from "@/lib/db/types";
import { getBondCouponRate } from "@/lib/constants/bonds";
import { getCountryConfig } from "@/lib/constants/countries";
import { CREDIT_RATINGS, type CreditRating } from "@/lib/db/types/centralBank";
import { getGameState } from "@/lib/gameState";
import { getTurnReferenceData } from "@/lib/corporations/turnReferenceData";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function parseRating(s: string | undefined): CreditRating {
  if (s && (CREDIT_RATINGS as readonly string[]).includes(s)) return s as CreditRating;
  return "BBB";
}

/**
 * GET /api/corporations/[id]/credit-peer-stats
 * Benchmarks vs other corporations in the same country (and same sector type) using denormalized snapshots.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await getDb();

    const [resolved, gameState] = await Promise.all([resolveCorporation(db, id), getGameState()]);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const currentTurn = gameState?.currentTurn ?? 0;

    const countryId = corporation.countryId;
    const sectorType = corporation.type;

    // Scope the corps scan by country in the DB — previously we pulled every
    // corp in the world and filtered in memory. Also share the centralBanks
    // load with other corp-detail routes via the per-turn cache.
    const [sameCountryCorps, refData] = await Promise.all([
      db
        .collection<Corporation>("corporations")
        .find({ countryId })
        .project<
          Pick<Corporation, "_id" | "type" | "creditCompositeSnapshot" | "creditRatingSnapshot">
        >({
          _id: 1,
          type: 1,
          creditCompositeSnapshot: 1,
          creditRatingSnapshot: 1,
        })
        .toArray(),
      getTurnReferenceData(db, currentTurn),
    ]);
    const { centralBanks } = refData;

    const prime =
      centralBanks.find((b) => b.countryId === countryId)?.primeRate ??
      getCountryConfig(countryId).centralBank.defaultPrimeRate;

    const selfId = corporation._id.toString();
    const sameCountry = sameCountryCorps.filter(
      (c) => c._id.toString() !== selfId && typeof c.creditCompositeSnapshot === "number"
    );
    const sameSector = sameCountry.filter((c) => c.type === sectorType);

    function avgStats(peers: typeof sameCountry) {
      if (peers.length === 0) return null;
      let sumC = 0;
      let sumCoupon = 0;
      for (const p of peers) {
        sumC += p.creditCompositeSnapshot ?? 0;
        sumCoupon += getBondCouponRate(prime, parseRating(p.creditRatingSnapshot));
      }
      const n = peers.length;
      return {
        n,
        avgComposite: Math.round((sumC / n) * 10) / 10,
        avgNewIssueCouponPct: Math.round((sumCoupon / n) * 100) / 100,
      };
    }

    return NextResponse.json({
      countryId,
      sectorType,
      you: {
        composite: corporation.creditCompositeSnapshot ?? null,
        rating: corporation.creditRatingSnapshot ?? null,
      },
      countryPeers: avgStats(sameCountry),
      sectorPeers: avgStats(sameSector),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
