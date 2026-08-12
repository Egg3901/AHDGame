import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type {
  Character,
  Corporation,
  CorporateSector,
  GameState,
  SectorBuildOrder,
  State,
  StateMetrics,
} from "@/lib/db/types";
import { getSectorTechEffects } from "@/lib/constants/techTree";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import { resolvePresetIdFromGameState } from "@/lib/world/countryReadinessContract";
import { isSectorTechTreesEnabled } from "@/lib/corporations/techTree/featureFlag";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { safeDistributeConversionSpread } from "@/lib/currency/marketMaker";
import { corpToSectorCountrySpread } from "@/lib/currency/sectorFxSpread";
import { insufficientCapitalMessage } from "@/lib/currency/insufficientCapitalMessage";
import {
  fetchSectorCompetitorCount,
  fetchSectorMarketSharePercent,
} from "@/lib/corporations/marketShare";
import {
  queueUndeliveredCost,
  undeliveredCost,
  undeliveredUnits,
} from "@/lib/corporations/buildDelivery";
import { resolveCountryPrimeRate } from "@/lib/corporations/sectorGrowthCost";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import { logEconomicAction } from "@/lib/corporations/economicActionLog";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { emitBuildCapexTx } from "@/lib/corporations/capexTxLog";
import { getMarketSystemMode, isMarketSystemMode, marketAtLeast } from "@/lib/market/featureFlag";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  CAPACITY_BUILD_CANCEL_REFUND,
  CAPACITY_BUILD_TURNS,
  MAX_BUILD_UNITS_PER_ORDER,
  computeBuildCost,
} from "@/lib/constants/capacityEconomy";

/**
 * Sector capacity commands (plants tier, P3a of the buildable-sectors plan).
 *
 * Under `marketSystemMode >= "plants"` a sector's `capitalStock` IS its
 * productive capacity and revenue is derived from it, so capacity is the only
 * thing a CEO can buy to grow output. This route is how they buy it:
 *
 *   build      — pay now, capacity arrives CAPACITY_BUILD_TURNS(type) turns later
 *   cancel     — drop an outstanding order, refund CAPACITY_BUILD_CANCEL_REFUND
 *   mothball   — cold-stow the plants: no output, upkeep only
 *   reactivate — bring them back (free, no cooldown in v1)
 *
 * Every action is plants-gated: below that tier capacity is still a haircut on
 * a revenue nameplate that the growth slider drives, and a build order would
 * have nothing coherent to do.
 *
 * Conventions follow `expandSector` / `setSectorGrowth` exactly: basic auth →
 * rate limit → body parse → corp-actions gate → resolve corp → CEO check →
 * work → audit-spine entry via `logEconomicAction`.
 */

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

/**
 * Body schema is local to this command rather than in
 * `lib/api/schemas/corporations.ts`: that file is shared with concurrently
 * developed commands this phase, and there is nothing here another route reads.
 */
const buildCapacitySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("build"),
    /**
     * Capacity units (output units/day) to order. INTEGER and at least 1: a
     * fractional `units` costs effectively nothing (`computeBuildCost` has no
     * floor), so `units: 1e-9` would append a free queue entry — 20/min, for
     * ever, against one unbounded array on one document. It also persists as an
     * order every user-facing string then renders as "0 units".
     */
    units: z.number().int().min(1).max(MAX_BUILD_UNITS_PER_ORDER),
    /** Price-only: compute and return the cost without charging or queueing. */
    preview: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("cancel"),
    /** Index into the sector's outstanding `buildQueue`. */
    orderIndex: z.number().int().min(0).max(1000),
  }),
  z.object({ action: z.literal("mothball") }),
  z.object({ action: z.literal("reactivate") }),
]);

/**
 * Most outstanding build orders one sector may hold. `buildQueue` lives inline
 * on the sector document and is rewritten whole by this command, so an
 * unbounded queue is a document-growth DoS, not just untidy. Well above any
 * legitimate play pattern.
 */
const MAX_OUTSTANDING_BUILD_ORDERS = 20;

/**
 * Compare-and-swap guard for the inline `buildQueue`.
 *
 * This command writes the queue with a whole-array `$set` from a snapshot.
 * Without a precondition on the write, two lost updates are live: two
 * concurrent cancels of the same index both refund (money printed), and two
 * concurrent builds drop one order while charging for both. Matching the exact
 * array we read makes both of those writes fail instead of clobbering, and
 * `modifiedCount` tells us which happened.
 *
 * C4 — the OTHER direction (a command racing the TURN) is not fixed here and
 * cannot be: when the turn wrote the queue unconditionally at the end of its
 * bulkWrite, it clobbered a command that had already committed, so no
 * precondition on the command could save the order. That is fixed on the turn
 * side, which now writes only its own delta (`$pull` of landed orders + `$inc`
 * of the CIP they released) instead of a whole-array `$set` — see the C4 note
 * in `sectorTurn.ts`.
 *
 * The CAS is still exactly right for the command-vs-command races, and it is
 * also what makes a command that overlaps a landing turn fail SAFELY: the pull
 * changes the array, this filter matches nothing, and the caller gets a 409
 * with the money handed back rather than a silent loss.
 *
 * `mothball` / `reactivate` need no CAS: they touch a single scalar
 * (`mothballed`) that the turn only reads, never writes.
 */
function queueCasFilter(sector: CorporateSector): Record<string, unknown> {
  return Array.isArray(sector.buildQueue)
    ? { buildQueue: sector.buildQueue }
    : { buildQueue: { $in: [null, []] } };
}

/**
 * The sector's CIP total: paid cost still UNDER construction as of `currentTurn`.
 * For a smooth order this falls a slice per turn as capacity is delivered, so
 * the command must restate it against the current turn — otherwise it would
 * re-inflate CIP back to the full order cost the turn processor has been
 * draining. Kept identical to `sectorTurn`'s `constructionInProgressAnchor`.
 */
function cipTotal(queue: SectorBuildOrder[], currentTurn: number): number {
  return queueUndeliveredCost(queue, currentTurn);
}

/**
 * POST /api/corporations/[id]/sectors/[sectorId]/build
 * Capacity build / cancel / mothball / reactivate. CEO only, plants tier only.
 */
export async function buildCapacity(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    // Own bucket at the money-moving siblings' rate (buyListedSector 10/min,
    // abandonSector 10/min) rather than the shared 20/min read-ish default: a
    // build spends unbounded capital and rewrites a shared inline array.
    const rateLimit = checkRateLimit(`sector-build:${auth.user.userId}`, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, sectorId } = await params;
    const parsed = await parseJsonBody(request, buildCapacitySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;

    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    // Plants gate. Same read shape as setSectorPricing's clearing gate.
    const mode = await getMarketSystemMode();
    if (!isMarketSystemMode(mode) || !marketAtLeast(mode, "plants")) {
      return NextResponse.json(
        { error: "Capacity building is not enabled in this world" },
        { status: 400 }
      );
    }

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (!ObjectId.isValid(sectorId)) {
      return NextResponse.json({ error: "Invalid sector ID" }, { status: 400 });
    }
    const sector = await db.collection<CorporateSector>("corporateSectors").findOne({
      _id: new ObjectId(sectorId),
      corporationId: corporation._id,
    });
    if (!sector) {
      return NextResponse.json({ error: "Sector not found" }, { status: 404 });
    }

    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 0;
    const currentYear =
      gameState?.currentYear ??
      STARTING_YEAR + Math.floor((Math.max(1, currentTurn) - 1) / TURNS_PER_YEAR);

    let countryId = sector.countryId ?? corporation.countryId;
    if (!countryId) {
      const state = await db
        .collection<State>("states")
        .findOne({ _id: sector.stateId }, { projection: { countryId: 1 } });
      countryId = state?.countryId ?? "US";
    }

    // A state-owned / nationalized sector is not the CEO's to build in, mothball
    // or cancel refunds out of — `requireCeo` only proves seat identity, and a
    // CEO keeps `corporationId` after a sector is nationalized. Same guard the
    // acquisition commands apply.
    if (isStateOwned(corporation)) {
      return NextResponse.json(
        { error: "This sector is state-owned. Its capacity is not yours to change." },
        { status: 403 }
      );
    }
    // A sector under offer must not have its capacity gutted mid-sale: CIP and
    // the build queue feed the valuation a buyer is quoted, and cancelling every
    // order refunds 75% to the seller while delivering a hollowed-out asset.
    if (sector.forSale != null) {
      return NextResponse.json(
        { error: "Unlist this sector before changing its capacity." },
        { status: 400 }
      );
    }

    const queue: SectorBuildOrder[] = Array.isArray(sector.buildQueue) ? sector.buildQueue : [];
    const now = new Date();
    // `resolveCorpLiquidCurrencyCode` is optional-typed for null corps; this one
    // is resolved, and the tx log requires a concrete code.
    const corpCurrencyCode = resolveCorpLiquidCurrencyCode(corporation) ?? "USD";

    // ─── mothball / reactivate (D12) ─────────────────────────────────────────
    if (body.action === "mothball" || body.action === "reactivate") {
      const mothballed = body.action === "mothball";
      if ((sector.mothballed === true) === mothballed) {
        return NextResponse.json(
          { error: mothballed ? "Sector is already mothballed" : "Sector is already active" },
          { status: 400 }
        );
      }
      await db
        .collection<CorporateSector>("corporateSectors")
        .updateOne({ _id: sector._id }, { $set: { mothballed, updatedAt: now } });

      void logEconomicAction(db, {
        characterId: corporation.ceoId,
        userId: auth.user.userId,
        actionType: mothballed ? "mothballSector" : "reactivateSector",
        targetState: sector.stateId,
        turn: currentTurn,
        characterName: corporation.name,
        countryId,
        // No cash moves: mothballing only changes how the turn processor bills
        // the sector's upkeep, so there is nothing correct to log as a cost.
        result: {
          success: true,
          message: `${mothballed ? "Mothballed" : "Reactivated"} ${sector.sectorType} in ${sector.stateId}`,
        },
      }).catch(() => {});

      return NextResponse.json({
        success: true,
        mothballed,
        message: mothballed
          ? "Plants mothballed. They produce nothing and pay reduced upkeep."
          : "Plants reactivated. They resume production next turn.",
      });
    }

    // ─── cancel an outstanding order ─────────────────────────────────────────
    if (body.action === "cancel") {
      const order = queue[body.orderIndex];
      if (!order) {
        return NextResponse.json({ error: "No such build order" }, { status: 404 });
      }
      if (order.onlineTurn <= currentTurn) {
        return NextResponse.json(
          { error: "That build has already been delivered" },
          { status: 400 }
        );
      }
      const nextQueue = queue.filter((_, i) => i !== body.orderIndex);
      // Refund only the part still UNDER construction. A smooth order has
      // already delivered some capacity (it is in `capitalStock` and the CEO
      // keeps it); refunding the full order would hand back cash for plants they
      // already own. `undeliveredCost` is the whole order for a legacy build and
      // the not-yet-built remainder for a smooth one.
      const refundAnchor = undeliveredCost(order, currentTurn) * CAPACITY_BUILD_CANCEL_REFUND;
      // Units actually cancelled — the not-yet-built remainder. Already-delivered
      // capacity stays in `capitalStock`; only this is undone.
      const cancelledUnits = undeliveredUnits(order, currentTurn);
      const corpFxRate = await getCorpFxRate(db, corporation);
      const refundInCorpCapital = Math.round(
        anchorToCorpLiquidCapital(refundAnchor, corporation, corpFxRate)
      );

      // CAS: the refund below is only paid if THIS request is the one that
      // actually removed the order. A replayed or concurrent cancel of the same
      // index matches nothing and refunds nothing.
      const cancelWrite = await db.collection<CorporateSector>("corporateSectors").updateOne(
        { _id: sector._id, ...queueCasFilter(sector) },
        {
          $set: {
            buildQueue: nextQueue,
            constructionInProgressAnchor: Math.round(cipTotal(nextQueue, currentTurn)),
            updatedAt: now,
          },
        }
      );
      if (cancelWrite.modifiedCount !== 1) {
        return NextResponse.json(
          { error: "That build queue changed while you were cancelling. Try again." },
          { status: 409 }
        );
      }
      if (refundInCorpCapital > 0) {
        await db
          .collection<Corporation>("corporations")
          .updateOne(
            { _id: corporation._id },
            { $inc: { liquidCapital: refundInCorpCapital }, $set: { updatedAt: now } }
          );
      }

      // Shadow-ledger credit leg. Without this the refund is a mint the
      // money-supply reconciler cannot attribute. Post-commit and best-effort:
      // the cash has already moved, so a tx-log failure must not 500 the caller
      // into retrying (which would double-refund) — same discipline as
      // `safeDistributeConversionSpread` and `logEconomicAction` here.
      if (refundAnchor > 0) {
        await emitBuildCapexTx(db, {
          corporationId: corporation._id,
          corporationName: corporation.name,
          corporationSequentialId: corporation.sequentialId,
          direction: "refund",
          amountLocal: Math.abs(refundInCorpCapital),
          currencyCode: corpCurrencyCode,
          anchorAmount: refundAnchor,
          turn: currentTurn,
          createdAt: now,
          sectorId: sector._id,
          sectorType: sector.sectorType,
          units: cancelledUnits,
          meta: { orderStartTurn: order.startTurn, orderOnlineTurn: order.onlineTurn },
        }).catch((err) => {
          console.error("[buildCapacity] capex refund tx emit failed", err);
        });
      }

      void logEconomicAction(db, {
        characterId: corporation.ceoId,
        userId: auth.user.userId,
        actionType: "cancelCapacityBuild",
        targetState: sector.stateId,
        turn: currentTurn,
        characterName: corporation.name,
        countryId,
        // Negative cost == cash returned to the corp.
        corpCashCostAnchor: -refundAnchor,
        currencyCode: resolveCorpLiquidCurrencyCode(corporation),
        result: {
          success: true,
          message: `Cancelled a ${Math.round(cancelledUnits)}-unit build in ${sector.stateId}`,
        },
      }).catch(() => {});

      return NextResponse.json({
        success: true,
        refunded: refundInCorpCapital,
        refundFraction: CAPACITY_BUILD_CANCEL_REFUND,
        constructionInProgressAnchor: Math.round(cipTotal(nextQueue, currentTurn)),
      });
    }

    // ─── place a build order ─────────────────────────────────────────────────
    const { units, preview } = body;
    const primeRate = await resolveCountryPrimeRate(db, countryId);
    // Dominance multiplier: fetched the same way setSectorGrowth does, so a
    // dominant sector pays the same premium to build as it does to grow.
    const marketSharePct = await fetchSectorMarketSharePercent(db, sector, corporation);
    // How contested the cell is, which scales that dominance toll. Resolved
    // here AND in the sector-detail quote from the same helper, so the price the
    // dialog shows is the price this command charges.
    const competitorCount = await fetchSectorCompetitorCount(db, sector, corporation._id);
    const ceoChar = corporation.ceoId
      ? await db
          .collection<Character>("characters")
          .findOne({ _id: corporation.ceoId }, { projection: { "stats.businessAcumen": 1 } })
      : null;
    const ceoAcumen = ceoChar?.stats?.businessAcumen ?? NEUTRAL_STAT;
    // Host price level: the sector's OWN state's cost-of-living index, so where
    // you build changes what it costs. Absent metrics ⇒ neutral 1.0 (see
    // `hostBuildPriceIndex`).
    const hostMetrics = await db
      .collection<StateMetrics>("macroMetrics")
      .findOne({ _id: sector.stateId }, { projection: { "economic.costOfLiving": 1 } });
    const hostCostOfLivingIndex = hostMetrics?.economic?.costOfLiving?.value ?? null;
    // Tech-tree growth-cost reduction, re-homed onto the build price (it bought
    // nothing under plants, where the growth slider is vestigial). Scoped to the
    // corp's primary type exactly as `expandSector` scopes its own discount.
    const techBuildCostMultiplier = (await isSectorTechTreesEnabled())
      ? getSectorTechEffects(
          {
            type: corporation.type,
            unlockedTechNodeIds: corporation.unlockedTechNodeIds,
            techDecadeLane: corporation.techDecadeLane,
          },
          corporation.type
        ).growthCostMultiplier
      : 1;

    const cost = computeBuildCost({
      sectorType: sector.sectorType,
      units,
      year: currentYear,
      eraUnitScale: getEraUnitScale(resolvePresetIdFromGameState(gameState)),
      marketSharePercent: marketSharePct,
      competitorCount: competitorCount ?? undefined,
      primeRate,
      acumen: ceoAcumen,
      hostCostOfLivingIndex,
      techGrowthCostMultiplier: techBuildCostMultiplier,
    });
    const buildTurns = CAPACITY_BUILD_TURNS(sector.sectorType);

    if (preview) {
      return NextResponse.json({
        success: true,
        preview: true,
        units,
        costAnchor: Math.round(cost.totalAnchor),
        unitPriceAnchor: Math.round(cost.unitPriceAnchor * 100) / 100,
        dominanceMultiplier: Math.round(cost.dominanceMultiplier * 1000) / 1000,
        rateMultiplier: Math.round(cost.rateMultiplier * 1000) / 1000,
        acumenMultiplier: Math.round(cost.acumenMultiplier * 1000) / 1000,
        techMultiplier: Math.round(cost.techMultiplier * 1000) / 1000,
        hostPriceMultiplier: Math.round(cost.hostPriceMultiplier * 1000) / 1000,
        buildTurns,
        onlineTurn: currentTurn + buildTurns,
      });
    }

    if (queue.length >= MAX_OUTSTANDING_BUILD_ORDERS) {
      return NextResponse.json(
        {
          error: `This sector already has ${MAX_OUTSTANDING_BUILD_ORDERS} builds under way. Wait for one to finish or cancel it.`,
        },
        { status: 400 }
      );
    }

    // Cross-currency friction, mirroring expandSector: a corp building in a
    // different-currency country pays the reduced sector FX spread on top.
    const corpFxRate = await getCorpFxRate(db, corporation);
    const spread = corpToSectorCountrySpread(corporation, countryId, cost.totalAnchor);
    const totalCostAnchor = cost.totalAnchor + spread.spreadAnchor;
    const corpCapitalAnchor = corpLiquidCapitalToAnchor(
      corporation.liquidCapital,
      corporation,
      corpFxRate
    );
    if (corpCapitalAnchor < totalCostAnchor) {
      return NextResponse.json(
        {
          error: insufficientCapitalMessage(
            "This build",
            anchorToCorpLiquidCapital(totalCostAnchor, corporation, corpFxRate),
            corporation.liquidCapital,
            resolveCorpLiquidCurrencyCode(corporation)
          ),
        },
        { status: 400 }
      );
    }

    const order: SectorBuildOrder = {
      unitsOrdered: units,
      // The FX spread is a transaction fee, not construction spend — it is not
      // refundable capital, so it stays out of the order's paid cost (and out
      // of CIP and the cancellation refund base).
      costPaidAnchor: cost.totalAnchor,
      startTurn: currentTurn,
      onlineTurn: currentTurn + buildTurns,
      // Deliver the capacity a slice per turn across the build window rather than
      // as one lump on `onlineTurn`. See `buildDelivery.ts`. Only orders placed
      // through this path ramp; legacy in-flight orders keep all-at-once landing.
      smooth: true,
    };
    const nextQueue = [...queue, order];

    // Charge FIRST, with the balance condition IN THE FILTER. The JS check
    // above races: two concurrent builds both read the same starting balance,
    // both pass, and both $inc down through zero. `$gte` makes the loser's
    // write match nothing.
    const costInCorpCapital = anchorToCorpLiquidCapital(totalCostAnchor, corporation, corpFxRate);
    const debit = await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: corporation._id, liquidCapital: { $gte: costInCorpCapital } },
        { $inc: { liquidCapital: -costInCorpCapital }, $set: { updatedAt: now } }
      );
    if (debit.modifiedCount !== 1) {
      return NextResponse.json(
        {
          error: insufficientCapitalMessage(
            "This build",
            anchorToCorpLiquidCapital(totalCostAnchor, corporation, corpFxRate),
            corporation.liquidCapital,
            resolveCorpLiquidCurrencyCode(corporation)
          ),
        },
        { status: 400 }
      );
    }
    // Then queue the order under the same CAS the cancel path uses. If another
    // writer (a concurrent build/cancel, or the turn processor) touched the
    // queue since we read it, our $set would silently erase their work — so
    // fail instead, and hand the money back rather than charging for an order
    // that was never queued.
    const queueWrite = await db.collection<CorporateSector>("corporateSectors").updateOne(
      { _id: sector._id, ...queueCasFilter(sector) },
      {
        $set: {
          buildQueue: nextQueue,
          constructionInProgressAnchor: Math.round(cipTotal(nextQueue, currentTurn)),
          updatedAt: now,
        },
      }
    );
    if (queueWrite.modifiedCount !== 1) {
      await db
        .collection<Corporation>("corporations")
        .updateOne(
          { _id: corporation._id },
          { $inc: { liquidCapital: costInCorpCapital }, $set: { updatedAt: now } }
        );
      return NextResponse.json(
        { error: "That build queue changed while you were ordering. Try again." },
        { status: 409 }
      );
    }
    if (spread.spreadAnchor > 0 && spread.from && spread.to) {
      const feeInCorp = Math.round(
        anchorToCorpLiquidCapital(spread.spreadAnchor, corporation, corpFxRate)
      );
      await safeDistributeConversionSpread(db, feeInCorp, spread.from, spread.to);
    }

    // Shadow-ledger debit leg — the cash → CIP reclass. Logged at the CIP
    // amount (`cost.totalAnchor`), NOT the charged total: the FX spread is a
    // transaction fee routed to the central banks by
    // `safeDistributeConversionSpread`, not construction spend, and it is
    // deliberately excluded from CIP and from the refund base above. Without
    // this row every build is an unattributed burn in the money-supply
    // reconciler. Best-effort for the same reason as the refund leg.
    if (cost.totalAnchor > 0) {
      await emitBuildCapexTx(db, {
        corporationId: corporation._id,
        corporationName: corporation.name,
        corporationSequentialId: corporation.sequentialId,
        direction: "build",
        amountLocal: Math.abs(anchorToCorpLiquidCapital(cost.totalAnchor, corporation, corpFxRate)),
        currencyCode: corpCurrencyCode,
        anchorAmount: cost.totalAnchor,
        turn: currentTurn,
        createdAt: now,
        sectorId: sector._id,
        sectorType: sector.sectorType,
        units,
        meta: { onlineTurn: order.onlineTurn, spreadAnchor: spread.spreadAnchor },
      }).catch((err) => {
        console.error("[buildCapacity] capex build tx emit failed", err);
      });
    }

    void logEconomicAction(db, {
      characterId: corporation.ceoId,
      userId: auth.user.userId,
      actionType: "buildCapacity",
      targetState: sector.stateId,
      turn: currentTurn,
      characterName: corporation.name,
      countryId,
      corpCashCostAnchor: totalCostAnchor,
      currencyCode: resolveCorpLiquidCurrencyCode(corporation),
      result: {
        success: true,
        message: `Ordered ${Math.round(units)} units of ${sector.sectorType} capacity in ${sector.stateId}`,
        fundsChange: -costInCorpCapital,
      },
    }).catch(() => {});

    return NextResponse.json(
      {
        success: true,
        units,
        costAnchor: Math.round(cost.totalAnchor),
        chargedAnchor: Math.round(totalCostAnchor),
        onlineTurn: order.onlineTurn,
        constructionInProgressAnchor: Math.round(cipTotal(nextQueue, currentTurn)),
        message: `Build ordered. ${Math.round(units)} units come online in ${buildTurns} turns.`,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
