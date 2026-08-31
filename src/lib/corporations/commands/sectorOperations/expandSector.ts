import { NextResponse } from "next/server";
import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import { resolvePresetIdFromGameState } from "@/lib/world/countryReadinessContract";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { expandSectorSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type {
  Character,
  Corporation,
  CorporateSector,
  GameState,
  GameConfig,
  SectorBuildOrder,
  State,
  StateMetrics,
  UnownedSector,
} from "@/lib/db/types";
import {
  DEFAULT_PROFIT_MARGIN,
  DEFAULT_SECTOR_STARTING_REVENUE,
  DEFAULT_SECTOR_STARTING_WORKERS,
} from "@/lib/constants/corporations";
import {
  CAPACITY_BUILD_TURNS,
  computeBuildCost,
  revenuePerCapacityUnit,
} from "@/lib/constants/capacityEconomy";
import { foundingStarterUnits, sectorEntryFeeAnchor } from "@/lib/corporations/foundingPlant";
import { unownedPoolDrawdown } from "@/lib/market/unownedPoolDraw";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { resolveCountryPrimeRate } from "@/lib/corporations/sectorGrowthCost";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import { emitBuildCapexTx } from "@/lib/corporations/capexTxLog";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  getSectorHostFxRate,
  resolveCorpLiquidCurrencyCode,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import { safeDistributeConversionSpread } from "@/lib/currency/marketMaker";
import { corpToSectorCountrySpread } from "@/lib/currency/sectorFxSpread";
import { isCorporateSectorDuplicateKey } from "@/lib/corporations/sectorLocation";
import { getSectorTechEffects } from "@/lib/constants/techTree";
import { isSectorTechTreesEnabled } from "@/lib/corporations/techTree/featureFlag";
import { insufficientCapitalMessage } from "@/lib/currency/insufficientCapitalMessage";
import { loadCommandEconomyBlockedCountries } from "@/lib/economy/queries/commandEconomyMarketGate";
import type { CountryId } from "@/lib/constants/countries";
import {
  retailCapacityExpansionPaused,
  retailDemandTransitionTurnsRemaining,
} from "@/lib/market/retailDemandTransition";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/sectors
 * Expand into a new state. CEO only.
 */
export async function expandSector(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, expandSectorSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { stateId, sectorType: requestedSectorType } = parsed.data;
    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
    // Building is allowed in any sector type. The corp's primary and secondary
    // types are highlighted in the UI and carry a margin bonus; off-type sectors
    // are a soft economic penalty, not a hard gate. When no type is requested we
    // default to the corp's primary type.
    const sectorType = plantsEnabled ? (requestedSectorType ?? corporation.type) : corporation.type;

    // Check the state exists. NOT scoped to the corp's home country: founding
    // abroad is allowed, and the whole command downstream is built for it — the
    // host prime rate (`resolveCountryPrimeRate(state.countryId)`), the
    // cross-currency spread (`corpToSectorCountrySpread`), the host currency and
    // the sector's own `countryId` all key off `state.countryId`, not the corp's.
    // Filtering by `corporation.countryId` here silently 400'd every foreign
    // market the expand UI openly offers.
    const state = await db.collection<State>("states").findOne({ _id: stateId });
    if (!state) {
      return NextResponse.json({ error: "Invalid state" }, { status: 400 });
    }

    // Suggestions already hide these markets, but the write command is the
    // authority. Eastern-bloc production belongs to state enterprises; a
    // private corporation cannot bypass that rule by posting a state id
    // directly. The gate also follows dynamic marketization for countries such
    // as China, so it opens automatically when the canonical model does.
    const blockedCountries = await loadCommandEconomyBlockedCountries(db, [state.countryId]);
    if (blockedCountries.has(state.countryId as CountryId)) {
      return NextResponse.json(
        {
          error:
            "This market is state-controlled under a command economy and is closed to private sector expansion.",
        },
        { status: 403 }
      );
    }

    // Check not already in this state
    const existingSector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne(
        plantsEnabled
          ? { corporationId: corporation._id, stateId, sectorType }
          : { corporationId: corporation._id, stateId }
      );
    if (existingSector) {
      return NextResponse.json(
        { error: "You already have operations in this state" },
        { status: 400 }
      );
    }

    // Check liquid capital (liquidCapital is in corp home currency; cost is in ₳)
    const corpFxRate = await getCorpFxRate(db, corporation);
    // Sector tech-tree effects (scoped to the corp's primary type). The
    // expansion discount applies to the entry fee; the growth-cost multiplier is
    // the same build-price discount `buildCapacity` applies, and is only read on
    // the plants path.
    const techEffects = (await isSectorTechTreesEnabled())
      ? getSectorTechEffects(
          {
            type: corporation.type,
            unlockedTechNodeIds: corporation.unlockedTechNodeIds,
            techDecadeLane: corporation.techDecadeLane,
          },
          corporation.type
        )
      : null;
    const expansionDiscount = techEffects?.expansionDiscount ?? 0;
    // Fee + starter size share helpers with expand-suggestions / NPP founding.
    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    if (plantsEnabled && sectorType === "retail") {
      const currentTurn = gameState?.currentTurn ?? 0;
      const transition = await db.collection<GameConfig>("gameConfig").findOne(
        { _id: "default" },
        {
          projection: {
            retailDemandTransitionStartTurn: 1,
            retailDemandTransitionTurns: 1,
          },
        }
      );
      if (retailCapacityExpansionPaused(transition, currentTurn)) {
        const remaining = retailDemandTransitionTurnsRemaining(transition, currentTurn);
        return NextResponse.json(
          {
            error: `New Retail sectors are paused while consumer demand is rebalanced (${remaining} turns remaining).`,
          },
          { status: 409 }
        );
      }
    }
    const worldPreset = resolvePresetIdFromGameState(gameState);
    const baseExpansionCost = sectorEntryFeeAnchor(worldPreset, expansionDiscount);

    // ─── Plants: founding a sector is a FIRST BUILD, not a free grant ─────────
    //
    // Pre-plants, founding charged SECTOR_EXPANSION_BASE_COST and handed over
    // DEFAULT_SECTOR_STARTING_REVENUE of productive capacity for nothing. Under
    // plants `capitalStock` IS the capacity and it is bought, so a free grant
    // would make expansion the cheapest capacity in the game and turn "found
    // and abandon" into a capacity printer.
    //
    // Founding therefore splits into two charges:
    //   - the entry fee — land, permits, licences (era-scaled, tech-discountable);
    //   - a STARTER BUILD of ONE facility (`foundingStarterUnits`), priced
    //     through `computeBuildCost` with CAPACITY_FOUNDING_DISCOUNT.
    //
    // The capacity ARRIVES rather than existing: the new sector starts at
    // capitalStock 0 with the starter order in its `buildQueue`. Founding is
    // deliberately FASTER than an ordinary build — half CAPACITY_BUILD_TURNS —
    // because a greenfield first plant is scoped to the site from day one.
    let starterUnits = 0;
    let starterBuildAnchor = 0;
    let starterOnlineTurn = 0;
    let currentTurn = 0;
    // Modern basis until the plants block resolves the world's real scale; the
    // pool writer below only runs under plants, where the block has run.
    let eraUnitScale = 1;
    if (plantsEnabled) {
      currentTurn = gameState?.currentTurn ?? 0;
      const currentYear =
        gameState?.currentYear ??
        STARTING_YEAR + Math.floor((Math.max(1, currentTurn) - 1) / TURNS_PER_YEAR);
      eraUnitScale = getEraUnitScale(worldPreset);

      // One facility quantum — the honest "first plant", not a $1M/day nameplate.
      starterUnits = foundingStarterUnits(sectorType);

      const primeRate = await resolveCountryPrimeRate(db, state.countryId);
      const ceoChar = corporation.ceoId
        ? await db
            .collection<Character>("characters")
            .findOne({ _id: corporation.ceoId }, { projection: { "stats.businessAcumen": 1 } })
        : null;
      const hostMetrics = await db
        .collection<StateMetrics>("macroMetrics")
        .findOne({ _id: stateId }, { projection: { "economic.costOfLiving": 1 } });

      starterBuildAnchor = computeBuildCost({
        sectorType,
        units: starterUnits,
        year: currentYear,
        eraUnitScale,
        // No sector here yet, so the corp holds no share of this (state, type)
        // bucket — the dominance multiplier is 1 by construction. Entering a
        // market you do not yet occupy is exactly the case dominance is not
        // meant to toll.
        marketSharePercent: 0,
        primeRate,
        acumen: ceoChar?.stats?.businessAcumen ?? NEUTRAL_STAT,
        hostCostOfLivingIndex: hostMetrics?.economic?.costOfLiving?.value ?? null,
        techGrowthCostMultiplier: techEffects?.growthCostMultiplier ?? 1,
        founding: true,
      }).totalAnchor;

      starterOnlineTurn =
        currentTurn + Math.max(1, Math.ceil(CAPACITY_BUILD_TURNS(sectorType) / 2));
    }

    // Cross-border expansion (target state in a different-currency country) pays
    // the reduced sector FX spread on top of the base cost. No-op while expansion
    // is domestic, but auto-charges if a sector is ever cross-currency.
    // `starterBuildAnchor` is 0 off plants, so this is the pre-existing figure.
    const foundingCostAnchor = baseExpansionCost + starterBuildAnchor;
    const expansionSpread = corpToSectorCountrySpread(
      corporation,
      state.countryId,
      foundingCostAnchor
    );
    const totalExpansionCostAnchor = foundingCostAnchor + expansionSpread.spreadAnchor;
    const corpCapitalAnchor = corpLiquidCapitalToAnchor(
      corporation.liquidCapital,
      corporation,
      corpFxRate
    );
    if (corpCapitalAnchor < totalExpansionCostAnchor) {
      return NextResponse.json(
        {
          error: insufficientCapitalMessage(
            "Expansion",
            anchorToCorpLiquidCapital(totalExpansionCostAnchor, corporation, corpFxRate),
            corporation.liquidCapital,
            resolveCorpLiquidCurrencyCode(corporation)
          ),
        },
        { status: 400 }
      );
    }

    const now = new Date();

    // sector.revenue is stored in the sector's HOST-state currency (the market it
    // operates in); DEFAULT_SECTOR_STARTING_REVENUE is a ₳ constant, so convert at
    // the destination state's host rate before persist. Domestic today (host ==
    // corp), but this stays correct if cross-border expansion is ever enabled.
    const startingHostFxRate = await getSectorHostFxRate(
      db,
      { countryId: state.countryId },
      corporation
    );
    // Under plants the legacy nameplate must match the STARTER quantum, not the
    // ₳1M/day legacy grant: sectorTurn only restates `revenue` from owned
    // capacity, and a founding sector owns 0 for its whole build window, so
    // whatever is written here PERSISTS for ~17 turns and feeds market share,
    // dominance and competitor-revenue reads. Measured live (ticket #1027
    // follow-up): a facility-quantum founding carried a ₳1,050,544 nameplate at
    // capitalStock 0 and dominated its (state, type) market-share panel while
    // producing nothing. Price the nameplate at what the starter build will
    // actually be worth once it lands (units × revenue-per-unit at the default
    // mix — the same figure the plants restatement converges to).
    const startingRevenueAnchor = plantsEnabled
      ? starterUnits * revenuePerCapacityUnit(sectorType, eraUnitScale)
      : DEFAULT_SECTOR_STARTING_REVENUE;
    const startingRevenueLocal = Math.round(
      writeCorpEconomicLocal(
        startingRevenueAnchor,
        resolveSectorHostCurrencyCode({ countryId: state.countryId }, corporation),
        startingHostFxRate
      )
    );

    const newSector: Omit<CorporateSector, "_id"> = {
      corporationId: corporation._id,
      // Sectors are keyed to where they operate, not the owner's HQ country.
      // Cross-border expansion must persist the destination state's country so
      // downstream tax/tariff logic and duplicate-merge paths resolve correctly.
      countryId: state.countryId,
      stateId,
      sectorType,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      revenue: startingRevenueLocal,
      profitMargin: DEFAULT_PROFIT_MARGIN,
      workers: DEFAULT_SECTOR_STARTING_WORKERS,
      createdAt: now,
      updatedAt: now,
    };

    if (plantsEnabled) {
      const starterOrder: SectorBuildOrder = {
        unitsOrdered: starterUnits,
        costPaidAnchor: starterBuildAnchor,
        startTurn: currentTurn,
        onlineTurn: starterOnlineTurn,
        smooth: true,
      };
      // capitalStock 0 + a queued order: the sector exists, owns nothing yet, and
      // produces nothing until the starter build lands. `sectorTurn` derives
      // plants revenue from capacity, so this sector reports 0 revenue for the
      // build window — the written `revenue` above is the legacy nameplate,
      // which plants restates every turn and which non-plants readers still need.
      newSector.capitalStock = 0;
      // P5: zero owned capacity ⇒ zero paid basis. Stamped EXPLICITLY rather
      // than left absent so this row never takes the list-price fallback: the
      // founding build is charged at CAPACITY_FOUNDING_DISCOUNT (0.1×), and the
      // whole point of the field is that the 0.1× is what the sector books at.
      // The starter order's `costPaidAnchor` sits in CIP until it lands, at
      // which point `sectorTurn` moves exactly that discounted cash into the
      // basis.
      newSector.capacityBookAnchor = 0;
      newSector.buildQueue = [starterOrder];
      newSector.constructionInProgressAnchor = Math.round(starterBuildAnchor);
      // Born under plants, so it never needs the flip-turn migration — stamping
      // this now keeps `sectorTurn`'s `isFlipTurn` (plantsStartTurn == null) from
      // treating a zero-capacity newborn as a legacy sector to convert.
      newSector.plantsStartTurn = currentTurn;
    }

    let newSectorId: ObjectId;
    try {
      const inserted = await db
        .collection<CorporateSector>("corporateSectors")
        .insertOne(newSector as CorporateSector);
      newSectorId = inserted.insertedId;
    } catch (error) {
      if (isCorporateSectorDuplicateKey(error)) {
        return NextResponse.json(
          { error: "You already have operations in this state" },
          { status: 400 }
        );
      }
      throw error;
    }

    // Deduct expansion cost incl. any cross-currency spread (convert ₳ → corp currency)
    const costInCorpCapital = anchorToCorpLiquidCapital(
      totalExpansionCostAnchor,
      corporation,
      corpFxRate
    );
    await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: corporation._id },
        { $inc: { liquidCapital: -costInCorpCapital }, $set: { updatedAt: now } }
      );

    // Route the cross-currency expansion spread to the CB system.
    if (expansionSpread.spreadAnchor > 0 && expansionSpread.from && expansionSpread.to) {
      const feeInCorp = Math.round(
        anchorToCorpLiquidCapital(expansionSpread.spreadAnchor, corporation, corpFxRate)
      );
      await safeDistributeConversionSpread(db, feeInCorp, expansionSpread.from, expansionSpread.to);
    }

    if (plantsEnabled && starterUnits > 0) {
      // ─── Draw the starter capacity DOWN from the unowned pool ──────────────
      //
      // The pre-plants founding flow created capacity out of nothing: a new
      // sector appeared with 1M ₳/day of output while the unowned market it
      // entered kept every unit of its headroom. Market share (which is
      // owned / (owned + headroom) under plants) therefore counted the same
      // demand twice, and repeated found-and-abandon cycles inflated the world's
      // capacity without ever consuming the demand backing it.
      //
      // Entering a market CONSUMES headroom. Pipeline update because
      // `headroomUnits` and `revenue` are two views of one quantity and must
      // move together (legacy readers still use `revenue`); both are clamped at
      // 0 so a pool smaller than the starter build cannot go negative.
      // The drawdown shape (upsert scaffolding, self-healing base, clamp at 0,
      // and the trailing restatement of `revenue` from the post-draw units) is
      // shared with `buildCapacity` via `unownedPoolDrawdown`. It used to live
      // inline here and nowhere else, which is exactly how `buildCapacity`
      // shipped without a drawdown at all (#1145).
      const starterDrawdown = unownedPoolDrawdown(
        { stateId, countryId: corporation.countryId, sectorType },
        starterUnits,
        now,
        eraUnitScale
      );
      if (starterDrawdown) {
        await db
          .collection<UnownedSector>("unownedSectors")
          .updateOne({ stateId, sectorType }, starterDrawdown, { upsert: true });
      }

      // Shadow-ledger debit leg for the starter build — the cash → CIP reclass,
      // logged at the CIP amount only (the entry fee is an expense, not
      // construction spend, and the FX spread is a routed transaction fee).
      // Best-effort for the same reason `buildCapacity` treats its legs so: the
      // cash has already moved, and a tx-log failure must not 500 the caller
      // into retrying a founding that already happened.
      if (starterBuildAnchor > 0) {
        await emitBuildCapexTx(db, {
          corporationId: corporation._id,
          corporationName: corporation.name,
          corporationSequentialId: corporation.sequentialId,
          direction: "build",
          amountLocal: Math.abs(
            anchorToCorpLiquidCapital(starterBuildAnchor, corporation, corpFxRate)
          ),
          currencyCode: resolveCorpLiquidCurrencyCode(corporation) ?? "USD",
          anchorAmount: starterBuildAnchor,
          turn: currentTurn,
          createdAt: now,
          sectorId: newSectorId,
          sectorType,
          units: starterUnits,
          meta: { founding: true, onlineTurn: starterOnlineTurn },
        }).catch((err) => {
          console.error("[expandSector] founding capex tx emit failed", err);
        });
      }
    }

    return NextResponse.json(
      {
        success: true,
        sectorId: newSectorId.toString(),
        message: plantsEnabled
          ? `Expanded operations to ${state.name}. Your first plants come online in ${starterOnlineTurn - currentTurn} turns.`
          : `Expanded operations to ${state.name}`,
        ...(plantsEnabled
          ? {
              starterUnits: Math.round(starterUnits),
              starterBuildAnchor: Math.round(starterBuildAnchor),
              entryFeeAnchor: baseExpansionCost,
              onlineTurn: starterOnlineTurn,
            }
          : {}),
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
