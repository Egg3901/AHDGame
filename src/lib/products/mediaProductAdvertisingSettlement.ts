/**
 * Title advertising moves the buyer's frozen native cash to the quoted outlets.
 * `settleProductAdvertisingObligations` debits each funded order into the
 * clearing pool, publishes its receipt, then pays every owed seller in one
 * netted clearing transition (see productAdvertisingClearing.ts).
 */
import { ObjectId, type Db } from "mongodb";
import type { Corporation, MediaProductAdvertisingObligationV1 } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ProductAdvertisingDenominationWitness } from "@/lib/products/rules/productAdvertising";
import type { BankingTransition, TransitionLeg } from "@/lib/banking/rules/boundary";
import { oid } from "@/lib/banking/rules/boundary";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import { resumeSettlement, settleTransition } from "@/lib/banking/settlementJournal";
import {
  quoteFundedProductAdvertising,
  type ProductAdvertisingObligation,
  type ProductAdvertisingSellerQuote,
} from "@/lib/products/rules/productAdvertising";
import {
  ADVERTISING_FAMILY,
  CLEARING_POOL_BALANCE_PATH,
  PRODUCT_ADVERTISING_CLEARING_COLLECTION,
  PRODUCT_ADVERTISING_PAYABLES_COLLECTION,
  clearProductAdvertisingPayables,
  clearingPoolId,
  denominationConditions,
  ensureClearingPool,
  type ProductAdvertisingFamily,
  type ProductAdvertisingPayable,
} from "@/lib/products/productAdvertisingClearing";

export type { ProductAdvertisingFamily } from "@/lib/products/productAdvertisingClearing";

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

/** Refuse a frozen order whose seller split does not add back up to the buyer debit. */
function assertBalancedOrder(key: string, obligation: ProductAdvertisingObligation): void {
  const buyerAnchor = obligation.buyerAmountLocal / obligation.buyerLocalPerAnchor;
  const sellerAnchor = obligation.sellerAllocations.reduce(
    (sum, seller) => sum + seller.amountLocal / seller.localPerAnchor,
    0
  );
  if (
    !Number.isFinite(buyerAnchor) ||
    buyerAnchor <= 0 ||
    obligation.sellerAllocations.length === 0
  ) {
    throw new Error(`Invalid frozen media advertising obligation ${key}`);
  }
  if (Math.abs(buyerAnchor - sellerAnchor) > 1e-6) {
    throw new Error(`Frozen media advertising allocations do not balance for ${key}`);
  }
}

/** The guarded buyer debit, identical in the pooled and legacy transitions. */
function buyerDebitLeg(
  corporationId: ObjectId,
  obligation: ProductAdvertisingObligation
): TransitionLeg {
  return {
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
  };
}

function receiptProjection(
  corporationId: ObjectId,
  obligation: ProductAdvertisingObligation,
  family: ProductAdvertisingFamily
): BankingTransition["projections"][number] {
  const definition = ADVERTISING_FAMILY[family];
  return {
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
          sellerCorporationIds: obligation.sellerAllocations.map((seller) => seller.corporationId),
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
  };
}

function orderEvent(
  corporationId: ObjectId,
  obligation: ProductAdvertisingObligation,
  family: ProductAdvertisingFamily
): BankingTransition["event"] {
  return {
    kind: "monetary.executed",
    command: ADVERTISING_FAMILY[family].command,
    subjectType: "corporation",
    subjectId: corporationId.toHexString(),
    amount: obligation.amountAnchor,
    meta: {
      projectId: obligation.projectId,
      advertisingAmountAnchor: obligation.amountAnchor,
    },
  };
}

/**
 * Stage 1 of a funded order: the buyer debit lands in the clearing pool, the
 * order's frozen per-seller payables are recorded as owed, and the receipt is
 * published. Sellers are paid by the per-turn clearing transition.
 */
export function productAdvertisingTransition(
  corporationId: ObjectId,
  obligation: ProductAdvertisingObligation,
  family: ProductAdvertisingFamily = "media"
): BankingTransition {
  const definition = ADVERTISING_FAMILY[family];
  const key = productAdvertisingSettlementKey(corporationId.toHexString(), obligation, family);
  assertBalancedOrder(key, obligation);
  if (obligation.sellerAllocations.some((seller) => !seller.denomination)) {
    throw new Error(`Frozen media advertising seller witness missing for ${key}`);
  }
  const poolId = clearingPoolId(family, obligation.buyerCurrencyCode);
  const payable: ProductAdvertisingPayable = {
    _id: key,
    clearingVersion: 1,
    family,
    turn: obligation.turn,
    buyerCorporationId: corporationId.toHexString(),
    projectId: obligation.projectId,
    poolId,
    poolCurrencyCode: obligation.buyerCurrencyCode,
    poolLocalPerAnchor: obligation.buyerLocalPerAnchor,
    poolAmountLocal: obligation.buyerAmountLocal,
    sellerAllocations: obligation.sellerAllocations.map((seller) => ({
      corporationId: seller.corporationId,
      amountLocal: seller.amountLocal,
      currencyCode: seller.currencyCode,
      localPerAnchor: seller.localPerAnchor,
      denomination: seller.denomination!,
    })),
  };
  return {
    key,
    kind: definition.kind,
    turn: obligation.turn,
    currency: obligation.buyerCurrencyCode,
    legs: [
      buyerDebitLeg(corporationId, obligation),
      {
        kind: "credit",
        amount: obligation.buyerAmountLocal,
        valuation: {
          currencyCode: obligation.buyerCurrencyCode,
          localPerAnchor: obligation.buyerLocalPerAnchor,
        },
        collection: PRODUCT_ADVERTISING_CLEARING_COLLECTION,
        filter: { _id: poolId },
        path: CLEARING_POOL_BALANCE_PATH,
        note: "Hold the title advertising order in the clearing pool",
      },
    ],
    projections: [
      {
        collection: PRODUCT_ADVERTISING_PAYABLES_COLLECTION,
        insert: payable as unknown as Record<string, unknown>,
        note: "Record the order's frozen seller payables as owed",
      },
      receiptProjection(corporationId, obligation, family),
    ],
    event: orderEvent(corporationId, obligation, family),
  };
}

/**
 * The pre-clearing shape: one credit leg per seller in the order's own
 * transition. Orders journaled in this shape resume from their own record
 * through `resumeSettlement`; this builder is kept so tests and repair tools
 * can reproduce exactly what those records contain.
 */
export function legacyProductAdvertisingTransition(
  corporationId: ObjectId,
  obligation: ProductAdvertisingObligation,
  family: ProductAdvertisingFamily = "media"
): BankingTransition {
  const definition = ADVERTISING_FAMILY[family];
  const key = productAdvertisingSettlementKey(corporationId.toHexString(), obligation, family);
  assertBalancedOrder(key, obligation);
  const sellerLegs: TransitionLeg[] = obligation.sellerAllocations.map((seller, index) => ({
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
  }));
  return {
    key,
    kind: definition.kind,
    turn: obligation.turn,
    currency: obligation.buyerCurrencyCode,
    // The journal may retry only these frozen seller credits after a raw
    // denomination guard temporarily refuses them. The buyer debit remains
    // terminal and is never replayed.
    retryCreditLegOnGuardFailure: true,
    legs: [buyerDebitLeg(corporationId, obligation), ...sellerLegs],
    projections: [receiptProjection(corporationId, obligation, family)],
    event: orderEvent(corporationId, obligation, family),
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
  family: ProductAdvertisingFamily = "media",
  options: {
    /** Tests stop after stage 1 to model a turn that died before clearing. */
    skipClearing?: boolean;
  } = {}
): Promise<ObjectId[]> {
  const touched = new Map<string, ObjectId>();
  const touchCorporation = (id: string) => {
    if (!ObjectId.isValid(id)) return;
    const corporationId = new ObjectId(id);
    touched.set(corporationId.toHexString(), corporationId);
  };
  const definition = ADVERTISING_FAMILY[family];
  const obligationsField = definition.obligationsField;
  const receiptField = definition.receiptField;
  const rows =
    corporationIds.length === 0
      ? []
      : await db
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
  const pools = new Set<string>();

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
      if (!prior) {
        const poolId = clearingPoolId(family, obligation.buyerCurrencyCode);
        if (!pools.has(poolId)) {
          await ensureClearingPool(db, family, obligation.buyerCurrencyCode);
          pools.add(poolId);
        }
      }
      // An existing key resumes from its own journal record, whatever its
      // shape: pre-clearing records still pay their sellers directly.
      const result = prior
        ? await resumeSettlement(db, key)
        : await settleTransition(db, productAdvertisingTransition(row._id, obligation, family));
      const moved =
        result.appliedLegs.length > 0 ||
        result.status === "applied" ||
        (result.status === "replayed" && !result.error);
      if (moved) {
        touchCorporation(row._id.toHexString());
        if (prior) {
          for (const seller of obligation.sellerAllocations) touchCorporation(seller.corporationId);
        }
      }
      if (result.status === "applied" || (result.status === "replayed" && !result.error)) {
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
  // Stage 2 runs even when no order settled this call: payables a crash or a
  // deferred seller left owed are paid by the next clearing.
  if (!options.skipClearing) {
    for (const sellerId of await clearProductAdvertisingPayables(db, family, currentTurn)) {
      touchCorporation(sellerId.toHexString());
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
