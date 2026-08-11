// GET  /api/admin/corporations/seed-unowned?maxBoost=1.0
//   Dry-run preview: returns per-sector current revenue, boost %, projected delta, and total.
//   No writes. maxBoost capped at 3.0.
//
// POST /api/admin/corporations/seed-unowned
// One-time unowned sector stimulus. Two modes:
//   - No body (or omit maxBoost): legacy flat 20% boost to all existing docs + seed missing ones.
//   - { maxBoost: number }: distress-weighted boost; most distressed sectors get up to maxBoost,
//     healthiest get ~0. maxBoost is capped server-side at 3.0 (300%).
// Auth: requireAdmin

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { seedUnownedSectors } from "@/lib/admin/seed/seedUnownedSectors";
import { boostProtectedUnownedToNatCorp } from "@/lib/admin/seed/redirectProtectedUnownedBoost";
import {
  bucketKey,
  loadSeedProtectedBucketKeys,
} from "@/lib/nationalization/stateControlledBuckets";
import {
  computeSectorDistressRanking,
  distressRankingToBoostMap,
} from "@/lib/economy/sectorDistress";
import type { UnownedSector, GameState, ExchangeRate } from "@/lib/db/types";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import type { SeedPreviewRow, SeedPreviewResponse } from "@/lib/api/types/sectorSeed";
import { unownedPoolBoostSet } from "@/lib/market/unownedHeadroom";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

const LEGACY_BOOST_MULTIPLIER = 1.2;
const MAX_BOOST_CAP = 3.0;

const BodySchema = z.object({ maxBoost: z.number().min(0).max(MAX_BOOST_CAP).optional() });

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const rawBoost = parseFloat(searchParams.get("maxBoost") ?? "1");
    const maxBoost = Math.min(isNaN(rawBoost) ? 1 : rawBoost, MAX_BOOST_CAP);

    const db = await getDb();

    const [gameState, ranking, rateDocs] = await Promise.all([
      db.collection<GameState>("gameState").findOne({ _id: "current" }),
      computeSectorDistressRanking(db),
      db.collection<ExchangeRate>("exchangeRates").find({}).toArray(),
    ]);
    const boostMap = distressRankingToBoostMap(ranking, maxBoost);

    // `unownedSectors.revenue` is stored in each country's LOCAL currency
    // (same convention as CorporateSector.revenue, post-v0.2.6). Summing raw
    // revenue across countries would mix denominations, so when forex is live
    // we normalize each (sector, country) bucket to ₳ before aggregating.
    const forexEnabled = gameState?.forexEnabled === true;
    const rateByCurrency = new Map(rateDocs.map((r) => [r.currencyCode, r.rate]));

    // Aggregate current revenue per (sectorType, countryId) so we can convert
    // each country's local-currency total to ₳ at its own FX rate.
    const agg = await db
      .collection<UnownedSector>("unownedSectors")
      .aggregate<{
        _id: { sectorType: string; countryId: CountryId };
        totalRevenue: number;
        docCount: number;
      }>([
        {
          $group: {
            _id: { sectorType: "$sectorType", countryId: "$countryId" },
            totalRevenue: { $sum: "$revenue" },
            docCount: { $sum: 1 },
          },
        },
      ])
      .toArray();

    const revenueMap = new Map<string, { totalRevenue: number; docCount: number }>();
    for (const r of agg) {
      const currency = COUNTRY_CURRENCY_MAP[r._id.countryId];
      const anchorRevenue = forexEnabled
        ? readCorpEconomicAnchor(r.totalRevenue, currency, rateByCurrency.get(currency) ?? 1)
        : r.totalRevenue;
      const existing = revenueMap.get(r._id.sectorType) ?? { totalRevenue: 0, docCount: 0 };
      existing.totalRevenue += anchorRevenue;
      existing.docCount += r.docCount;
      revenueMap.set(r._id.sectorType, existing);
    }

    const rows: SeedPreviewRow[] = ranking.map((r) => {
      const boost = boostMap.get(r.sectorType) ?? 0;
      const current = revenueMap.get(r.sectorType)?.totalRevenue ?? 0;
      const delta = Math.round(current * boost);
      return {
        sectorType: r.sectorType,
        boostPct: Math.round(boost * 100),
        currentRevenue: current,
        projectedDelta: delta,
      };
    });

    const totalCurrentRevenue = rows.reduce((s, r) => s + r.currentRevenue, 0);
    const totalProjectedDelta = rows.reduce((s, r) => s + r.projectedDelta, 0);
    const totalDocs = agg.reduce((s, r) => s + r.docCount, 0);

    return NextResponse.json<SeedPreviewResponse>({
      rows,
      totalCurrentRevenue,
      totalProjectedDelta,
      totalDocs,
      autoSectorSeedEnabled: gameState?.autoSectorSeedEnabled === true,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();

    // Parse via the shared validator (raw body parsing is blocked by the
    // architecture audit). A missing/invalid body falls back to legacy flat mode.
    const parsed = await parseJsonBody(request, BodySchema);
    const body: { maxBoost?: number } = parsed.success ? parsed.data : {};

    const log: string[] = [];
    const redirectBuckets = await loadSeedProtectedBucketKeys(db);
    // PLANTS: `headroomUnits`, not `revenue`, is the pool players draw from.
    // Both boost paths below scale the two legs in lockstep via the SAME shared
    // pipeline the per-turn auto-seeder uses. This route used to scale revenue
    // alone, so under plants an admin stimulus moved a number nothing reads and
    // left the unit view stale.
    const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
    const eraUnitScale = await loadWorldEraUnitScale(db);

    if (body.maxBoost == null) {
      const allUnowned = await db.collection<UnownedSector>("unownedSectors").find({}).toArray();
      const open = allUnowned.filter(
        (u) => !redirectBuckets.has(bucketKey(u.stateId, u.sectorType))
      );
      // Grouped by sectorType: the ₳ → units factor is per-sector, so a single
      // updateMany across mixed types cannot maintain `headroomUnits` correctly.
      const idsByType = new Map<CorporationType, UnownedSector["_id"][]>();
      for (const u of open) {
        const t = u.sectorType as CorporationType;
        const list = idsByType.get(t) ?? [];
        list.push(u._id);
        idsByType.set(t, list);
      }
      let modifiedCount = 0;
      for (const [sectorType, ids] of idsByType) {
        if (ids.length === 0) continue;
        const res = await db
          .collection<UnownedSector>("unownedSectors")
          .updateMany({ _id: { $in: ids } }, [
            {
              $set: unownedPoolBoostSet(
                sectorType,
                LEGACY_BOOST_MULTIPLIER,
                now,
                plantsEnabled,
                eraUnitScale
              ),
            },
          ]);
        modifiedCount += res.modifiedCount;
      }
      const redirectedCount = await boostProtectedUnownedToNatCorp(
        db,
        allUnowned,
        redirectBuckets,
        LEGACY_BOOST_MULTIPLIER
      );
      await seedUnownedSectors(
        db,
        (msg) => log.push(msg),
        LEGACY_BOOST_MULTIPLIER,
        "2019-default",
        false,
        redirectBuckets
      );
      return NextResponse.json({
        success: true,
        boostedCount: modifiedCount,
        redirectedToNatCorpCount: redirectedCount,
        redirectBuckets: redirectBuckets.size,
        log,
      });
    }

    // Distress-weighted boost
    const maxBoost = Math.min(body.maxBoost, MAX_BOOST_CAP);
    const ranking = await computeSectorDistressRanking(db);
    const boostMap = distressRankingToBoostMap(ranking, maxBoost);

    let totalModified = 0;
    let totalRedirected = 0;
    for (const [sectorType, boost] of boostMap.entries()) {
      if (boost <= 0) continue;
      const multiplier = 1 + boost;
      const sectorDocs = await db
        .collection<UnownedSector>("unownedSectors")
        .find({ sectorType: sectorType as CorporationType })
        .toArray();
      const openIds = sectorDocs
        .filter((u) => !redirectBuckets.has(bucketKey(u.stateId, u.sectorType)))
        .map((u) => u._id);
      if (openIds.length > 0) {
        const { modifiedCount } = await db
          .collection<UnownedSector>("unownedSectors")
          .updateMany({ _id: { $in: openIds } }, [
            {
              $set: unownedPoolBoostSet(
                sectorType as CorporationType,
                multiplier,
                now,
                plantsEnabled,
                eraUnitScale
              ),
            },
          ]);
        totalModified += modifiedCount;
      }
      totalRedirected += await boostProtectedUnownedToNatCorp(
        db,
        sectorDocs,
        redirectBuckets,
        multiplier
      );
    }

    const maxRankBoost = boostMap.get(ranking[0]?.sectorType) ?? maxBoost;
    await seedUnownedSectors(
      db,
      (msg) => log.push(msg),
      1 + maxRankBoost,
      "2019-default",
      false,
      redirectBuckets
    );

    const distressPreview = ranking.slice(0, 5).map((r) => ({
      sectorType: r.sectorType,
      boost: `+${((boostMap.get(r.sectorType) ?? 0) * 100).toFixed(0)}%`,
    }));

    return NextResponse.json({
      success: true,
      boostedCount: totalModified,
      redirectedToNatCorpCount: totalRedirected,
      redirectBuckets: redirectBuckets.size,
      log,
      distressPreview,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
