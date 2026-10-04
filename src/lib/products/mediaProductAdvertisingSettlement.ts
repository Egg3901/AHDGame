import { ObjectId, type Db } from "mongodb";
import type { Corporation, MediaProductAdvertisingObligationV1 } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { anchorToCorpCapital } from "@/lib/currency/corporationCapital";
import type { BankingTransition } from "@/lib/banking/rules/boundary";
import { oid } from "@/lib/banking/rules/boundary";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import { resumeSettlement, settleTransition } from "@/lib/banking/settlementJournal";

const JOURNAL_PREFIX = "media-product-advertising";

export interface MediaAdvertisingSellerQuote {
  corporationId: string;
  deliveredValueAnchor: number;
  currencyCode: CurrencyCode;
  localPerAnchor: number;
}

export function createMediaProductAdvertisingObligation(input: {
  projectId: string;
  turn: number;
  amountAnchor: number;
  buyerCurrencyCode: CurrencyCode;
  buyerLocalPerAnchor: number;
  sellers: readonly MediaAdvertisingSellerQuote[];
}): MediaProductAdvertisingObligationV1 | null {
  const sellers = input.sellers.filter(
    (seller) =>
      Number.isFinite(seller.deliveredValueAnchor) &&
      seller.deliveredValueAnchor > 0 &&
      Number.isFinite(seller.localPerAnchor) &&
      seller.localPerAnchor > 0
  );
  const totalSellerValue = sellers.reduce((sum, seller) => sum + seller.deliveredValueAnchor, 0);
  if (
    !Number.isSafeInteger(input.turn) ||
    !input.projectId ||
    !Number.isFinite(input.amountAnchor) ||
    input.amountAnchor <= 0 ||
    !Number.isFinite(input.buyerLocalPerAnchor) ||
    input.buyerLocalPerAnchor <= 0 ||
    totalSellerValue <= 0 ||
    sellers.length === 0
  ) {
    return null;
  }

  const buyerAmountLocal = anchorToCorpCapital(
    input.amountAnchor,
    input.buyerCurrencyCode,
    input.buyerLocalPerAnchor
  );
  const buyerAnchor = buyerAmountLocal / input.buyerLocalPerAnchor;
  let allocatedAnchor = 0;
  const sellerAllocations = sellers.map((seller, index) => {
    const amountAnchor =
      index === sellers.length - 1
        ? buyerAnchor - allocatedAnchor
        : buyerAnchor * (seller.deliveredValueAnchor / totalSellerValue);
    const amountLocal = anchorToCorpCapital(
      amountAnchor,
      seller.currencyCode,
      seller.localPerAnchor
    );
    allocatedAnchor += amountLocal / seller.localPerAnchor;
    return {
      corporationId: seller.corporationId,
      amountLocal,
      currencyCode: seller.currencyCode,
      localPerAnchor: seller.localPerAnchor,
    };
  });
  if (
    !(Number.isFinite(buyerAmountLocal) && buyerAmountLocal > 0) ||
    sellerAllocations.some(
      (seller) => !(Number.isFinite(seller.amountLocal) && seller.amountLocal > 0)
    )
  ) {
    return null;
  }
  return {
    projectId: input.projectId,
    turn: input.turn,
    amountAnchor: buyerAnchor,
    buyerAmountLocal,
    buyerCurrencyCode: input.buyerCurrencyCode,
    buyerLocalPerAnchor: input.buyerLocalPerAnchor,
    sellerAllocations,
  };
}

export function mediaProductAdvertisingSettlementKey(
  corporationId: string,
  obligation: Pick<MediaProductAdvertisingObligationV1, "projectId" | "turn">
): string {
  return `${JOURNAL_PREFIX}:${obligation.turn}:${corporationId}:${obligation.projectId}`;
}

export function mediaProductAdvertisingTransition(
  corporationId: ObjectId,
  obligation: MediaProductAdvertisingObligationV1
): BankingTransition {
  const key = mediaProductAdvertisingSettlementKey(corporationId.toHexString(), obligation);
  const buyerAnchor = obligation.buyerAmountLocal / obligation.buyerLocalPerAnchor;
  let sellerAnchorAssigned = 0;
  const sellerLegs = obligation.sellerAllocations.map((seller, index) => {
    const sellerAmountAnchor = seller.amountLocal / seller.localPerAnchor;
    sellerAnchorAssigned += sellerAmountAnchor;
    return {
      kind: "credit" as const,
      amount: seller.amountLocal,
      valuation: {
        currencyCode: seller.currencyCode,
        localPerAnchor: seller.localPerAnchor,
      },
      collection: "corporations",
      filter: { _id: oid(seller.corporationId) },
      path: "liquidCapital",
      note: `Fund title advertising allocation ${index + 1}`,
    };
  });
  if (!Number.isFinite(buyerAnchor) || buyerAnchor <= 0 || sellerLegs.length === 0) {
    throw new Error(`Invalid frozen media advertising obligation ${key}`);
  }
  if (Math.abs(buyerAnchor - sellerAnchorAssigned) > 1e-6) {
    throw new Error(`Frozen media advertising allocations do not balance for ${key}`);
  }

  return {
    key,
    kind: "media.product.advertising",
    turn: obligation.turn,
    currency: obligation.buyerCurrencyCode,
    legs: [
      {
        kind: "debit",
        amount: obligation.buyerAmountLocal,
        valuation: {
          currencyCode: obligation.buyerCurrencyCode,
          localPerAnchor: obligation.buyerLocalPerAnchor,
        },
        collection: "corporations",
        filter: {
          _id: oid(corporationId.toHexString()),
          liquidCapital: { $gte: obligation.buyerAmountLocal },
          $expr: {
            $eq: [
              {
                $size: {
                  $filter: {
                    input: {
                      $objectToArray: {
                        $ifNull: ["$operatingCashArrearsByCurrency", {}],
                      },
                    },
                    as: "arrear",
                    cond: { $gt: ["$$arrear.v", 0] },
                  },
                },
              },
              0,
            ],
          },
        },
        path: "liquidCapital",
        note: "Pay the frozen title advertising order from funded cash",
      },
      ...sellerLegs,
    ],
    projections: [
      {
        collection: "corporations",
        filter: { _id: oid(corporationId.toHexString()) },
        update: {
          $set: {
            mediaProductAdvertisingReceiptV1: {
              projectId: obligation.projectId,
              turn: obligation.turn,
              amountAnchor: obligation.amountAnchor,
            },
          },
          $pull: {
            mediaProductAdvertisingObligationsV1: {
              projectId: obligation.projectId,
              turn: obligation.turn,
            },
          },
        },
        note: "Publish funded title advertising and clear its frozen obligation",
      },
    ],
    event: {
      kind: "monetary.executed",
      command: "turn.mediaProductAdvertising",
      subjectType: "corporation",
      subjectId: corporationId.toHexString(),
      amount: obligation.amountAnchor,
      meta: {
        projectId: obligation.projectId,
        advertisingAmountAnchor: obligation.amountAnchor,
      },
    },
  };
}

/** Resume immutable title orders only after operating cash and arrears settle. */
export async function settleMediaProductAdvertisingObligations(
  db: Db,
  corporationIds: readonly ObjectId[],
  currentTurn: number
): Promise<ObjectId[]> {
  if (corporationIds.length === 0) return [];
  const rows = await db
    .collection<Corporation>("corporations")
    .find(
      {
        _id: { $in: [...corporationIds] },
        $or: [
          { "mediaProductAdvertisingObligationsV1.0": { $exists: true } },
          { "mediaProductAdvertisingReceiptV1.turn": currentTurn },
        ],
      },
      {
        projection: {
          _id: 1,
          mediaProductAdvertisingObligationsV1: 1,
          mediaProductAdvertisingReceiptV1: 1,
        },
      }
    )
    .toArray();
  const journal = db.collection<{ _id: string }>(MONEY_MOVE_COLLECTION);
  const touched = new Map<string, ObjectId>();

  for (const row of rows) {
    if (row.mediaProductAdvertisingReceiptV1?.turn === currentTurn) {
      touched.set(row._id.toHexString(), row._id);
    }
    for (const obligation of row.mediaProductAdvertisingObligationsV1 ?? []) {
      const transition = mediaProductAdvertisingTransition(row._id, obligation);
      const prior = await journal.findOne({ _id: transition.key }, { projection: { _id: 1 } });
      const result = prior
        ? await resumeSettlement(db, transition.key)
        : await settleTransition(db, transition);
      if (result.status === "applied" || (result.status === "replayed" && !result.error)) {
        touched.set(row._id.toHexString(), row._id);
      } else if (result.status === "rejected") {
        await db.collection<Corporation>("corporations").updateOne(
          { _id: row._id },
          {
            $pull: {
              mediaProductAdvertisingObligationsV1: {
                projectId: obligation.projectId,
                turn: obligation.turn,
              },
            },
          }
        );
      }
    }
  }
  return [...touched.values()];
}
