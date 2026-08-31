// POST /api/country/[code]/region/[id]/economy/attack-sector
// Attempt to split whole plants from a rival corporation in the same market.
import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { requireHumanSession } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { regionUrl } from "@/lib/urls";
import { runTransactionWithSessionRetry } from "@/lib/db/transactionWithRetry";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Corporation, CorporateSector, State, User, ImperialCharacter } from "@/lib/db/types";
import type { GameState } from "@/lib/db/types/gameState";
import {
  DEFAULT_PROFIT_MARGIN,
  DEFAULT_SECTOR_STARTING_WORKERS,
  CORPORATION_TYPE_LABELS,
} from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { z } from "zod";
import { logWireEvent } from "@/lib/wireEvent";
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
import { isCorporateSectorDuplicateKey } from "@/lib/corporations/sectorLocation";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { capacityRescaleRatio } from "@/lib/constants/capacityEconomy";
import { loadCommandEconomyBlockedCountries } from "@/lib/economy/queries/commandEconomyMarketGate";
import {
  calculatePlantSectorSplit,
  didPlantSectorSplitSucceed,
  type PlantSectorSplitQuote,
} from "@/lib/corporations/plantSectorSplit";
import { emitTx } from "@/lib/financialTxLog/emit";

const attackSectorSchema = z.object({ sectorId: z.string().length(24) });

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

interface SplitResolution {
  quote: PlantSectorSplitQuote;
  succeeded: boolean;
  randomRoll: number;
  attackCostLocal: number;
  defenderCorporationName: string;
  sectorType: CorporationType;
  plantsTransferred: number;
  capacityTransferred: number;
  bookValueTransferredAnchor: number;
}

interface SplitRejection {
  status: number;
  error: string;
}

class SplitConflictError extends Error {}

function auditableRandomRoll(): number {
  return randomInt(0, 1_000_000_000) / 1_000_000_000;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireHumanSession(request);
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    if (gameState?.corporationActionsPaused) {
      return NextResponse.json(
        { error: "Corporation actions are currently paused" },
        { status: 403 }
      );
    }

    if (!marketAtLeast(await getMarketSystemModeForDb(db), "plants")) {
      return NextResponse.json(
        { error: "Sector splits require the plants economy." },
        { status: 409 }
      );
    }

    const { code, id: stateId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, attackSectorSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    if (!ObjectId.isValid(parsed.data.sectorId)) {
      return NextResponse.json({ error: "Invalid sector ID" }, { status: 400 });
    }
    const targetSectorId = new ObjectId(parsed.data.sectorId);

    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) return NextResponse.json({ error: "State not found" }, { status: 404 });

    const blockedCountries = await loadCommandEconomyBlockedCountries(db, [countryId]);
    if (blockedCountries.has(countryId)) {
      return NextResponse.json(
        {
          error:
            "This market is state-controlled under a command economy and cannot be privately attacked.",
        },
        { status: 403 }
      );
    }

    const userDoc = await db
      .collection<User>("users")
      .findOne({ _id: new ObjectId(auth.user.userId) });
    let attacker: Corporation | null = null;
    if (userDoc?.activeCharacterType === "imperial" && userDoc.activeImperialCharacterId) {
      const imperial = await db.collection<ImperialCharacter>("imperialCharacters").findOne({
        _id: userDoc.activeImperialCharacterId,
        userId: new ObjectId(auth.user.userId),
      });
      if (imperial) {
        attacker = await db.collection<Corporation>("corporations").findOne({
          ceoId: imperial._id,
          ceoType: "imperial",
          ceoVacant: { $ne: true },
        });
      }
    } else {
      const character = await getCharacterByUserId(db, auth.user.userId);
      if (character) {
        attacker = await db
          .collection<Corporation>("corporations")
          .findOne({ ceoId: character._id, ceoVacant: { $ne: true } });
      }
    }
    if (!attacker) {
      return NextResponse.json({ error: "You don't own a corporation" }, { status: 400 });
    }

    const targetSector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne({ _id: targetSectorId, stateId });
    if (!targetSector) {
      return NextResponse.json({ error: "Sector not found" }, { status: 404 });
    }
    if (targetSector.corporationId.equals(attacker._id)) {
      return NextResponse.json({ error: "Cannot attack your own sector" }, { status: 400 });
    }

    const defender = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: targetSector.corporationId });
    if (!defender) {
      await db.collection<CorporateSector>("corporateSectors").deleteOne({ _id: targetSector._id });
      return NextResponse.json(
        {
          error:
            "That corporation has been dissolved. Its sector record was removed; refresh this market.",
        },
        { status: 404 }
      );
    }
    if (defender.countryOwnerId) {
      return NextResponse.json(
        { error: "Cannot attack state-owned corporations." },
        { status: 400 }
      );
    }
    if (defender.suspended) {
      return NextResponse.json(
        { error: "Cannot attack a corporation that is suspended pending privatization auction." },
        { status: 400 }
      );
    }

    if (
      !Number.isInteger(targetSector.plantCount) ||
      (targetSector.plantCount ?? 0) < 2 ||
      typeof targetSector.capacityBookAnchor !== "number" ||
      !Number.isFinite(targetSector.capacityBookAnchor) ||
      targetSector.capacityBookAnchor < 0
    ) {
      return NextResponse.json(
        {
          error:
            "This sector's whole-plant ledger is not ready yet. Try again after the next refresh.",
        },
        { status: 503 }
      );
    }

    const attackerFxRate = await getCorpFxRate(db, attacker);
    const attackerCurrencyCode = resolveCorpLiquidCurrencyCode(attacker);
    const randomRoll = auditableRandomRoll();
    let resolution: SplitResolution | null = null;
    let rejection: SplitRejection | null = null;
    // Production Mongo is standalone, so this body may run WITHOUT a transaction
    // (see `runTransactionWithSessionRetry`). The attacker is debited before the
    // plant writes, and on that path a later `SplitConflictError` will NOT roll
    // the debit back, so record what was taken and refund it by hand.
    let uncommittedDebit: { cashLocal: number; marketingStrength: number } | null = null;

    try {
      await runTransactionWithSessionRetry(getMongoClient, async (session) => {
        resolution = null;
        rejection = null;
        uncommittedDebit = null;

        // READ THESE IN SEQUENCE. A Mongo ClientSession cannot carry concurrent
        // operations. Issued through Promise.all, all four reads raced to be the
        // one that opens the transaction, each sending `startTransaction` at the
        // same txnNumber; the first won and every loser came back with
        // "Only servers in a sharded cluster can start a new transaction at the
        // active transaction number" (ticket #1239). Despite the wording that is
        // Mongo code 117 on an ordinary replica set, and because the race is in
        // OUR call pattern rather than in the session, retrying on a fresh
        // session cannot clear it: every attempt re-runs the same race.
        const freshAttacker = await db
          .collection<Corporation>("corporations")
          .findOne({ _id: attacker._id }, { session });
        const freshTarget = await db
          .collection<CorporateSector>("corporateSectors")
          .findOne({ _id: targetSectorId, stateId, corporationId: defender._id }, { session });
        const freshDefender = await db
          .collection<Corporation>("corporations")
          .findOne({ _id: defender._id }, { session });
        const existingOwnSector = await db.collection<CorporateSector>("corporateSectors").findOne(
          {
            stateId,
            sectorType: targetSector.sectorType,
            corporationId: attacker._id,
          },
          { session }
        );
        if (!freshAttacker || !freshTarget || !freshDefender) {
          rejection = {
            status: 409,
            error: "The target changed before the split began. Refresh and try again.",
          };
          return;
        }

        const defenderPlantCount = freshTarget.plantCount;
        const defenderBookValueAnchor = freshTarget.capacityBookAnchor;
        if (
          !Number.isInteger(defenderPlantCount) ||
          (defenderPlantCount ?? 0) < 2 ||
          typeof defenderBookValueAnchor !== "number" ||
          !Number.isFinite(defenderBookValueAnchor) ||
          defenderBookValueAnchor < 0
        ) {
          rejection = {
            status: 409,
            error: "The target's plant ledger changed. Refresh and try again.",
          };
          return;
        }
        if (
          existingOwnSector &&
          (!Number.isInteger(existingOwnSector.plantCount) ||
            typeof existingOwnSector.capacityBookAnchor !== "number" ||
            !Number.isFinite(existingOwnSector.capacityBookAnchor) ||
            existingOwnSector.capacityBookAnchor < 0)
        ) {
          rejection = {
            status: 503,
            error:
              "Your sector's whole-plant ledger is not ready yet. Try again after the next refresh.",
          };
          return;
        }

        const quote = calculatePlantSectorSplit({
          defenderPlantCount: defenderPlantCount as number,
          defenderBookValueAnchor,
          attackerMarketingStrength: freshAttacker.marketingStrength ?? 0,
          defenderMarketingStrength: freshDefender.marketingStrength ?? 0,
        });
        if (quote.plantsAtRisk <= 0) {
          rejection = { status: 400, error: "The defender must retain at least one plant." };
          return;
        }

        const capitalAnchor = corpLiquidCapitalToAnchor(
          freshAttacker.liquidCapital ?? 0,
          freshAttacker,
          attackerFxRate
        );
        if (capitalAnchor < quote.cashCostAnchor) {
          rejection = {
            status: 400,
            error: insufficientCapitalMessage(
              "Sector split",
              anchorToCorpLiquidCapital(quote.cashCostAnchor, freshAttacker, attackerFxRate),
              freshAttacker.liquidCapital,
              attackerCurrencyCode
            ),
          };
          return;
        }
        if ((freshAttacker.marketingStrength ?? 0) < quote.marketingStrengthCost) {
          rejection = {
            status: 400,
            error: `Insufficient marketing strength. This split costs ${quote.marketingStrengthCost} MS. You have ${roundMarketingStrength(freshAttacker.marketingStrength ?? 0)} MS.`,
          };
          return;
        }

        const attackCostLocal = anchorToCorpLiquidCapital(
          quote.cashCostAnchor,
          freshAttacker,
          attackerFxRate
        );
        const debit = await db.collection<Corporation>("corporations").updateOne(
          {
            _id: freshAttacker._id,
            liquidCapital: { $gte: attackCostLocal },
            marketingStrength: { $gte: quote.marketingStrengthCost },
          },
          {
            $inc: {
              liquidCapital: -attackCostLocal,
              marketingStrength: -quote.marketingStrengthCost,
            },
            $set: { updatedAt: new Date() },
          },
          { session }
        );
        if (debit.modifiedCount !== 1) {
          rejection = {
            status: 409,
            error: "Your corporation's resources changed. Refresh and try again.",
          };
          return;
        }
        // Only outside a transaction does this need undoing by hand; inside one
        // the abort reverses it for us.
        if (!session) {
          uncommittedDebit = {
            cashLocal: attackCostLocal,
            marketingStrength: quote.marketingStrengthCost,
          };
        }

        const succeeded = didPlantSectorSplitSucceed(quote.successProbability, randomRoll);
        let capacityTransferred = 0;
        let bookValueTransferredAnchor = 0;
        if (succeeded) {
          const openingCount = defenderPlantCount as number;
          const transferFraction = quote.plantsAtRisk / openingCount;
          const defenderCapacity =
            typeof freshTarget.capitalStock === "number" &&
            Number.isFinite(freshTarget.capitalStock)
              ? Math.max(0, freshTarget.capitalStock)
              : 0;
          capacityTransferred = defenderCapacity * transferFraction;
          bookValueTransferredAnchor = defenderBookValueAnchor * transferFraction;
          const now = new Date();

          const targetWrite = await db.collection<CorporateSector>("corporateSectors").updateOne(
            {
              _id: freshTarget._id,
              plantCount: openingCount,
              capitalStock: freshTarget.capitalStock,
              capacityBookAnchor: defenderBookValueAnchor,
            },
            {
              $set: {
                plantCount: openingCount - quote.plantsAtRisk,
                capitalStock: defenderCapacity - capacityTransferred,
                capacityBookAnchor: defenderBookValueAnchor - bookValueTransferredAnchor,
                updatedAt: now,
              },
            },
            { session }
          );
          if (targetWrite.modifiedCount !== 1) {
            throw new SplitConflictError("The target changed during the split.");
          }

          const attackerCapacity =
            capacityTransferred *
            capacityRescaleRatio(
              freshTarget.sectorType as CorporationType,
              freshTarget.strategyId,
              existingOwnSector?.strategyId
            );

          if (existingOwnSector) {
            const attackerWrite = await db
              .collection<CorporateSector>("corporateSectors")
              .updateOne(
                { _id: existingOwnSector._id },
                {
                  $inc: {
                    plantCount: quote.plantsAtRisk,
                    capitalStock: attackerCapacity,
                    capacityBookAnchor: bookValueTransferredAnchor,
                  },
                  $set: { updatedAt: now },
                },
                { session }
              );
            if (attackerWrite.modifiedCount !== 1) {
              throw new SplitConflictError("Your sector changed during the split.");
            }
          } else {
            const newSector: Omit<CorporateSector, "_id"> = {
              corporationId: freshAttacker._id,
              countryId,
              stateId,
              sectorType: freshTarget.sectorType as CorporationType,
              targetGrowthRate: 0,
              currentGrowthRate: 0,
              currentGrowthCost: 0,
              // PLANTS-GATED: this route requires plants mode; the turn derives
              // revenue from the transferred whole plants and their capacity.
              revenue: 0,
              capitalStock: attackerCapacity,
              capacityBookAnchor: bookValueTransferredAnchor,
              plantCount: quote.plantsAtRisk,
              plantUnitRemainder: 0,
              plantsStartTurn: gameState?.currentTurn ?? 0,
              profitMargin: DEFAULT_PROFIT_MARGIN,
              workers: DEFAULT_SECTOR_STARTING_WORKERS,
              createdAt: now,
              updatedAt: now,
            };
            try {
              await db
                .collection<CorporateSector>("corporateSectors")
                .insertOne(newSector as CorporateSector, { session });
            } catch (error) {
              if (isCorporateSectorDuplicateKey(error)) {
                throw new SplitConflictError("Your sector changed during the split.");
              }
              throw error;
            }
          }
        }

        resolution = {
          quote,
          succeeded,
          randomRoll,
          attackCostLocal,
          defenderCorporationName: freshDefender.name,
          sectorType: freshTarget.sectorType as CorporationType,
          plantsTransferred: succeeded ? quote.plantsAtRisk : 0,
          capacityTransferred,
          bookValueTransferredAnchor,
        };
        uncommittedDebit = null;
      });
    } catch (error) {
      // Non-atomic path only: the cash and MS were already taken and no plant
      // moved, so give them back before answering. Failing to refund would
      // charge the attacker for a split that never happened.
      const pendingRefund = uncommittedDebit as {
        cashLocal: number;
        marketingStrength: number;
      } | null;
      if (pendingRefund) {
        uncommittedDebit = null;
        await db
          .collection<Corporation>("corporations")
          .updateOne(
            { _id: attacker._id },
            {
              $inc: {
                liquidCapital: pendingRefund.cashLocal,
                marketingStrength: pendingRefund.marketingStrength,
              },
              $set: { updatedAt: new Date() },
            }
          )
          .catch(() => {});
      }
      if (error instanceof SplitConflictError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }

    const rejected = rejection as SplitRejection | null;
    if (rejected) {
      return NextResponse.json({ error: rejected.error }, { status: rejected.status });
    }
    if (!resolution) {
      return NextResponse.json({ error: "The split could not be resolved." }, { status: 409 });
    }

    const result: SplitResolution = resolution;
    const sectorLabel = CORPORATION_TYPE_LABELS[result.sectorType] ?? result.sectorType;
    const outcomeText = result.succeeded
      ? `${attacker.name} seized ${result.plantsTransferred.toLocaleString("en-US")} whole plants from ${result.defenderCorporationName}'s ${sectorLabel} sector in ${state.name}.`
      : `${attacker.name} failed to split ${result.defenderCorporationName}'s ${sectorLabel} sector in ${state.name}.`;
    logWireEvent("sector_attack", outcomeText, {
      href: `${regionUrl(countryId, stateId)}?tab=economy&sector=${result.sectorType}`,
    });

    void emitTx(db, {
      type: "corp_sector_split_cost",
      turn: gameState?.currentTurn ?? 0,
      createdAt: new Date(),
      subjectType: "corporation",
      subjectId: attacker._id,
      subjectName: attacker.name,
      countryId,
      amount: -Math.abs(result.attackCostLocal),
      anchorAmount: -Math.abs(result.quote.cashCostAnchor),
      currencyCode: attackerCurrencyCode ?? "USD",
      counterpartyType: "system",
      counterpartyName: "Sector split campaign",
      meta: {
        targetSectorId: targetSectorId.toString(),
        defenderCorporationId: defender._id.toString(),
        plantsAtRisk: result.quote.plantsAtRisk,
        plantsTransferred: result.plantsTransferred,
        successProbability: result.quote.successProbability,
        randomRoll: result.randomRoll,
        succeeded: result.succeeded,
      },
    }).catch(() => {});

    void logEconomicAction(db, {
      characterId: attacker.ceoId,
      userId: auth.user.userId,
      actionType: "attackSector",
      targetState: stateId,
      turn: gameState?.currentTurn ?? 0,
      characterName: attacker.name,
      username: userDoc?.username,
      countryId,
      corpCashCostAnchor: result.quote.cashCostAnchor,
      msCost: result.quote.marketingStrengthCost,
      currencyCode: attackerCurrencyCode,
      result: {
        success: result.succeeded,
        message: outcomeText,
        fundsChange: -result.attackCostLocal,
      },
    }).catch(() => {});

    if (defender.userId && !defender.ceoVacant) {
      await createNotification({
        userId: defender.userId,
        type: "corp_sector_attacked",
        title: result.succeeded ? "Plants Seized" : "Sector Split Repelled",
        message: outcomeText,
        metadata: {
          attackerCorporationName: attacker.name,
          attackerCorporationId: attacker._id.toString(),
          sectorType: result.sectorType,
          stateId,
          stateName: state.name,
          plantsLost: result.plantsTransferred,
          splitSucceeded: result.succeeded,
        },
      });
    }

    return NextResponse.json({
      success: true,
      splitSucceeded: result.succeeded,
      plantsAtRisk: result.quote.plantsAtRisk,
      plantsTransferred: result.plantsTransferred,
      attackCost: result.quote.cashCostAnchor,
      msCost: result.quote.marketingStrengthCost,
      successProbability: result.quote.successProbability,
      message: result.succeeded
        ? `Sector split succeeded. You seized ${result.plantsTransferred.toLocaleString("en-US")} whole plants from ${result.defenderCorporationName}.`
        : `Sector split failed. No plants transferred; the committed cash and MS were spent.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
