/** Cancel and refund boundary-related construction before changing ownership or currency. */
import { ObjectId, type Db, type AnyBulkWriteOperation } from "mongodb";
import type { Corporation, CorporateSector, GameState } from "@/lib/db/types";
import { boundSession } from "@/lib/db/sessionDb";
import { cancelFinancedConstruction } from "@/lib/banking/constructionCancellation";
import {
  acquireConstructionFundingLease,
  abortUnfundedConstruction,
  releaseCompletedConstructionFunding,
} from "@/lib/banking/constructionFundingLease";
import { rejectConstructionFinance } from "@/lib/banking/constructionFinance";
import { settleReservedConstruction } from "@/lib/banking/constructionSettlement";
import { loadBankingSnapshot } from "@/lib/banking/snapshot";
import { loadBorrowerSnapshot } from "@/lib/banking/lending";
import {
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
  anchorToCorpLiquidCapital,
} from "@/lib/currency/corporationCapital";
import { emitBuildCapexTxBulk, type BuildCapexTxInput } from "@/lib/corporations/capexTxLog";
import { unownedPoolCredit } from "@/lib/market/unownedPoolDraw";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import { resolvePresetIdFromGameState } from "@/lib/world/countryReadinessContract";
import { quoteConversionConstructionRefund } from "./rules/constructionRefund";
import { cancelConversionUnderwriting } from "@/lib/banking/cancelConversionUnderwriting";

async function cancelSecuredBuild(db: Db, sector: CorporateSector, turn: number) {
  let claim = sector.constructionFinancing!;
  if (claim.status === "awaiting_approval") {
    const rejected = await rejectConstructionFinance(
      db,
      new ObjectId(claim.bankId),
      new ObjectId(claim.loanId),
      true,
      "Boundary conversion"
    );
    if (!rejected.ok) throw new Error(rejected.error);
    return;
  }
  if (claim.status === "funding") {
    if (await acquireConstructionFundingLease(db, claim)) {
      if (await abortUnfundedConstruction(db, claim, sector._id, turn)) return;
    }
    // A bank debit which already landed must finish its frozen receipt before cancellation.
    const bank = await loadBankingSnapshot(db, new ObjectId(claim.bankId));
    if (!bank?.corporation.bankCharter) throw new Error("Construction lender is unavailable");
    const borrower = await loadBorrowerSnapshot(
      db,
      bank.corporation.bankCharter,
      bank.snapshot.currency,
      { type: "corporation", id: sector.corporationId },
      turn
    );
    if ("error" in borrower) throw new Error(borrower.error);
    const settled = await settleReservedConstruction({
      db,
      enabled: true,
      sectorId: sector._id,
      bank: bank.snapshot,
      borrower: borrower.snapshot,
    });
    if (!settled.ok) throw new Error(settled.error);
    const updated = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne({ _id: sector._id }, { projection: { constructionFinancing: 1 } });
    claim = updated!.constructionFinancing!;
  }
  if (claim.status === "building" && !(await releaseCompletedConstructionFunding(db, claim)))
    throw new Error("Construction funding acknowledgement remains pending");
  const cancelled = await cancelFinancedConstruction({
    db,
    enabled: true,
    sectorId: sector._id,
    borrowerId: sector.corporationId,
    turn,
    fullRefund: true,
  });
  if (!cancelled.ok) throw new Error(cancelled.error);
}

export async function refundConversionConstruction(
  db: Db,
  regionId: string,
  turn: number
): Promise<void> {
  if (!boundSession(db)) throw new Error("Conversion refunds require a transaction");
  const corporations = await db
    .collection<Corporation>("corporations")
    .find({ headquartersState: regionId })
    .toArray();
  const ids = corporations.map((corp) => corp._id);
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      { $or: [{ stateId: regionId }, { corporationId: { $in: ids } }] },
      {
        projection: {
          corporationId: 1,
          stateId: 1,
          countryId: 1,
          sectorType: 1,
          industryModel: 1,
          mediaDiscriminator: 1,
          buildQueue: 1,
          constructionFinancing: 1,
          constructionPropertyTransition: 1,
          capitalStock: 1,
          capacityBookAnchor: 1,
          operatingCapacityTurn: 1,
        },
      }
    )
    .toArray();
  const owners = await db
    .collection<Corporation>("corporations")
    .find({ _id: { $in: sectors.map((sector) => sector.corporationId) } })
    .toArray();
  const byId = new Map(owners.map((corp) => [String(corp._id), corp]));
  // Foreign sector owners keep their unrelated corporate underwriting; only their local builds cancel.
  await cancelConversionUnderwriting(db, ids, turn);
  const fx = await loadFxRatesByCurrency(db);
  const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const era = getEraUnitScale(resolvePresetIdFromGameState(gameState));
  const sectorOps: AnyBulkWriteOperation<CorporateSector>[] = [];
  const refunds = new Map<string, number>();
  const poolOps: AnyBulkWriteOperation[] = [];
  const logs: BuildCapexTxInput[] = [];
  // An asking price cannot survive removal of the capacity it advertised. No sale cash is prepaid.
  const pendingIds = sectors
    .filter(
      (sector) =>
        sector.buildQueue?.length ||
        ["awaiting_approval", "funding"].includes(sector.constructionFinancing?.status ?? "")
    )
    .map((sector) => sector._id);
  if (pendingIds.length) {
    const unlisted = await db.collection<CorporateSector>("corporateSectors").updateMany(
      {
        _id: { $in: pendingIds },
        constructionPropertyTransition: { $exists: false },
        "constructionFinancing.foreclosure": { $exists: false },
      },
      { $unset: { forSale: "" } }
    );
    if (unlisted.matchedCount !== pendingIds.length)
      throw new Error("A construction sale or foreclosure must settle before conversion");
  }
  // Finish financed receipts first, then reload all queues once so mixed queues are also refunded.
  const settleSecured = async (sector: CorporateSector) => {
    const claim = sector.constructionFinancing;
    if (!claim) {
      if (sector.buildQueue?.some((order) => order.constructionLoanId))
        throw new Error("Financed order has no collateral record");
      return;
    }
    const hasOrder = sector.buildQueue?.some(
      (order) => order.constructionClaimId === claim.claimId
    );
    if (
      ["awaiting_approval", "funding"].includes(claim.status) ||
      hasOrder ||
      (claim.cancellation && !claim.cancellation.cleanupCompleted)
    ) {
      await cancelSecuredBuild(db, sector, turn);
    } else if (claim.status === "building" && !claim.fundingCleanupCompleted) {
      // A fully delivered plant is existing collateral, not a pending order to refund.
      if (!(await releaseCompletedConstructionFunding(db, claim)))
        throw new Error("Construction funding acknowledgement remains pending");
    }
  };
  for (const sector of sectors) await settleSecured(sector);
  const currentSectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      { _id: { $in: sectors.map((sector) => sector._id) } },
      {
        projection: {
          corporationId: 1,
          stateId: 1,
          countryId: 1,
          sectorType: 1,
          industryModel: 1,
          mediaDiscriminator: 1,
          buildQueue: 1,
          constructionPropertyTransition: 1,
          capitalStock: 1,
          capacityBookAnchor: 1,
          operatingCapacityTurn: 1,
        },
      }
    )
    .toArray();
  for (const sector of currentSectors) {
    if (sector.constructionPropertyTransition)
      throw new Error("A construction property settlement must finish before conversion");
    if (!sector.buildQueue?.length) continue;
    if (sector.buildQueue.some((order) => order.constructionLoanId))
      throw new Error("Financed cancellation did not retire its order");
    const owner = byId.get(String(sector.corporationId));
    if (!owner) throw new Error("Construction owner is missing");
    const quote = quoteConversionConstructionRefund(sector, turn);
    const code = resolveCorpLiquidCurrencyCode(owner);
    const rate = code ? fx.get(code) : 1;
    if (!(rate && rate > 0))
      throw new Error("Construction refund requires the owner's exchange rate");
    const local = Math.round(anchorToCorpLiquidCapital(quote.anchor, owner, rate));
    sectorOps.push({
      updateOne: {
        filter: { _id: sector._id, buildQueue: sector.buildQueue },
        update: { $set: quote.set },
      },
    });
    refunds.set(String(owner._id), (refunds.get(String(owner._id)) ?? 0) + local);
    const credit = unownedPoolCredit(
      {
        stateId: sector.stateId,
        countryId: sector.countryId,
        sectorType: sector.sectorType,
        industryModel: sector.industryModel,
        mediaDiscriminator: sector.mediaDiscriminator,
      },
      quote.units,
      new Date(),
      era
    );
    if (credit)
      poolOps.push({
        updateOne: {
          filter: {
            stateId: sector.stateId,
            sectorType: sector.sectorType,
            industryModel: sector.industryModel ?? null,
            mediaDiscriminator: sector.mediaDiscriminator ?? null,
          },
          update: credit,
          upsert: true,
        },
      });
    if (quote.anchor > 0)
      logs.push({
        corporationId: owner._id,
        corporationName: owner.name,
        corporationSequentialId: owner.sequentialId,
        direction: "refund",
        amountLocal: local,
        currencyCode: code ?? "USD",
        anchorAmount: quote.anchor,
        turn,
        sectorId: sector._id,
        sectorType: sector.sectorType,
        units: quote.units,
        meta: { reason: "boundary_conversion" },
      });
  }
  if (sectorOps.length) {
    const result = await db.collection<CorporateSector>("corporateSectors").bulkWrite(sectorOps);
    if (result.matchedCount !== sectorOps.length)
      throw new Error("Construction queues changed during conversion");
  }
  if (refunds.size)
    await db.collection<Corporation>("corporations").bulkWrite(
      [...refunds].map(([id, amount]) => ({
        updateOne: {
          filter: { _id: new ObjectId(id) },
          update: { $inc: { liquidCapital: amount } },
        },
      }))
    );
  if (poolOps.length) await db.collection("unownedSectors").bulkWrite(poolOps);
  if (logs.length) await emitBuildCapexTxBulk(db, logs);
  // Infrastructure construction reserves a budget envelope, not prepaid cash.
  // Cancelling releases that commitment; there is no cash debit to refund.
  await db.collection("infraProjects").deleteMany({ regionId, status: "construction" });
}
