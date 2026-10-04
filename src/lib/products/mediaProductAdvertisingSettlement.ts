/**
 * Title advertising moves the buyer's frozen native cash to the quoted outlets.
 * `settleMediaProductAdvertisingObligations` guards denominations and publishes only funded receipts.
 */
import { ObjectId, type Db } from "mongodb";
import type { Corporation, MediaProductAdvertisingObligationV1 } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BankingTransition } from "@/lib/banking/rules/boundary";
import { oid } from "@/lib/banking/rules/boundary";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import { resumeSettlement, settleTransition } from "@/lib/banking/settlementJournal";
import {
  productAdvertisingDenominationWitness,
  quoteFundedProductAdvertising,
  type ProductAdvertisingSellerQuote,
} from "@/lib/products/rules/productAdvertising";

const JOURNAL_PREFIX = "media-product-advertising";

function denominationConditions(
  witness: MediaProductAdvertisingObligationV1["buyerDenomination"]
): Record<string, unknown>[] {
  const frozen = witness ?? productAdvertisingDenominationWitness({});
  const check = (
    field: "liquidCurrencyCode" | "countryId",
    present: boolean,
    value: string | null
  ) => {
    if (!present) return [{ [field]: { $exists: false } }];
    if (value === null) return [{ [field]: null }, { [field]: { $exists: true } }];
    return [{ [field]: value }];
  };
  return [
    ...check("liquidCurrencyCode", frozen.liquidCurrencyCodePresent, frozen.liquidCurrencyCode),
    ...check("countryId", frozen.countryIdPresent, frozen.countryId),
  ];
}

export type MediaAdvertisingSellerQuote = ProductAdvertisingSellerQuote;

export function createMediaProductAdvertisingObligation(input: {
  buyerCorporationId: string;
  projectId: string;
  turn: number;
  amountAnchor: number;
  buyerCurrencyCode: CurrencyCode;
  buyerLocalPerAnchor: number;
  buyerDenomination: MediaProductAdvertisingObligationV1["buyerDenomination"];
  sellers: readonly MediaAdvertisingSellerQuote[];
}): MediaProductAdvertisingObligationV1 | null {
  if (!Number.isSafeInteger(input.turn) || !input.projectId || !input.buyerCorporationId) {
    return null;
  }
  const quote = quoteFundedProductAdvertising({
    amountAnchor: input.amountAnchor,
    buyer: {
      corporationId: input.buyerCorporationId,
      currencyCode: input.buyerCurrencyCode,
      localPerAnchor: input.buyerLocalPerAnchor,
      ...input.buyerDenomination,
    },
    sellers: input.sellers,
  });
  if (!quote) return null;
  return {
    projectId: input.projectId,
    turn: input.turn,
    ...quote,
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
      filter: {
        _id: oid(seller.corporationId),
        $and: denominationConditions(seller.denomination),
      },
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
          $and: denominationConditions(obligation.buyerDenomination),
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
      const key = mediaProductAdvertisingSettlementKey(row._id.toHexString(), obligation);
      const prior = await journal.findOne({ _id: key }, { projection: { _id: 1 } });
      if (
        !prior &&
        (!obligation.buyerDenomination ||
          obligation.sellerAllocations.some((seller) => !seller.denomination))
      ) {
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
        continue;
      }
      const result = prior
        ? await resumeSettlement(db, key)
        : await settleTransition(db, mediaProductAdvertisingTransition(row._id, obligation));
      if (result.status === "applied" || (result.status === "replayed" && !result.error)) {
        touched.set(row._id.toHexString(), row._id);
      } else if (result.status === "rejected" && result.appliedLegs.length === 0) {
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
