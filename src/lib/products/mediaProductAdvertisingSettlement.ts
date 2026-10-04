/**
 * Title advertising moves the buyer's frozen native cash to the quoted outlets.
 * `settleMediaProductAdvertisingObligations` guards denominations and publishes only funded receipts.
 */
import { ObjectId, type Db } from "mongodb";
import type { Corporation, MediaProductAdvertisingObligationV1 } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ProductAdvertisingDenominationWitness } from "@/lib/products/rules/productAdvertising";
import type { BankingTransition } from "@/lib/banking/rules/boundary";
import { oid } from "@/lib/banking/rules/boundary";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import { resumeSettlement, settleTransition } from "@/lib/banking/settlementJournal";
import {
  productAdvertisingDenominationWitness,
  quoteFundedProductAdvertising,
  type ProductAdvertisingObligation,
  type ProductAdvertisingSellerQuote,
  type ProductAdvertisingDenominationWitness,
} from "@/lib/products/rules/productAdvertising";

export type ProductAdvertisingFamily = "media" | "manufacturing";

const ADVERTISING_FAMILY = {
  media: {
    journalPrefix: "media-product-advertising",
    kind: "media.product.advertising",
    command: "turn.mediaProductAdvertising",
    obligationsField: "mediaProductAdvertisingObligationsV1",
    receiptField: "mediaProductAdvertisingReceiptV1",
  },
  manufacturing: {
    journalPrefix: "manufacturing-product-advertising",
    kind: "manufacturing.product.advertising",
    command: "turn.manufacturingProductAdvertising",
    obligationsField: "manufacturingProductAdvertisingObligationsV2",
    receiptField: "manufacturingProductAdvertisingReceiptV2",
  },
} as const satisfies Record<
  ProductAdvertisingFamily,
  {
    journalPrefix: string;
    kind: string;
    command: string;
    obligationsField: string;
    receiptField: string;
  }
>;

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
  buyerDenomination: ProductAdvertisingDenominationWitness;
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
  return productAdvertisingSettlementKey(corporationId, obligation);
}

export function productAdvertisingSettlementKey(
  corporationId: string,
  obligation: Pick<ProductAdvertisingObligation, "projectId" | "turn">,
  family: ProductAdvertisingFamily = "media"
): string {
  const definition = ADVERTISING_FAMILY[family];
  return `${definition.journalPrefix}:${obligation.turn}:${corporationId}:${obligation.projectId}`;
}

export function productAdvertisingTransition(
  corporationId: ObjectId,
  obligation: ProductAdvertisingObligation,
  family: ProductAdvertisingFamily = "media"
): BankingTransition {
  const definition = ADVERTISING_FAMILY[family];
  const key = productAdvertisingSettlementKey(corporationId.toHexString(), obligation, family);
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
    kind: definition.kind,
    turn: obligation.turn,
    currency: obligation.buyerCurrencyCode,
    // The journal may retry only these frozen seller credits after a raw
    // denomination guard temporarily refuses them. The buyer debit remains
    // terminal and is never replayed.
    retryCreditLegOnGuardFailure: true,
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
        filter: {
          _id: oid(corporationId.toHexString()),
          [definition.receiptField]: { $exists: false },
        },
        update: {
          $set: {
            [definition.receiptField]: {
              projectId: obligation.projectId,
              turn: obligation.turn,
              amountAnchor: obligation.amountAnchor,
              sellerCorporationIds: obligation.sellerAllocations.map(
                (seller) => seller.corporationId
              ),
            },
          } as Record<string, unknown>,
          $pull: {
            [definition.obligationsField]: {
              projectId: obligation.projectId,
              turn: obligation.turn,
            },
          } as Record<string, unknown>,
        },
        note: "Publish funded title advertising and clear its frozen obligation",
      },
    ],
    event: {
      kind: "monetary.executed",
      command: definition.command,
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
export function mediaProductAdvertisingTransition(
  corporationId: ObjectId,
  obligation: MediaProductAdvertisingObligationV1
): BankingTransition {
  return productAdvertisingTransition(corporationId, obligation, "media");
}

export async function settleProductAdvertisingObligations(
  db: Db,
  corporationIds: readonly ObjectId[],
  currentTurn: number,
  family: ProductAdvertisingFamily = "media"
): Promise<ObjectId[]> {
  if (corporationIds.length === 0) return [];
  const definition = ADVERTISING_FAMILY[family];
  const obligationsField = definition.obligationsField;
  const receiptField = definition.receiptField;
  const rows = await db
    .collection<Corporation>("corporations")
    .find(
      {
        _id: { $in: [...corporationIds] },
        $or: [
          { [`${obligationsField}.0`]: { $exists: true } },
          { [receiptField]: { $exists: true } },
        ],
      },
      {
        projection: {
          _id: 1,
          [obligationsField]: 1,
          [receiptField]: 1,
        },
      }
    )
    .toArray();
  const journal = db.collection<{ _id: string }>(MONEY_MOVE_COLLECTION);
  const touched = new Map<string, ObjectId>();
  const touchCorporation = (id: string) => {
    if (!ObjectId.isValid(id)) return;
    const corporationId = new ObjectId(id);
    touched.set(corporationId.toHexString(), corporationId);
  };

  for (const row of rows) {
    const fields = row as unknown as Record<string, unknown>;
    const receipt = fields[receiptField] as
      { turn?: number; sellerCorporationIds?: string[] } | undefined;
    const obligations = Array.isArray(fields[obligationsField])
      ? (fields[obligationsField] as ProductAdvertisingObligation[])
      : [];
    if (receipt) {
      touchCorporation(row._id.toHexString());
      for (const sellerId of receipt.sellerCorporationIds ?? []) touchCorporation(sellerId);
    }
    // A receipt is a one-slot handoff to product progression. Do not settle a
    // second order until the consumer acknowledges and removes that receipt.
    if (receipt) continue;
    for (const obligation of obligations) {
      if (obligation.turn > currentTurn) continue;
      const key = productAdvertisingSettlementKey(row._id.toHexString(), obligation, family);
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
              [obligationsField]: {
                projectId: obligation.projectId,
                turn: obligation.turn,
              },
            } as Record<string, unknown>,
          }
        );
        continue;
      }
      const result = prior
        ? await resumeSettlement(db, key)
        : await settleTransition(db, productAdvertisingTransition(row._id, obligation, family));
      if (result.appliedLegs.length > 0) {
        touchCorporation(row._id.toHexString());
        for (const seller of obligation.sellerAllocations) {
          touchCorporation(seller.corporationId);
        }
      }
      if (result.status === "applied" || (result.status === "replayed" && !result.error)) {
        touchCorporation(row._id.toHexString());
        for (const seller of obligation.sellerAllocations) {
          touchCorporation(seller.corporationId);
        }
        // A corporation can have legacy duplicate obligations. Publish at
        // most one receipt per handoff, leaving later orders and journals intact.
        break;
      } else if (result.status === "rejected" && result.appliedLegs.length === 0) {
        await db.collection<Corporation>("corporations").updateOne(
          { _id: row._id },
          {
            $pull: {
              [obligationsField]: {
                projectId: obligation.projectId,
                turn: obligation.turn,
              },
            } as Record<string, unknown>,
          }
        );
      } else {
        // Partial cash movement or a durable order in progress blocks later
        // obligations so their receipts cannot overtake this original order.
        break;
      }
    }
  }
  return [...touched.values()];
}

/** Preserve the media-specific call shape for existing turn and test callers. */
export async function settleMediaProductAdvertisingObligations(
  db: Db,
  corporationIds: readonly ObjectId[],
  currentTurn: number
): Promise<ObjectId[]> {
  return settleProductAdvertisingObligations(db, corporationIds, currentTurn, "media");
}
