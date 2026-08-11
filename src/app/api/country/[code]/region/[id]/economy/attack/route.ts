import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { emitBuildCapexTx } from "@/lib/corporations/capexTxLog";
import { requireHumanSession } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { regionUrl } from "@/lib/urls";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getGdpAnchorRate } from "@/lib/currency/gdpAnchorRate";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import { resolvePresetIdFromGameState } from "@/lib/world/countryReadinessContract";
import { formatFundsCompact, roundMarketingStrength } from "@/lib/utils/formatters";
import type {
  Corporation,
  CorporateSector,
  State,
  Tariff,
  UnownedSector,
  User,
  ImperialCharacter,
} from "@/lib/db/types";
import type { GameState } from "@/lib/db/types/gameState";
import { getEffectiveTariffRate, getSplitCaptureMultiplier } from "@/lib/tariffs/tariffEffects";
import { loadActiveFtaPairs } from "@/lib/tariffs/ftaOverrides";
import {
  SPLIT_BASE_CAPTURE_FRACTION,
  UNOWNED_CAPTURE_BONUS_MULTIPLIER,
  MS_CAPTURE_DIVISOR,
  SECTOR_MARKET_GDP_FRACTION,
  SECTOR_TYPE_COUNT,
  DEFAULT_PROFIT_MARGIN,
  DEFAULT_SECTOR_STARTING_WORKERS,
  CORPORATION_TYPES,
  CORPORATION_TYPE_LABELS,
} from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { z } from "zod";
import { logWireEvent, wireHeadlineSectorCaptured } from "@/lib/wireEvent";
import { logEconomicAction } from "@/lib/corporations/economicActionLog";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  resolveCorpLiquidCurrencyCode,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor, writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import { insufficientCapitalMessage } from "@/lib/currency/insufficientCapitalMessage";
import {
  calculateSplitCostAnchor,
  calculateSplitMsCostForStrength,
  SPLIT_STRENGTH_MULTIPLIERS,
  type SplitStrength,
} from "@/lib/corporations/marketActionCosts";
import { isCorporateSectorDuplicateKey } from "@/lib/corporations/sectorLocation";
import { loadCommandEconomyBlockedCountries } from "@/lib/economy/queries/commandEconomyMarketGate";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { capacityRescaleRatio } from "@/lib/constants/capacityEconomy";
import {
  UNOWNED_HEADROOM_DEFAULT_STRATEGY_ID,
  unownedHeadroomUnitsPerAnchor,
  unownedPoolCreditBaseExpr,
  unownedPoolTrailingSet,
} from "@/lib/market/unownedHeadroom";
import { attackCostAnchorUnderPlants, resolveWorldYear } from "@/lib/corporations/capacityCapture";

const splitSchema = z.object({
  sectorType: z.enum(CORPORATION_TYPES),
  splitStrength: z.enum(["full", "half"]).optional().default("full"),
});

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// POST /api/country/[code]/region/[id]/economy/attack — Capture a portion of an unowned sector using marketing strength
// Auth: requireHumanSession (bot tokens rejected)
// Errors: 400, 401, 403, 404, 429
/**
 * POST /api/country/[code]/region/[id]/economy/attack
 * Split off a portion of the unowned sector in this state.
 * Cost is based on unowned sector size. Amount captured is based on marketing strength.
 * Unowned sectors have 0 MS (no defense).
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireHumanSession(request);
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();

    // Block sector splits when corporation actions are paused by admin
    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    if (gameState?.corporationActionsPaused) {
      return NextResponse.json(
        { error: "Corporation actions are currently paused" },
        { status: 403 }
      );
    }

    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    // Command economies (USSR, East Germany, etc) run production through the
    // state — there's no private "unowned pool" to split there. Mirrors the
    // same guard `POST /api/corporations` already applies to founding a new
    // private corp in these countries.
    const blockedCountries = await loadCommandEconomyBlockedCountries(db, [countryId]);
    if (blockedCountries.has(countryId)) {
      return NextResponse.json(
        {
          error:
            "This market is state-controlled under a command economy and cannot be privately split.",
        },
        { status: 403 }
      );
    }

    // Market splitting is retired under the plants tier. Capacity is the
    // authoritative production base there, so buying a slice of an abstract
    // unowned pool is a second, contradictory growth lever — the "two systems
    // at once" confusion advisors reported. Attacking a rival survives (it is
    // the PVP); only the non-targeted split goes. The UI hides the control, and
    // this is the guard that actually enforces it.
    if (marketAtLeast(await getMarketSystemModeForDb(db), "plants")) {
      return NextResponse.json(
        {
          error: "Market splitting has been retired. Build capacity to grow this sector instead.",
        },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, splitSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { sectorType, splitStrength } = parsed.data;

    // Verify state exists
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    // Get player's corporation — supports both regular and imperial characters
    const userDoc = await db
      .collection<User>("users")
      .findOne({ _id: new ObjectId(auth.user.userId) });

    let corporation: Corporation | null = null;

    if (userDoc?.activeCharacterType === "imperial" && userDoc.activeImperialCharacterId) {
      const imperial = await db.collection<ImperialCharacter>("imperialCharacters").findOne({
        _id: userDoc.activeImperialCharacterId,
        userId: new ObjectId(auth.user.userId),
      });
      if (imperial) {
        corporation = await db
          .collection<Corporation>("corporations")
          .findOne({ ceoId: imperial._id, ceoType: "imperial", ceoVacant: { $ne: true } });
      }
    } else {
      const character = await getCharacterByUserId(db, auth.user.userId);
      if (character) {
        corporation = await db
          .collection<Corporation>("corporations")
          .findOne({ ceoId: character._id, ceoVacant: { $ne: true } });
      }
    }

    if (!corporation) {
      return NextResponse.json({ error: "You don't own a corporation" }, { status: 400 });
    }

    // Calculate total market size for this sector type in this state. The GDP→₳
    // rate is era-scoped (refs #3778); `gameState` is already loaded above.
    const attackPreset = resolvePresetIdFromGameState(gameState);
    const usdExchangeRate = getGdpAnchorRate(countryId, attackPreset);
    const eraUnitScale = getEraUnitScale(attackPreset);
    const totalMarketPerSector = Math.round(
      (state.gdp * usdExchangeRate * SECTOR_MARKET_GDP_FRACTION) / SECTOR_TYPE_COUNT
    );

    // Calculate how much is already owned in this sector type and read unowned from DB
    const [existingSectors, unownedDoc] = await Promise.all([
      db
        .collection<CorporateSector>("corporateSectors")
        .find({ stateId, sectorType: sectorType as CorporationType })
        .toArray(),
      db
        .collection<UnownedSector>("unownedSectors")
        .findOne({ stateId, sectorType: sectorType as CorporationType }),
    ]);

    // Normalize each sector's revenue to ₳ before summing. Sectors in a state
    // may be owned by corps with different home currencies (e.g., a JP corp with
    // JPY-denominated revenue in a DE state). Without normalization the raw JPY
    // total would dwarf the ₳ market size and incorrectly report the sector as
    // fully owned. Load FX for all owning corps once and use the same anchor
    // helpers the GET route uses.
    const fxByCurrency = await loadFxRatesByCurrency(db);
    const owningCorpIds = [...new Set(existingSectors.map((s) => s.corporationId))];
    const owningCorps =
      owningCorpIds.length > 0
        ? await db
            .collection<Corporation>("corporations")
            .find({ _id: { $in: owningCorpIds } })
            .project<Pick<Corporation, "_id" | "liquidCurrencyCode" | "countryId">>({
              _id: 1,
              liquidCurrencyCode: 1,
              countryId: 1,
            })
            .toArray()
        : [];
    const fxByOwnerCorpId = new Map(
      owningCorps.map((c) => [
        c._id.toString(),
        { code: resolveCorpLiquidCurrencyCode(c), rate: fxRateForCorpFromMap(c, fxByCurrency) },
      ])
    );
    const totalOwned = existingSectors.reduce((sum, s) => {
      const fx = fxByOwnerCorpId.get(s.corporationId.toString());
      return sum + readCorpEconomicAnchor(s.revenue, fx?.code, fx?.rate ?? 1);
    }, 0);
    // Market tier: at >= "plants" the unowned pool's AUTHORITATIVE quantity is
    // `headroomUnits` (units of unmet demand), and its `revenue` is the derived
    // ₳ view of that — the mirror of the owned side, where `capitalStock` is
    // authoritative and revenue is restated from it each turn. The capture math
    // below is left in ₳ untouched; only the size it reads and the pool
    // drawdown it writes move onto the unit basis.
    // PLANTS-GATED: under plants a split draws `headroomUnits` out of the unowned
    // pool and grants the attacker `capitalStock`; the pool's `revenue` is re-derived
    // from the units that remain. The corporateSectors revenue writes are
    // ternary-gated and run only below plants.
    // NOTE: always false now — the guard above returns 403 under plants, so
    // every `plantsEnabled ?` branch below this line is unreachable. Left in
    // place rather than unpicked here: this route moves money, and stripping
    // the dead branches out of it deserves its own reviewed pass.
    const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
    const unitsPerAnchor = unownedHeadroomUnitsPerAnchor(
      sectorType as CorporationType,
      eraUnitScale
    );
    const anchorPerUnit = unitsPerAnchor > 0 ? 1 / unitsPerAnchor : 0;
    const plantsHeadroomUnits =
      plantsEnabled &&
      typeof unownedDoc?.headroomUnits === "number" &&
      Number.isFinite(unownedDoc.headroomUnits)
        ? Math.max(0, unownedDoc.headroomUnits)
        : null;

    // Fall back to computed gap if doc not seeded yet
    const unowned =
      plantsHeadroomUnits != null
        ? plantsHeadroomUnits * anchorPerUnit
        : (unownedDoc?.revenue ?? Math.max(0, totalMarketPerSector - totalOwned));

    if (unowned <= 0) {
      return NextResponse.json(
        { error: "This sector is fully owned. No market share available to capture." },
        { status: 400 }
      );
    }

    const strengthMultiplier = SPLIT_STRENGTH_MULTIPLIERS[splitStrength as SplitStrength];

    // Capture is computed BEFORE the cost so the plants price can be floored
    // against the capacity actually delivered, exactly as the owned-sector attack
    // route does it. Nothing in this block reads the cost, and the guard order
    // below (cost > 0, then affordability, then MS) is unchanged, so the
    // non-plants error precedence is exactly what it was.
    // Load tariffs for the sector's country and compute split multiplier.
    // Domestic corps splitting into tariffed sectors get a bonus; foreign corps get a penalty.
    const sectorCountry = countryId;
    const [allTariffs, activeFtaPairs] = await Promise.all([
      db.collection<Tariff>("tariffs").find({ countryId: sectorCountry }).toArray(),
      loadActiveFtaPairs(db),
    ]);
    const corpCountry = corporation.countryId;
    const tariffRate = getEffectiveTariffRate(
      allTariffs,
      sectorCountry,
      sectorType,
      corpCountry,
      corporation._id,
      activeFtaPairs
    );
    const isDomesticSplitting = sectorCountry === corpCountry;
    const tariffMultiplier = getSplitCaptureMultiplier(tariffRate, isDomesticSplitting);

    // Capture amount = base fraction of unowned × (1 + MS / divisor) × unowned bonus × tariff × strength
    // Unowned sectors have 0 MS defense, so capture is more favorable
    const captureMultiplier =
      (1 + corporation.marketingStrength / MS_CAPTURE_DIVISOR) * tariffMultiplier;
    const rawCapture =
      unowned *
      SPLIT_BASE_CAPTURE_FRACTION *
      captureMultiplier *
      UNOWNED_CAPTURE_BONUS_MULTIPLIER *
      strengthMultiplier;
    // Cap to the unowned amount (large splits can't exceed available market)
    const actualCapture = Math.min(Math.round(rawCapture), unowned);

    // Base cost = fraction of the unowned sector size; scaled by strength only (size removed)
    //
    // PLANTS FLOOR. Below plants this is the legacy marketing spend, unchanged.
    // Under plants the split hands the attacker REAL `capitalStock`, so pricing it
    // as a fraction of the pool leaves capture an order of magnitude cheaper than
    // commissioning the same plant — the identical hole `attackCostAnchorUnderPlants`
    // closed on the owned-sector route, which this route was left out of. The floor
    // is a `max` against the legacy figure, so a split can never get CHEAPER.
    //
    // The units priced are the units the attacker RECEIVES. A pool draw has no
    // defender and therefore no attrition, so that is the whole captured amount on
    // the pool's default mix — the same quantity `capturedPoolUnits` grants below.
    const legacySplitCostAnchor = Math.round(
      calculateSplitCostAnchor(unowned) * strengthMultiplier
    );
    const splitCostInternal = plantsEnabled
      ? attackCostAnchorUnderPlants({
          legacyCostAnchor: legacySplitCostAnchor,
          unitsReceived: actualCapture * unitsPerAnchor,
          sectorType: sectorType as CorporationType,
          year: resolveWorldYear(gameState?.currentYear, gameState?.currentTurn),
          eraUnitScale,
        })
      : legacySplitCostAnchor;

    if (splitCostInternal <= 0) {
      return NextResponse.json({ error: "Unowned sector too small to split." }, { status: 400 });
    }

    // Check sufficient capital (compare treasury in ₳ vs split cost in ₳)
    const corpFxRate = fxRateForCorpFromMap(corporation, fxByCurrency);
    const corpCapitalAnchor = corpLiquidCapitalToAnchor(
      corporation.liquidCapital,
      corporation,
      corpFxRate
    );
    if (corpCapitalAnchor < splitCostInternal) {
      return NextResponse.json(
        {
          // Display in the attacker's local currency (the math runs in ₳).
          error: insufficientCapitalMessage(
            "Split",
            anchorToCorpLiquidCapital(splitCostInternal, corporation, corpFxRate),
            corporation.liquidCapital,
            resolveCorpLiquidCurrencyCode(corporation)
          ),
        },
        { status: 400 }
      );
    }

    const splitCost = splitCostInternal;

    // Marketing strength cost: escalates with each split (2^escalation), scaled by strength only
    // Half strength = half MS (min 1), Full = unchanged
    const currentEscalation = corporation.splitEscalation ?? 0;
    const finalMsCost = calculateSplitMsCostForStrength(
      currentEscalation,
      splitStrength as SplitStrength
    );

    if (corporation.marketingStrength < finalMsCost) {
      return NextResponse.json(
        {
          error: `Insufficient marketing strength. This split costs ${finalMsCost} MS. You have ${roundMarketingStrength(corporation.marketingStrength)} MS.${currentEscalation > 0 ? ` (Escalated: split #${currentEscalation + 1} this period. Cost resets by half each turn.)` : ""}`,
        },
        { status: 400 }
      );
    }

    const now = new Date();

    // Convert captured revenue from ₳ to the owning corp's local currency before
    // persisting. Post-v0.2.6, `sector.revenue` is stored in the corp's
    // `liquidCurrencyCode`; writing the raw ₳ value (as the pre-fix code did)
    // made JP sectors show ~1/133 of the true capture once the GET route
    // converted back via `readCorpEconomicAnchor`. See split-currency fix.
    const corpCurrencyCode = resolveCorpLiquidCurrencyCode(corporation);
    const actualCaptureLocal = Math.round(
      writeCorpEconomicLocal(actualCapture, corpCurrencyCode, corpFxRate)
    );

    // Check if corporation already has a sector here of this type
    const existingOwnSector = existingSectors.find(
      (s) => s.corporationId.toString() === corporation._id.toString()
    );

    // Under plants the captured ₳ becomes CAPACITY the corp now owns. The pool
    // prices its units on the sector type's default mix (unowned docs carry no
    // strategy), so convert to the buyer's mix keeping the ₳ nameplate
    // invariant — the same D9 ratio a retool applies.
    const capturedPoolUnits = plantsEnabled ? actualCapture * unitsPerAnchor : 0;
    const capitalStockDelta = plantsEnabled
      ? Math.round(
          capturedPoolUnits *
            capacityRescaleRatio(
              sectorType as CorporationType,
              UNOWNED_HEADROOM_DEFAULT_STRATEGY_ID,
              existingOwnSector?.strategyId
            ) *
            100
        ) / 100
      : 0;

    // Which sector the captured capacity landed in, for the capex ledger leg
    // below. Null only if the insert lost a duplicate-key race and the recovery
    // path could not resolve a row.
    let capturedSectorId: ObjectId | null = existingOwnSector?._id ?? null;

    if (existingOwnSector) {
      // Add to existing sector (capacity under plants, revenue below it)
      await db.collection<CorporateSector>("corporateSectors").updateOne(
        { _id: existingOwnSector._id },
        plantsEnabled
          ? { $inc: { capitalStock: capitalStockDelta }, $set: { updatedAt: now } }
          : {
              $inc: { revenue: actualCaptureLocal },
              $set: { updatedAt: now },
            }
      );
    } else {
      // Create new sector (revenue denominated in corp's local currency)
      const newSector: Omit<CorporateSector, "_id"> = {
        corporationId: corporation._id,
        countryId,
        stateId,
        sectorType: sectorType as CorporationType,
        targetGrowthRate: 0,
        currentGrowthRate: 0,
        currentGrowthCost: 0,
        // Plants: the sector is born with capacity and no revenue — the turn
        // processor derives revenue from `capitalStock × mixPrice` next tick.
        // `plantsStartTurn` marks it as already-flipped so its (zero) revenue
        // is never re-seeded as capacity.
        revenue: plantsEnabled ? 0 : actualCaptureLocal,
        ...(plantsEnabled
          ? { capitalStock: capitalStockDelta, plantsStartTurn: gameState?.currentTurn ?? 0 }
          : {}),
        profitMargin: DEFAULT_PROFIT_MARGIN,
        workers: DEFAULT_SECTOR_STARTING_WORKERS,
        createdAt: now,
        updatedAt: now,
      };
      try {
        const inserted = await db
          .collection<CorporateSector>("corporateSectors")
          .insertOne(newSector as CorporateSector);
        capturedSectorId = inserted.insertedId;
      } catch (error) {
        if (isCorporateSectorDuplicateKey(error)) {
          const recovered = await db
            .collection<CorporateSector>("corporateSectors")
            .findOneAndUpdate(
              {
                corporationId: corporation._id,
                stateId,
                sectorType: sectorType as CorporationType,
              },
              plantsEnabled
                ? { $inc: { capitalStock: capitalStockDelta }, $set: { updatedAt: now } }
                : {
                    $inc: { revenue: actualCaptureLocal },
                    $set: { updatedAt: now },
                  }
            );
          capturedSectorId = recovered?._id ?? null;
        } else {
          throw error;
        }
      }
    }

    // Deduct split cost (cash + marketing strength) and escalate
    const splitCostInCorpCapital = anchorToCorpLiquidCapital(
      splitCostInternal,
      corporation,
      corpFxRate
    );
    await db.collection<Corporation>("corporations").updateOne(
      { _id: corporation._id },
      {
        $inc: {
          liquidCapital: -splitCostInCorpCapital,
          marketingStrength: -finalMsCost,
          splitEscalation: 1,
        },
        $set: { updatedAt: now },
      }
    );

    // ─── Ledger leg for the split fee (plants) ───────────────────────────────
    //
    // Same reasoning as the owned-sector attack route: the `liquidCapital`
    // decrement above has no counterpart in the ledger, and under plants the fee
    // is floored at the build price of the capacity received times
    // ATTACK_BUILD_PRICE_PREMIUM, so it is now large enough that leaving it
    // unattributed shows up in the shadow ledger as money leaving the world.
    // Booked as capacity capex because the corp paid at least replacement cost
    // and received real plant. No row below plants, where the fee is still the
    // legacy marketing spend. Best-effort: the cash has moved, so a log failure
    // must not 500 the caller into a double charge.
    if (plantsEnabled && capturedSectorId && splitCostInternal > 0 && splitCostInCorpCapital > 0) {
      await emitBuildCapexTx(db, {
        corporationId: corporation._id,
        corporationName: corporation.name,
        corporationSequentialId: corporation.sequentialId,
        direction: "build",
        amountLocal: Math.abs(splitCostInCorpCapital),
        currencyCode: corpCurrencyCode ?? "USD",
        anchorAmount: splitCostInternal,
        turn: gameState?.currentTurn ?? 0,
        createdAt: now,
        sectorId: capturedSectorId,
        sectorType,
        units: capitalStockDelta,
        meta: { reason: "unownedSplitCapture" },
      }).catch(() => {});
    }

    // Draw the pool down. Under plants that means HEADROOM UNITS (the
    // authoritative quantity), with revenue re-derived from the remaining
    // units; a `$inc` on revenue there would be silently contradicted by the
    // unit field every reader now prefers. Written as one pipeline so the
    // clamp, the drawdown and the re-derivation cannot interleave with a racing
    // split. A doc with no `headroomUnits` yet heals from its revenue first.
    if (unownedDoc) {
      if (plantsEnabled) {
        await db.collection<UnownedSector>("unownedSectors").updateOne({ _id: unownedDoc._id }, [
          {
            $set: {
              headroomUnits: {
                $max: [
                  0,
                  {
                    $subtract: [
                      unownedPoolCreditBaseExpr(sectorType as CorporationType, true, eraUnitScale),
                      capturedPoolUnits,
                    ],
                  },
                ],
              },
              updatedAt: now,
            },
          },
          { $set: unownedPoolTrailingSet(sectorType as CorporationType, true, eraUnitScale) },
        ]);
      } else {
        await db
          .collection<UnownedSector>("unownedSectors")
          .updateOne(
            { _id: unownedDoc._id },
            { $inc: { revenue: -actualCapture }, $set: { updatedAt: now } }
          );
        // Clamp to 0 — prevents negative if two concurrent splits race
        await db
          .collection<UnownedSector>("unownedSectors")
          .updateOne(
            { _id: unownedDoc._id, revenue: { $lt: 0 } },
            { $set: { revenue: 0, updatedAt: now } }
          );
      }
    }

    // existingOwnSector.revenue is in corp-local currency; normalize to ₳ before
    // ratioing against the ₳-denominated totalMarketPerSector.
    const existingOwnRevenueAnchor = existingOwnSector
      ? readCorpEconomicAnchor(existingOwnSector.revenue, corpCurrencyCode, corpFxRate)
      : 0;
    const newMarketShare =
      totalMarketPerSector > 0
        ? Math.round(((existingOwnRevenueAnchor + actualCapture) / totalMarketPerSector) * 10000) /
          100
        : 0;

    const sectorLabel = CORPORATION_TYPE_LABELS[sectorType as CorporationType] ?? sectorType;
    const sectorHref = `${regionUrl(countryId, id)}?tab=economy&sector=${sectorType}`;

    logWireEvent(
      "sector_captured",
      wireHeadlineSectorCaptured(corporation.name, actualCapture, sectorLabel, state.name),
      { href: sectorHref }
    );

    // Log the economic action so the automation detector sees a unified
    // per-actor action timeline (the split route bypasses the AP action logger).
    void logEconomicAction(db, {
      characterId: corporation.ceoId,
      userId: auth.user.userId,
      actionType: "splitSector",
      targetState: stateId,
      turn: gameState?.currentTurn ?? 0,
      characterName: corporation.name,
      username: userDoc?.username,
      countryId,
      // splitCost (= splitCostInternal) and actualCapture are already ₳ (anchor);
      // finalMsCost is marketing strength. See corpEconomyFields for ₳ normalization.
      corpCashCostAnchor: splitCost,
      msCost: finalMsCost,
      capturedRevenueAnchor: actualCapture,
      currencyCode: corpCurrencyCode,
      result: {
        success: true,
        message: `Split ${actualCapture.toLocaleString()} from unowned ${sectorLabel} market`,
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      splitCost,
      splitCostInternal,
      msCost: finalMsCost,
      revenueCaptured: actualCapture,
      newMarketShare,
      nextSplitMsCost: Math.pow(2, currentEscalation + 1),
      message: `Split ${formatFundsCompact(actualCapture)} from unowned ${sectorLabel} market (cost: ${formatFundsCompact(splitCost)} + ${finalMsCost} MS)`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
