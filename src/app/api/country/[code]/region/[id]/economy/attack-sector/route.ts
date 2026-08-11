// POST /api/country/[code]/region/[id]/economy/attack-sector — Attack a rival corporation's sector to capture market share
// Auth: requireHumanSession (bot tokens rejected)
// Errors: 400, 401, 403, 404, 429
/**
 * POST /api/country/[code]/region/[id]/economy/attack-sector
 * Attack another corporation's sector. Capture is based on your MS vs defender's MS.
 * Cost: fraction of target revenue (cash) + escalating MS cost (same as unowned split).
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { emitBuildCapexTx } from "@/lib/corporations/capexTxLog";
import { requireHumanSession } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { regionUrl } from "@/lib/urls";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import { resolvePresetIdFromGameState } from "@/lib/world/countryReadinessContract";
import type { Corporation, CorporateSector, State, User, ImperialCharacter } from "@/lib/db/types";
import type { GameState } from "@/lib/db/types/gameState";
import {
  ATTACK_OWNED_CONTESTED_FRACTION,
  DEFAULT_PROFIT_MARGIN,
  DEFAULT_SECTOR_STARTING_WORKERS,
  CORPORATION_TYPE_LABELS,
  getDominanceAttackEaseMultiplier,
  getUnderdogAttackAmplifier,
} from "@/lib/constants/corporations";
import { fetchAttackerDefenderShares } from "@/lib/corporations/marketShare";
import type { CorporationType } from "@/lib/constants/corporations";
import { z } from "zod";
import { logWireEvent, wireHeadlineSectorAttack } from "@/lib/wireEvent";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { createNotification } from "@/lib/notifications";
import { logEconomicAction } from "@/lib/corporations/economicActionLog";
import { roundMarketingStrength } from "@/lib/utils/formatters";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { insufficientCapitalMessage } from "@/lib/currency/insufficientCapitalMessage";
import { readCorpEconomicAnchor, writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import {
  calculateAttackCostAnchor,
  calculateSplitMsCost,
} from "@/lib/corporations/marketActionCosts";
import { isCorporateSectorDuplicateKey } from "@/lib/corporations/sectorLocation";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { capacityRescaleRatio } from "@/lib/constants/capacityEconomy";
import {
  attackCostAnchorUnderPlants,
  attackCapacityBasisAnchor,
  capacityCaptureUnits,
  capacityCaptureBookUpdates,
  resolveWorldYear,
} from "@/lib/corporations/capacityCapture";

const attackSectorSchema = z.object({
  sectorId: z.string().length(24),
});

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireHumanSession(request);
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();

    // Block sector attacks when corporation actions are paused by admin
    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const eraUnitScale = getEraUnitScale(resolvePresetIdFromGameState(gameState));
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

    const parsed = await parseJsonBody(request, attackSectorSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { sectorId } = parsed.data;

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

    if (!ObjectId.isValid(sectorId)) {
      return NextResponse.json({ error: "Invalid sector ID" }, { status: 400 });
    }

    const targetSector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne({ _id: new ObjectId(sectorId), stateId });
    if (!targetSector) {
      return NextResponse.json({ error: "Sector not found" }, { status: 404 });
    }

    if (targetSector.corporationId.toString() === corporation._id.toString()) {
      return NextResponse.json({ error: "Cannot attack your own sector" }, { status: 400 });
    }

    // Don't filter by countryId — corporations are headquartered in their home country
    // but can hold sectors in any country. The sector record already confirms the link.
    const defenderCorp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: targetSector.corporationId });
    if (!defenderCorp) {
      // Orphan sector: defender corp was deleted but the sector row was left behind
      // (historical dissolution that missed cleanup, hostile-takeover edge case, etc).
      // Self-heal by removing the orphan so the region economy view stops surfacing it
      // as an "Unknown" attackable target. The unowned-market split path is the right
      // way to claim revenue that no longer has an owner.
      await db.collection<CorporateSector>("corporateSectors").deleteOne({ _id: targetSector._id });
      // Under plants there is no Split control to point at, so don't send the
      // player looking for one.
      const splitRetired = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
      return NextResponse.json(
        {
          error: splitRetired
            ? "That corporation has been dissolved. Its share of this sector has been returned to the unowned pool — refresh and build capacity here to claim it."
            : "That corporation has been dissolved. The sector's market share has been returned to the unowned pool — refresh and use Split Unowned Market.",
        },
        { status: 404 }
      );
    }

    if (defenderCorp.countryOwnerId) {
      return NextResponse.json(
        { error: "Cannot attack state-owned corporations." },
        { status: 400 }
      );
    }

    if (defenderCorp.suspended) {
      return NextResponse.json(
        { error: "Cannot attack a corporation that is suspended pending privatization auction." },
        { status: 400 }
      );
    }

    // Market tier: at >= "plants" the attack moves CAPACITY, not revenue.
    // PLANTS-GATED: under plants an attack is a CAPACITY transfer with attrition —
    // the defender loses units, the attacker receives ATTACK_CAPTURE_EFFICIENCY of
    // them, and pays at least build price × ATTACK_BUILD_PRICE_PREMIUM. Every
    // revenue write in this file is ternary-gated and runs only below plants.
    const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");

    const attackerMS = corporation.marketingStrength ?? 0;
    const defenderMS = defenderCorp.marketingStrength ?? 0;

    // Attacker and defender may be in different currencies. Normalize every
    // value to ₳ (anchor) for the economic math, then convert back to each
    // side's local currency at its own persistence boundary.
    const corpFxRate = await getCorpFxRate(db, corporation);
    const defenderFxRate = await getCorpFxRate(db, defenderCorp);
    const attackerCurrencyCode = resolveCorpLiquidCurrencyCode(corporation);
    const defenderCurrencyCode = resolveCorpLiquidCurrencyCode(defenderCorp);

    // ATTACK BASIS. Below plants this is the defender's ₳ revenue, exactly as
    // before. Under plants it is the defender's CAPACITY NAMEPLATE when it has
    // any built capacity — see `attackCapacityBasisAnchor` for why: keying the
    // threshold, the contested amount and the price on derived `revenue` made a
    // mothballed factory both un-attackable AND free to attack. The capacity
    // basis is already ₳ and currency-free, so it bypasses the FX conversion
    // rather than being run through it.
    const legacyRevenueAnchor = readCorpEconomicAnchor(
      targetSector.revenue,
      defenderCurrencyCode,
      defenderFxRate
    );
    const targetRevenueAnchor =
      attackCapacityBasisAnchor(
        {
          sectorType: targetSector.sectorType as CorporationType,
          capitalStock: targetSector.capitalStock,
          strategyId: targetSector.strategyId,
        },
        plantsEnabled,
        eraUnitScale
      ) ?? legacyRevenueAnchor;

    // Capture = contested fraction × (attackerMS / (attackerMS + defenderMS)),
    // boosted when the target dominates its (state, sectorType): 1.5× at the
    // 50% dominance threshold scaling to 3.5× at 100% market share. Stacks
    // multiplicatively with the underdog amplifier — a small attacker (<10%
    // share) striking a dominant defender (>50% share) gets up to 1.75× more
    // capture on top of the dominance multiplier.
    // When defender has 0 MS, attacker gets 100% of contested amount.
    // All values here are in ₳.
    //
    // Computed BEFORE the cost so the plants price can be floored against the
    // capacity actually delivered (see `attackCostAnchorUnderPlants`). The order
    // of the affordability / MS / capture guards below is unchanged, so the
    // non-plants error precedence is exactly what it was.
    const { defenderSharePercent, attackerSharePercent } = await fetchAttackerDefenderShares(
      db,
      targetSector,
      defenderCorp,
      corporation._id
    );
    const dominanceAttackMult = getDominanceAttackEaseMultiplier(defenderSharePercent);
    const underdogMult = getUnderdogAttackAmplifier(attackerSharePercent, defenderSharePercent);
    const contestedAmount =
      targetRevenueAnchor * ATTACK_OWNED_CONTESTED_FRACTION * dominanceAttackMult * underdogMult;
    const msSum = attackerMS + defenderMS;
    const attackerShare = msSum > 0 ? attackerMS / msSum : 1;
    const rawCapture = contestedAmount * attackerShare;
    const actualCapture = Math.min(
      Math.round(rawCapture),
      Math.max(0, Math.floor(targetRevenueAnchor) - 1)
    );

    // ─── Plants: the capture is a CAPACITY transfer, not a revenue transfer ──
    // Under plants `sector.revenue` is restated from `capitalStock × mixPrice`
    // every turn, so the legacy revenue `$inc`s on both sides are erased on the
    // next tick — the attacker pays and keeps nothing. The captured ₳ is
    // therefore converted into capacity units at the DEFENDER's mix, the
    // defender loses all of them, and the attacker receives only
    // ATTACK_CAPTURE_EFFICIENCY of them (the rest is destroyed in the taking).
    const defenderStock =
      typeof targetSector.capitalStock === "number" && Number.isFinite(targetSector.capitalStock)
        ? Math.max(0, targetSector.capitalStock)
        : 0;
    const rawUnits = capacityCaptureUnits(
      actualCapture,
      targetSector.sectorType as CorporationType,
      targetSector.strategyId,
      eraUnitScale
    );
    // Never take more plant than the defender actually has (a stale nameplate,
    // or a sector mid-flip, could otherwise imply more units than exist).
    const unitsTaken = Math.min(defenderStock, rawUnits.unitsTaken);
    const unitsReceivedAtDefenderMix =
      rawUnits.unitsTaken > 0 ? rawUnits.unitsReceived * (unitsTaken / rawUnits.unitsTaken) : 0;

    const attackCostInternal = plantsEnabled
      ? attackCostAnchorUnderPlants({
          legacyCostAnchor: calculateAttackCostAnchor(targetRevenueAnchor),
          unitsReceived: unitsReceivedAtDefenderMix,
          sectorType: targetSector.sectorType as CorporationType,
          year: resolveWorldYear(gameState?.currentYear, gameState?.currentTurn),
          eraUnitScale,
        })
      : calculateAttackCostAnchor(targetRevenueAnchor);
    const currentEscalation = corporation.splitEscalation ?? 0;
    const msCost = calculateSplitMsCost(currentEscalation);

    const corpCapitalAnchor = corpLiquidCapitalToAnchor(
      corporation.liquidCapital,
      corporation,
      corpFxRate
    );
    if (corpCapitalAnchor < attackCostInternal) {
      return NextResponse.json(
        {
          // Display in the attacker's local currency (the math runs in ₳).
          error: insufficientCapitalMessage(
            "Attack",
            anchorToCorpLiquidCapital(attackCostInternal, corporation, corpFxRate),
            corporation.liquidCapital,
            attackerCurrencyCode
          ),
        },
        { status: 400 }
      );
    }

    const attackCost = attackCostInternal;

    if (corporation.marketingStrength < msCost) {
      return NextResponse.json(
        {
          error: `Insufficient marketing strength. This attack costs ${msCost} MS. You have ${roundMarketingStrength(corporation.marketingStrength)} MS.`,
        },
        { status: 400 }
      );
    }

    if (actualCapture <= 0) {
      return NextResponse.json(
        { error: "Target sector is too small to capture meaningfully." },
        { status: 400 }
      );
    }

    const now = new Date();

    // Convert the ₳ transfer back to each side's stored currency for persistence.
    const captureInDefenderLocal = Math.round(
      writeCorpEconomicLocal(actualCapture, defenderCurrencyCode, defenderFxRate)
    );
    const captureInAttackerLocal = Math.round(
      writeCorpEconomicLocal(actualCapture, attackerCurrencyCode, corpFxRate)
    );

    // Add to attacker's sector (existing or new) — attacker's local currency.
    // Read BEFORE the defender is written so the P5 basis transfer below sees
    // both sides' pre-attack state.
    const existingSectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find({
        stateId,
        sectorType: targetSector.sectorType,
        corporationId: corporation._id,
      })
      .toArray();

    const existingOwnSector = existingSectors[0];

    // P5: the paid basis moves with the plant. See `capacityCaptureBookUpdates`.
    const captureBook = plantsEnabled
      ? capacityCaptureBookUpdates({
          defender: {
            sectorType: targetSector.sectorType as CorporationType,
            capitalStock: targetSector.capitalStock,
            capacityBookAnchor: targetSector.capacityBookAnchor,
          },
          attacker: existingOwnSector
            ? {
                sectorType: existingOwnSector.sectorType,
                capitalStock: existingOwnSector.capitalStock,
                capacityBookAnchor: existingOwnSector.capacityBookAnchor,
              }
            : null,
          unitsTaken,
          unitsReceived: unitsReceivedAtDefenderMix,
          year: resolveWorldYear(gameState?.currentYear, gameState?.currentTurn),
          eraUnitScale,
        })
      : null;

    // Reduce the target: capacity units under plants, revenue below it.
    await db.collection<CorporateSector>("corporateSectors").updateOne(
      { _id: targetSector._id },
      plantsEnabled
        ? {
            $inc: { capitalStock: -(Math.round(unitsTaken * 100) / 100) },
            $set: { updatedAt: now, ...(captureBook?.defenderSet ?? {}) },
          }
        : { $inc: { revenue: -captureInDefenderLocal }, $set: { updatedAt: now } }
    );

    // Capacity units are "output units/day", but a unit is only priced by the
    // mix it is pointed at (D9). Moving plant from a defender running one
    // strategy to an attacker running another must keep the ₳ NAMEPLATE
    // invariant, exactly as a retool does — hence the same RPU ratio.
    const unitsForAttacker = plantsEnabled
      ? unitsReceivedAtDefenderMix *
        capacityRescaleRatio(
          targetSector.sectorType as CorporationType,
          targetSector.strategyId,
          existingOwnSector?.strategyId
        )
      : 0;
    const capitalStockDelta = Math.round(unitsForAttacker * 100) / 100;

    if (existingOwnSector) {
      await db.collection<CorporateSector>("corporateSectors").updateOne(
        { _id: existingOwnSector._id },
        plantsEnabled
          ? {
              $inc: { capitalStock: capitalStockDelta },
              $set: {
                updatedAt: now,
                capacityBookAnchor: captureBook?.attackerBookAnchor ?? 0,
              },
            }
          : { $inc: { revenue: captureInAttackerLocal }, $set: { updatedAt: now } }
      );
    } else {
      const newSector: Omit<CorporateSector, "_id"> = {
        corporationId: corporation._id,
        countryId,
        stateId,
        sectorType: targetSector.sectorType as CorporationType,
        targetGrowthRate: 0,
        currentGrowthRate: 0,
        currentGrowthCost: 0,
        // Under plants the sector is born with CAPACITY and no revenue: the
        // turn processor derives revenue from `capitalStock × mixPrice` on the
        // next tick. Writing revenue here would be double-counted for one turn
        // and then overwritten. `plantsStartTurn` is stamped so the sector is
        // not treated as a pre-flip legacy row (which would re-seed capacity
        // from its — zero — revenue on its first processed turn).
        revenue: plantsEnabled ? 0 : captureInAttackerLocal,
        ...(plantsEnabled
          ? {
              capitalStock: capitalStockDelta,
              // A brand-new sector owns only what it just took, so its basis is
              // exactly what travelled with that plant.
              capacityBookAnchor: captureBook?.attackerBookAnchor ?? 0,
              plantsStartTurn: gameState?.currentTurn ?? 0,
            }
          : {}),
        profitMargin: DEFAULT_PROFIT_MARGIN,
        workers: DEFAULT_SECTOR_STARTING_WORKERS,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await db
          .collection<CorporateSector>("corporateSectors")
          .insertOne(newSector as CorporateSector);
      } catch (error) {
        if (isCorporateSectorDuplicateKey(error)) {
          await db.collection<CorporateSector>("corporateSectors").updateOne(
            {
              corporationId: corporation._id,
              stateId,
              sectorType: targetSector.sectorType as CorporationType,
            },
            plantsEnabled
              ? {
                  $inc: { capitalStock: capitalStockDelta },
                  $set: {
                    updatedAt: now,
                    capacityBookAnchor: captureBook?.attackerBookAnchor ?? 0,
                  },
                }
              : { $inc: { revenue: captureInAttackerLocal }, $set: { updatedAt: now } }
          );
        } else {
          throw error;
        }
      }
    }

    // Deduct cost and escalate
    const attackCostInCorpCapital = anchorToCorpLiquidCapital(
      attackCostInternal,
      corporation,
      corpFxRate
    );
    await db.collection<Corporation>("corporations").updateOne(
      { _id: corporation._id },
      {
        $inc: {
          liquidCapital: -attackCostInCorpCapital,
          marketingStrength: -msCost,
          splitEscalation: 1,
        },
        $set: { updatedAt: now },
      }
    );

    // ─── Ledger leg for the attack fee (plants) ──────────────────────────────
    //
    // The `liquidCapital` decrement above is a bare `$inc` with no counterpart
    // anywhere; `logEconomicAction` below is telemetry, not a ledger entry. That
    // was tolerable while the fee was a modest marketing spend, but under plants
    // `attackCostAnchorUnderPlants` floors it at the BUILD PRICE of the capacity
    // received times ATTACK_BUILD_PRICE_PREMIUM, which is materially larger — and
    // an unattributed drain of that size reads to the shadow ledger as money
    // vanishing from the world.
    //
    // It is booked as capacity capex because that is what it now is: the corp
    // paid at least replacement cost and received real plant. Below plants the
    // fee is still the legacy marketing spend and no row is emitted, so the
    // ledger is byte-identical there. Best-effort, like every other capex leg:
    // the cash has already moved, so a log failure must not 500 the caller into
    // a retry that would charge twice.
    if (plantsEnabled && attackCostInternal > 0 && attackCostInCorpCapital > 0) {
      await emitBuildCapexTx(db, {
        corporationId: corporation._id,
        corporationName: corporation.name,
        corporationSequentialId: corporation.sequentialId,
        direction: "build",
        amountLocal: Math.abs(attackCostInCorpCapital),
        currencyCode: attackerCurrencyCode ?? "USD",
        anchorAmount: attackCostInternal,
        turn: gameState?.currentTurn ?? 0,
        createdAt: now,
        sectorId: targetSector._id,
        sectorType: targetSector.sectorType,
        units: capitalStockDelta,
        meta: { reason: "sectorAttackCapture" },
      }).catch(() => {});
    }

    const sectorLabel =
      CORPORATION_TYPE_LABELS[targetSector.sectorType as CorporationType] ??
      targetSector.sectorType;
    const sectorHref = `${regionUrl(countryId, id)}?tab=economy&sector=${targetSector.sectorType}`;

    logWireEvent(
      "sector_attack",
      wireHeadlineSectorAttack(
        corporation.name,
        actualCapture,
        sectorLabel,
        defenderCorp.name,
        state.name
      ),
      { href: sectorHref }
    );

    // Log the economic action so the automation detector sees a unified
    // per-actor action timeline (attack-sector bypasses the AP action logger).
    void logEconomicAction(db, {
      characterId: corporation.ceoId,
      userId: auth.user.userId,
      actionType: "attackSector",
      targetState: stateId,
      turn: gameState?.currentTurn ?? 0,
      characterName: corporation.name,
      username: userDoc?.username,
      countryId,
      // attackCost (= attackCostInternal) and actualCapture are already ₳ (anchor);
      // msCost is marketing strength.
      corpCashCostAnchor: attackCost,
      msCost,
      capturedRevenueAnchor: actualCapture,
      currencyCode: attackerCurrencyCode,
      result: {
        success: true,
        message: `Captured $${actualCapture.toLocaleString()} from ${defenderCorp.name}`,
        fundsChange: -attackCostInCorpCapital,
      },
    }).catch(() => {});

    // Notify the defending CEO
    if (defenderCorp.userId && !defenderCorp.ceoVacant) {
      await createNotification({
        userId: defenderCorp.userId,
        type: "corp_sector_attacked",
        title: "Sector Attacked",
        message: `${corporation.name} captured $${actualCapture.toLocaleString()} from your ${sectorLabel} sector in ${state.name}.`,
        metadata: {
          attackerCorporationName: corporation.name,
          attackerCorporationId: corporation._id.toString(),
          sectorType: targetSector.sectorType,
          stateId,
          stateName: state.name,
          revenueLost: actualCapture,
        },
      });
    }

    return NextResponse.json({
      success: true,
      attackCost,
      attackCostInternal,
      msCost,
      revenueCaptured: actualCapture,
      defenderCorporationName: defenderCorp.name,
      nextSplitMsCost: calculateSplitMsCost(currentEscalation + 1),
      message: `Captured $${actualCapture.toLocaleString()} from ${defenderCorp.name}'s ${sectorLabel} sector (cost: $${attackCost.toLocaleString()} + ${msCost} MS)`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
