/**
 * Product development cash is paid after corporate operating results land.
 * Its guarded receipt and the resulting live treasury balance refresh the
 * cash and credit values used by this turn's share-price snapshot.
 */
import { ObjectId, type AnyBulkWriteOperation, type Db } from "mongodb";
import type { Bond, Corporation, CorporateSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  computeCorporateCreditAtTurn,
  corporateCashArrearsAnchor,
  sumCorporateSectorConstructionInProgress,
} from "@/lib/bonds/corporateCredit";
import { ceoOwnershipFraction } from "@/lib/corporations/ceoOwnership";
import { indexFundOwnershipFraction } from "@/lib/corporations/indexOwnership";
import { settleMediaProductAdvertisingObligations } from "@/lib/products/mediaProductAdvertisingSettlement";
import {
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import type { CorpSnapshot } from "./types";

interface DevelopmentCashRow {
  _id: ObjectId;
  liquidCapital?: number;
  manufacturingProductDevelopmentPaidTurnV2?: number;
  manufacturingProductDevelopmentReceiptV2?: {
    projectId: string;
    turn: number;
    amountAnchor: number;
  };
}

export interface ManufacturingDevelopmentCashSettlementArgs {
  db: Db;
  operations: AnyBulkWriteOperation<Corporation>[];
  turn: number;
  corporations: readonly Corporation[];
  snapshots: CorpSnapshot[];
  exchangeRatesByCurrency: Map<CurrencyCode, number>;
  bondsByCorpId: Map<string, Bond[]>;
  sectorsByCorp: Map<string, CorporateSector[]>;
  /** Feature gate; disabled turns do not read or settle title advertising obligations. */
  mediaProductSlatesEnabled?: boolean;
}

export interface OperatingThenDevelopmentCashArgs extends ManufacturingDevelopmentCashSettlementArgs {
  /** Settles net operating P&L and other ordinary corp cash writes first. */
  applyOperatingCashWrites: () => Promise<void>;
}

/** Keep development debit ordering explicit so its live guard sees final P&L cash. */
export async function applyOperatingCashThenDevelopmentCash(
  args: OperatingThenDevelopmentCashArgs
): Promise<{ paidReceipts: number; paidAmountAnchor: number }> {
  await args.applyOperatingCashWrites();
  const mediaAdvertisingIds = args.mediaProductSlatesEnabled
    ? await settleMediaProductAdvertisingObligations(
        args.db,
        args.corporations.map((corp) => corp._id),
        args.turn
      )
    : [];
  return settleManufacturingDevelopmentCash(args, mediaAdvertisingIds);
}

/** Apply guarded product debits, then refresh affected snapshots from Mongo in one read. */
export async function settleManufacturingDevelopmentCash(
  args: ManufacturingDevelopmentCashSettlementArgs,
  additionalCorporationIds: readonly ObjectId[] = []
): Promise<{ paidReceipts: number; paidAmountAnchor: number }> {
  const corporationIds = args.operations.flatMap((operation) => {
    if (!("updateOne" in operation)) return [];
    const id = operation.updateOne.filter._id;
    return id instanceof ObjectId ? [id] : [];
  });
  const uniqueIds = [
    ...new Map(
      [...corporationIds, ...additionalCorporationIds].map((id) => [id.toString(), id])
    ).values(),
  ];
  if (uniqueIds.length === 0) return { paidReceipts: 0, paidAmountAnchor: 0 };

  if (args.operations.length > 0) {
    await args.db.collection<Corporation>("corporations").bulkWrite(args.operations, {
      ordered: false,
    });
  }

  const rows = (await args.db
    .collection<Corporation>("corporations")
    .find(
      { _id: { $in: uniqueIds } },
      {
        projection: {
          _id: 1,
          liquidCapital: 1,
          manufacturingProductDevelopmentPaidTurnV2: 1,
          manufacturingProductDevelopmentReceiptV2: 1,
        },
      }
    )
    .toArray()) as DevelopmentCashRow[];

  const corporationById = new Map(args.corporations.map((corp) => [corp._id.toString(), corp]));
  const snapshotById = new Map(
    args.snapshots.map((snapshot) => [snapshot.corpId.toString(), snapshot])
  );
  let paidReceipts = 0;
  let paidAmountAnchor = 0;
  const creditOps: AnyBulkWriteOperation<Corporation>[] = [];

  for (const row of rows) {
    const corporationId = row._id.toString();
    const corp = corporationById.get(corporationId);
    const snapshot = snapshotById.get(corporationId);
    if (!corp || !snapshot) continue;

    const liquidCapital = Number.isFinite(row.liquidCapital) ? (row.liquidCapital as number) : 0;
    const currency = resolveCorpLiquidCurrencyCode(corp);
    const fxRate = fxRateForCorpFromMap(corp, args.exchangeRatesByCurrency);
    const liquidCapitalAnchor = corpCapitalToAnchor(liquidCapital, currency, fxRate);
    snapshot.liquidCapital = liquidCapital;
    snapshot.liquidCapitalAnchorAfterIncome = liquidCapitalAnchor;

    const receipt = row.manufacturingProductDevelopmentReceiptV2;
    if (
      row.manufacturingProductDevelopmentPaidTurnV2 === args.turn &&
      receipt?.turn === args.turn &&
      Number.isFinite(receipt.amountAnchor) &&
      receipt.amountAnchor > 0
    ) {
      paidReceipts += 1;
      paidAmountAnchor += receipt.amountAnchor;
    }

    const creditPack = computeCorporateCreditAtTurn({
      liquidCapitalAnchor,
      incomePerTurn: snapshot.income,
      sectorNpv: snapshot.sectorNPV,
      bonds: args.bondsByCorpId.get(corporationId) ?? [],
      corporationId: corp._id,
      currentTurn: args.turn,
      bondDefaultCreditPenaltyUntilTurn: corp.bondDefaultCreditPenaltyUntilTurn,
      previousCompositeScore: corp.creditCompositeSnapshot ?? undefined,
      fxByCurrency: args.exchangeRatesByCurrency,
      ceoOwnershipFraction: ceoOwnershipFraction(corp),
      indexFundOwnershipFraction: indexFundOwnershipFraction(corp),
      isPrivate: corp.isPrivate ?? false,
      constructionInProgressAnchor: sumCorporateSectorConstructionInProgress(
        args.sectorsByCorp.get(corporationId) ?? [],
        corp._id,
        args.turn
      ),
      otherLiabilitiesAnchor: corporateCashArrearsAnchor({
        operatingByCurrency: corp.operatingCashArrearsByCurrency,
        federalTaxByCountryAnchor: corp.federalTaxArrearsAnchorByCountry,
        fxByCurrency: args.exchangeRatesByCurrency,
      }),
    });
    snapshot.creditComposite = creditPack.creditRating.compositeScore;
    snapshot.creditRating = creditPack.creditRating.rating;
    creditOps.push({
      updateOne: {
        filter: { _id: corp._id },
        update: {
          $set: {
            creditRatingSnapshot: creditPack.creditRating.rating,
            creditCompositeSnapshot: creditPack.creditRating.compositeScore,
            creditSnapshotTurn: args.turn,
            creditRatingComponents: creditPack.creditRating.components,
          },
        },
      },
    });
  }

  if (creditOps.length > 0) {
    await args.db.collection<Corporation>("corporations").bulkWrite(creditOps, { ordered: false });
  }

  return { paidReceipts, paidAmountAnchor };
}
