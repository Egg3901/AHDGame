/**
 * POST /api/corporations/[id]/sectors/[sectorId]/buy
 * Buy a sector that the seller corp has listed for sale.
 *
 * Body: { buyerCorporationId: string }
 *
 * - Buyer's CEO (logged-in user) authorizes the purchase. The buyer corp's
 *   `liquidCapital` is debited in its home currency; the seller corp's
 *   `liquidCapital` is credited in its home currency. Both conversions go
 *   through ₳ at current FX rates.
 * - Sector ownership is transferred to the buyer corp. Sector revenue and
 *   currentGrowthCost are stored in the sector's HOST-state currency, which is
 *   invariant to ownership, so they carry over unchanged (no re-denomination).
 * - If the buyer already operates that sector type in that state, the purchased
 *   sector is merged into the existing one: revenue and workers are summed,
 *   profit margin is revenue-weighted, then the purchased sector doc is deleted.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { applyBrandFacilityLoss } from "@/lib/corporations/brandFacilityLoss";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { schemas } from "@/lib/api/validate";
import type { Corporation, CorporateSector, State } from "@/lib/db/types";
import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";
import {
  anchorToCorpLiquidCapital,
  getCorpFxRate,
  getSectorHostFxRate,
  resolveCorpLiquidCurrencyCode,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { safeDistributeConversionSpread } from "@/lib/currency/marketMaker";
import { sectorFxSpreadBetween } from "@/lib/currency/sectorFxSpread";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import {
  atomicallyDebitCorpLiquidCapital,
  refundCorpLiquidCapital,
} from "@/lib/financialTxLog/atomicCashGuard";
import { emitTx } from "@/lib/financialTxLog/emit";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { logEconomicAction } from "@/lib/corporations/economicActionLog";
import { createNotification } from "@/lib/notifications";
import { isCorporateSectorDuplicateKey } from "@/lib/corporations/sectorLocation";
import {
  identitySectorPlantFields,
  mergeSectorPlantFields,
} from "@/lib/corporations/sectorTransferCapex";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { clampProductionPolicy } from "@/lib/utils/productionPolicy";

const buySectorSchema = z.object({
  buyerCorporationId: schemas.objectId,
});

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

export async function buyListedSector(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(`sector-buy:${auth.user.userId}`, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, sectorId } = await params;
    const parsed = await parseJsonBody(request, buySectorSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { buyerCorporationId } = parsed.data;

    if (!ObjectId.isValid(sectorId)) {
      return NextResponse.json({ error: "Invalid sector ID" }, { status: 400 });
    }

    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    const sellerResolved = await resolveCorporation(db, id);
    if (!sellerResolved.ok) return sellerResolved.response;
    const seller = sellerResolved.corporation;

    const buyer = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: new ObjectId(buyerCorporationId) });
    if (!buyer) {
      return NextResponse.json({ error: "Buyer corporation not found" }, { status: 404 });
    }

    if (buyer._id.equals(seller._id)) {
      return NextResponse.json(
        { error: "A corporation cannot buy its own sector" },
        { status: 400 }
      );
    }

    if (buyer.ceoVacant === true || !buyer.userId || buyer.userId.toString() !== auth.user.userId) {
      return NextResponse.json(
        { error: "You must be the CEO of the buying corporation" },
        { status: 403 }
      );
    }

    const sector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne({ _id: new ObjectId(sectorId), corporationId: seller._id });
    if (!sector) {
      return NextResponse.json({ error: "Sector not found" }, { status: 404 });
    }

    if (!sector.forSale) {
      return NextResponse.json(
        { error: "Sector is not currently listed for sale" },
        { status: 400 }
      );
    }

    // If the buyer already operates this sector type in this state, allow the
    // purchase but merge the acquired sector into the existing one rather than
    // transferring it (which would violate the unique index).
    const existingBuyerSector = await db.collection<CorporateSector>("corporateSectors").findOne({
      corporationId: buyer._id,
      stateId: sector.stateId,
      sectorType: sector.sectorType,
    });

    const priceAnchor = sector.forSale.priceAnchor;
    if (!Number.isFinite(priceAnchor) || priceAnchor <= 0) {
      return NextResponse.json(
        { error: "Listing price is invalid; ask the seller to relist." },
        { status: 400 }
      );
    }

    // Pull live FX rates for both sides — the seller and buyer can be on
    // different home currencies (forex aware). Each conversion goes through ₳.
    const [buyerFxRate, sellerFxRate] = await Promise.all([
      getCorpFxRate(db, buyer),
      getCorpFxRate(db, seller),
    ]);

    const buyerCurrency = resolveCorpLiquidCurrencyCode(buyer);
    const sellerCurrency = resolveCorpLiquidCurrencyCode(seller);

    // Cross-currency acquisition: the buyer pays the reduced sector FX spread on
    // top of the price (the seller still receives the plain price). Routed below.
    const acqSpread = sectorFxSpreadBetween(
      buyerCurrency as CurrencyCode | null,
      sellerCurrency as CurrencyCode | null,
      priceAnchor
    );
    const priceInBuyerCapital = Math.round(
      anchorToCorpLiquidCapital(priceAnchor + acqSpread.spreadAnchor, buyer, buyerFxRate)
    );
    const priceInSellerCapital = Math.round(
      anchorToCorpLiquidCapital(priceAnchor, seller, sellerFxRate)
    );

    // Atomic balance-gated debit on the buyer's corp. Race-safe: a concurrent
    // bond purchase or share buy from the same corp cannot drain liquidCapital
    // out from under us.
    const buyerDebit = await atomicallyDebitCorpLiquidCapital(db, buyer._id, priceInBuyerCapital);
    if (!buyerDebit.ok) {
      return NextResponse.json(
        {
          error: `Insufficient corporate funds. Need ${priceInBuyerCapital.toLocaleString()} ${
            buyerCurrency ?? "USD"
          } to purchase this sector.`,
        },
        { status: 400 }
      );
    }

    const now = new Date();
    let sellerCredited = false;

    // Sector economic fields are stored in the sector's HOST-state currency,
    // which is invariant to ownership — so revenue/growthCost carry over
    // unchanged when the sector changes hands (no seller→buyer re-denomination).
    // Normalize to ₳ at the host rate for the captured-revenue records and merge
    // math below; the stored local values stay in host currency (identity).
    const sectorHostCurrency = resolveSectorHostCurrencyCode(sector, seller);
    const sectorHostFxRate = await getSectorHostFxRate(db, sector, seller);
    const revenueAnchor = readCorpEconomicAnchor(
      sector.revenue,
      sectorHostCurrency,
      sectorHostFxRate
    );
    const newRevenueLocal = Math.round(sector.revenue ?? 0);
    const newGrowthCostLocal = Math.round(sector.currentGrowthCost ?? 0);

    const turn = await getCurrentTurn(db).catch(() => 0);
    const stateDoc = await db
      .collection<State>("states")
      .findOne({ _id: sector.stateId }, { projection: { name: 1 } });
    const stateName = stateDoc?.name ?? sector.stateId;
    const sectorLabel =
      CORPORATION_TYPE_LABELS[sector.sectorType as CorporationType] ?? sector.sectorType;

    if (existingBuyerSector) {
      // Brand facility-loss (Boeing rule): the seller is losing this sector, so
      // dent its brand proportional to the sector's share of the seller's
      // revenue. Called while the seller still owns it (aggregate includes it).
      // No-op when the seller has no loyalty. Best-effort — loyalty recomputes
      // each turn, so a rare post-call failure self-heals.
      await applyBrandFacilityLoss(db, seller._id, sector.revenue);

      // ── Merge path ──────────────────────────────────────────────────────────
      // Buyer already owns this sector type in this state. Claim the listing
      // atomically, merge stats into the existing sector, then delete the
      // purchased doc.
      const claimResult = await db
        .collection<CorporateSector>("corporateSectors")
        .updateOne(
          { _id: sector._id, corporationId: seller._id, forSale: { $ne: null } },
          { $unset: { forSale: "" }, $set: { updatedAt: now } }
        );
      if (claimResult.matchedCount === 0) {
        await refundCorpLiquidCapital(db, buyer._id, priceInBuyerCapital);
        return NextResponse.json(
          { error: "Listing was unlisted or already sold. Refresh and try another sector." },
          { status: 409 }
        );
      }

      // Resolved before the try so the catch's rollback branch sees the same
      // tier the forward merge used.
      const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
      let mergeApplied = false;
      try {
        const combinedRevenue = existingBuyerSector.revenue + newRevenueLocal;
        const combinedWorkers = existingBuyerSector.workers + sector.workers;
        const weightedMargin =
          combinedRevenue > 0
            ? (existingBuyerSector.profitMargin * existingBuyerSector.revenue +
                sector.profitMargin * newRevenueLocal) /
              combinedRevenue
            : existingBuyerSector.profitMargin;
        const combinedGrowthCost =
          (existingBuyerSector.currentGrowthCost ?? 0) + newGrowthCostLocal;
        const weightedProductionPolicyLevel =
          combinedRevenue > 0
            ? clampProductionPolicy(
                Math.round(
                  ((existingBuyerSector.productionPolicyLevel ?? 0) * existingBuyerSector.revenue +
                    (sector.productionPolicyLevel ?? 0) * newRevenueLocal) /
                    combinedRevenue
                )
              )
            : (existingBuyerSector.productionPolicyLevel ?? 0);
        const weightedNegativeProductionTurns =
          combinedRevenue > 0
            ? Math.round(
                ((existingBuyerSector.negativeProductionSustainedTurns ?? 0) *
                  existingBuyerSector.revenue +
                  (sector.negativeProductionSustainedTurns ?? 0) * newRevenueLocal) /
                  combinedRevenue
              )
            : (existingBuyerSector.negativeProductionSustainedTurns ?? 0);

        // The purchased doc is deleted on the next line, so its plant state
        // must be folded into the survivor first: capacity, the outstanding
        // build queue, and the ₳ of construction-in-progress the buyer just
        // paid for as part of the listing price. Pre-fix the merge path
        // destroyed all three — the buyer paid a price that included
        // in-flight construction and received nothing, and the CIP simply
        // left the world's balance sheet. `constructionInProgressAnchor` and
        // each order's `costPaidAnchor` are ₳ and are summed, NOT re-converted
        // through either corp's currency (see sectorTransferCapex).
        //
        // Gated on the tier, like every other plant-state writer (see
        // privatizeAsset and moveSectorToCorp). Spreading it unconditionally
        // stamped `buildQueue: []`, `constructionInProgressAnchor: 0`,
        // `mothballed: false` and `plantsStartTurn: null` onto rows in modes
        // that have no such concepts, and — worse — SUMMED `capitalStock`, a
        // field capital mode owns and re-derives from revenue every turn.
        const mergedPlant = plantsEnabled
          ? mergeSectorPlantFields(existingBuyerSector, sector)
          : {};
        await db.collection<CorporateSector>("corporateSectors").updateOne(
          { _id: existingBuyerSector._id },
          {
            $set: {
              // Under plants the plant-state fold below is what carries value
              // across the merge; this nameplate is a one-turn placeholder.
              // PLANTS-GATED: restated from merged `capitalStock` next tick.
              revenue: combinedRevenue,
              workers: combinedWorkers,
              profitMargin: weightedMargin,
              currentGrowthCost: combinedGrowthCost,
              productionPolicyLevel: weightedProductionPolicyLevel,
              negativeProductionSustainedTurns: weightedNegativeProductionTurns,
              ...mergedPlant,
              updatedAt: now,
            },
          }
        );
        await db.collection<CorporateSector>("corporateSectors").deleteOne({ _id: sector._id });
        mergeApplied = true;

        await db
          .collection<Corporation>("corporations")
          .updateOne(
            { _id: seller._id },
            { $inc: { liquidCapital: priceInSellerCapital }, $set: { updatedAt: now } }
          );
        sellerCredited = true;

        await Promise.all([
          emitTx(db, {
            type: "corp_sector_purchase",
            turn,
            createdAt: now,
            subjectType: "corporation",
            subjectId: buyer._id,
            subjectName: buyer.name,
            amount: -priceInBuyerCapital,
            balanceAfter: buyerDebit.newBalance,
            currencyCode: buyerCurrency ?? "USD",
            counterpartyType: "corporation",
            counterpartyId: seller._id,
            counterpartyName: seller.name,
            meta: {
              kind: "sector_purchase_merge",
              sectorId: sector._id.toString(),
              mergedIntoSectorId: existingBuyerSector._id.toString(),
              sectorType: sector.sectorType,
              stateId: sector.stateId,
              stateName,
              sectorLabel,
              priceAnchor,
            },
          }),
          emitTx(db, {
            type: "corp_sector_sale",
            turn,
            createdAt: now,
            subjectType: "corporation",
            subjectId: seller._id,
            subjectName: seller.name,
            amount: priceInSellerCapital,
            balanceAfter: (seller.liquidCapital ?? 0) + priceInSellerCapital,
            currencyCode: sellerCurrency ?? "USD",
            counterpartyType: "corporation",
            counterpartyId: buyer._id,
            counterpartyName: buyer.name,
            meta: {
              kind: "sector_sale",
              sectorId: sector._id.toString(),
              sectorType: sector.sectorType,
              stateId: sector.stateId,
              stateName,
              sectorLabel,
              priceAnchor,
            },
          }),
        ]);

        void logEconomicAction(db, {
          characterId: buyer.ceoId,
          userId: auth.user.userId,
          actionType: "buySector",
          targetState: sector.stateId,
          turn,
          characterName: buyer.name,
          countryId: buyer.countryId,
          // priceAnchor + acquisition spread is the buyer's total ₳ (anchor) cost;
          // revenueAnchor is the acquired sector's revenue normalized to ₳.
          corpCashCostAnchor: priceAnchor + acqSpread.spreadAnchor,
          capturedRevenueAnchor: revenueAnchor,
          currencyCode: buyerCurrency ?? undefined,
          result: {
            success: true,
            message: `${buyer.name} bought ${sectorLabel} sector in ${stateName}`,
          },
        }).catch(() => {});

        void createNotification({
          userId: seller.userId,
          type: "corp_sector_sold",
          title: "Sector Sold",
          message: `Your ${sectorLabel} sector in ${stateName} was purchased by ${buyer.name} for ${priceInSellerCapital.toLocaleString()} ${sellerCurrency ?? "USD"}.`,
          metadata: {
            sectorType: sector.sectorType,
            sectorLabel,
            stateId: sector.stateId.toString(),
            stateName,
            buyerCorporationId: buyer._id.toString(),
            buyerName: buyer.name,
            priceAnchor,
          },
        });

        if (acqSpread.spreadAnchor > 0 && acqSpread.from && acqSpread.to) {
          await safeDistributeConversionSpread(
            db,
            Math.round(anchorToCorpLiquidCapital(acqSpread.spreadAnchor, buyer, buyerFxRate)),
            acqSpread.from,
            acqSpread.to
          );
        }
        return NextResponse.json({
          success: true,
          message: `Merged ${sectorLabel} sector in ${stateName} into your existing sector for ${priceInBuyerCapital.toLocaleString()} ${
            buyerCurrency ?? "USD"
          }.`,
          priceAnchor,
          priceInBuyerCapital,
          priceInSellerCapital,
          spreadPaid: Math.round(
            anchorToCorpLiquidCapital(acqSpread.spreadAnchor, buyer, buyerFxRate)
          ),
          buyerCurrency: buyerCurrency ?? "USD",
          sellerCurrency: sellerCurrency ?? "USD",
          merged: true,
        });
      } catch (error) {
        if (!mergeApplied) {
          await db
            .collection<CorporateSector>("corporateSectors")
            .updateOne(
              { _id: sector._id, corporationId: seller._id },
              { $set: { forSale: sector.forSale, updatedAt: new Date() } }
            );
        } else if (!sellerCredited) {
          // Sector was merged+deleted but seller wasn't credited. Restore the
          // existing sector's original stats and recreate the seller's sector.
          await db.collection<CorporateSector>("corporateSectors").updateOne(
            { _id: existingBuyerSector._id },
            {
              $set: {
                // Failure path: restore the survivor's own snapshot.
                // PLANTS-GATED: correct in every mode; under plants the paired
                // identitySectorPlantFields fold below puts the capacity back.
                revenue: existingBuyerSector.revenue,
                workers: existingBuyerSector.workers,
                profitMargin: existingBuyerSector.profitMargin,
                currentGrowthCost: existingBuyerSector.currentGrowthCost ?? 0,
                // Undo the plant fold too, or the rollback leaves the survivor
                // holding the recreated sector's capacity AND the recreated
                // sector holding it as well — duplicated plants. This must be
                // a true IDENTITY: `mergeSectorPlantFields(survivor, {})` is
                // not one, because `mothballed` is an AND and an empty second
                // argument un-mothballed a survivor that was idle before the
                // purchase, silently putting its capacity back into production.
                ...(plantsEnabled ? identitySectorPlantFields(existingBuyerSector) : {}),
                updatedAt: new Date(),
              },
            }
          );
          await db.collection<CorporateSector>("corporateSectors").insertOne({
            ...sector,
            forSale: sector.forSale,
            updatedAt: new Date(),
          });
        }
        await refundCorpLiquidCapital(db, buyer._id, priceInBuyerCapital);
        throw error;
      }
    }

    // ── Transfer path ──────────────────────────────────────────────────────────
    // Buyer does not yet operate this sector type in this state: standard
    // ownership transfer.
    let sectorTransferred = false;
    try {
      // Transfer sector ownership atomically. Guard with the seller corp id +
      // forSale presence so a concurrent unlist or another buy attempt can't
      // double-spend the listing.
      try {
        const transferResult = await db.collection<CorporateSector>("corporateSectors").updateOne(
          { _id: sector._id, corporationId: seller._id, forSale: { $ne: null } },
          {
            $set: {
              corporationId: buyer._id,
              // PLANTS-GATED: reassign path — the doc keeps its own plant
              // state, and under plants `revenue` is restated from that
              // capacity next turn regardless of the value written here.
              revenue: newRevenueLocal,
              currentGrowthCost: newGrowthCostLocal,
              updatedAt: now,
            },
            $unset: { forSale: "" },
          }
        );
        if (transferResult.matchedCount === 0) {
          await refundCorpLiquidCapital(db, buyer._id, priceInBuyerCapital);
          return NextResponse.json(
            {
              error: "Listing was unlisted or already sold. Refresh and try another sector.",
            },
            { status: 409 }
          );
        }
      } catch (error) {
        if (isCorporateSectorDuplicateKey(error)) {
          await refundCorpLiquidCapital(db, buyer._id, priceInBuyerCapital);
          return NextResponse.json(
            {
              error: `Your corporation already operates a ${
                CORPORATION_TYPE_LABELS[sector.sectorType as CorporationType]
              } sector in this state.`,
            },
            { status: 400 }
          );
        }
        throw error;
      }
      sectorTransferred = true;

      // Credit the seller corp's liquidCapital in seller currency.
      await db.collection<Corporation>("corporations").updateOne(
        { _id: seller._id },
        {
          $inc: { liquidCapital: priceInSellerCapital },
          $set: { updatedAt: now },
        }
      );
      sellerCredited = true;

      await Promise.all([
        emitTx(db, {
          type: "corp_sector_purchase",
          turn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: buyer._id,
          subjectName: buyer.name,
          amount: -priceInBuyerCapital,
          balanceAfter: buyerDebit.newBalance,
          currencyCode: buyerCurrency ?? "USD",
          counterpartyType: "corporation",
          counterpartyId: seller._id,
          counterpartyName: seller.name,
          meta: {
            kind: "sector_purchase",
            sectorId: sector._id.toString(),
            sectorType: sector.sectorType,
            stateId: sector.stateId,
            stateName,
            sectorLabel,
            priceAnchor,
          },
        }),
        emitTx(db, {
          type: "corp_sector_sale",
          turn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: seller._id,
          subjectName: seller.name,
          amount: priceInSellerCapital,
          balanceAfter: (seller.liquidCapital ?? 0) + priceInSellerCapital,
          currencyCode: sellerCurrency ?? "USD",
          counterpartyType: "corporation",
          counterpartyId: buyer._id,
          counterpartyName: buyer.name,
          meta: {
            kind: "sector_sale",
            sectorId: sector._id.toString(),
            sectorType: sector.sectorType,
            stateId: sector.stateId,
            stateName,
            sectorLabel,
            priceAnchor,
          },
        }),
      ]);

      void logEconomicAction(db, {
        characterId: buyer.ceoId,
        userId: auth.user.userId,
        actionType: "buySector",
        targetState: sector.stateId,
        turn,
        characterName: buyer.name,
        countryId: buyer.countryId,
        // priceAnchor + acquisition spread is the buyer's total ₳ (anchor) cost;
        // revenueAnchor is the acquired sector's revenue normalized to ₳.
        corpCashCostAnchor: priceAnchor + acqSpread.spreadAnchor,
        capturedRevenueAnchor: revenueAnchor,
        currencyCode: buyerCurrency ?? undefined,
        result: {
          success: true,
          message: `${buyer.name} bought ${sectorLabel} sector in ${stateName}`,
        },
      }).catch(() => {});

      void createNotification({
        userId: seller.userId,
        type: "corp_sector_sold",
        title: "Sector Sold",
        message: `Your ${sectorLabel} sector in ${stateName} was purchased by ${buyer.name} for ${priceInSellerCapital.toLocaleString()} ${sellerCurrency ?? "USD"}.`,
        metadata: {
          sectorType: sector.sectorType,
          sectorLabel,
          stateId: sector.stateId.toString(),
          stateName,
          buyerCorporationId: buyer._id.toString(),
          buyerName: buyer.name,
          priceAnchor,
        },
      });

      if (acqSpread.spreadAnchor > 0 && acqSpread.from && acqSpread.to) {
        await safeDistributeConversionSpread(
          db,
          Math.round(anchorToCorpLiquidCapital(acqSpread.spreadAnchor, buyer, buyerFxRate)),
          acqSpread.from,
          acqSpread.to
        );
      }
      return NextResponse.json({
        success: true,
        message: `Acquired ${sectorLabel} sector in ${stateName} for ${priceInBuyerCapital.toLocaleString()} ${
          buyerCurrency ?? "USD"
        }.`,
        priceAnchor,
        priceInBuyerCapital,
        priceInSellerCapital,
        spreadPaid: Math.round(
          anchorToCorpLiquidCapital(acqSpread.spreadAnchor, buyer, buyerFxRate)
        ),
        buyerCurrency: buyerCurrency ?? "USD",
        sellerCurrency: sellerCurrency ?? "USD",
      });
    } catch (error) {
      // Roll back any partial state. If the sector transferred but the seller
      // wasn't credited, return the sector to the seller and refund the buyer
      // so neither side ends up with stolen value.
      if (sectorTransferred && !sellerCredited) {
        await db.collection<CorporateSector>("corporateSectors").updateOne(
          { _id: sector._id, corporationId: buyer._id },
          {
            $set: {
              corporationId: seller._id,
              // PLANTS-GATED: failure-path restore of the seller's own
              // pre-transfer snapshot; plant state never left the doc.
              revenue: sector.revenue,
              currentGrowthCost: sector.currentGrowthCost ?? 0,
              forSale: sector.forSale,
              updatedAt: new Date(),
            },
          }
        );
        await refundCorpLiquidCapital(db, buyer._id, priceInBuyerCapital);
      } else if (!sectorTransferred) {
        await refundCorpLiquidCapital(db, buyer._id, priceInBuyerCapital);
      }
      throw error;
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
