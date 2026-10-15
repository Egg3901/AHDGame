/**
 * Product advertising clearing pool.
 *
 * A funded advertising order used to settle as one journal transition with a
 * credit leg for every advertising seller in the world, so a turn wrote
 * orders x sellers guarded cash legs. Settlement now runs in two stages:
 *
 * 1. Each order debits its buyer exactly as before and credits one clearing
 *    pool account in the buyer's currency. The same transition inserts the
 *    order's frozen per-seller payables, keyed by the order's settlement key,
 *    and publishes the buyer's receipt.
 * 2. Once per call, every owed payable is netted by seller, currency, frozen
 *    rate and denomination witness and paid in ONE transition: one debit per
 *    pool document and one credit per seller group. Its projection inserts
 *    one clearance receipt per payable, which is the only authority that a
 *    payable was paid. Sellers that cannot receive cash right now are
 *    deferred: their allocations become a residual payable and their money
 *    stays in the pool for a later clearing.
 *
 * Every seller still receives the exact frozen amount of every order. Nothing
 * is re-priced: each payable carries its order's buyer and seller valuations,
 * and the anchor-balanced check in the journal covers the whole batch.
 */
import { createHash } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BankingTransition, TransitionLeg } from "@/lib/banking/rules/boundary";
import { oid } from "@/lib/banking/rules/boundary";
import { netTolerance } from "@/lib/banking/rules/invariants";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import { resumeSettlement, settleTransition } from "@/lib/banking/settlementJournal";
import {
  productAdvertisingDenominationWitness,
  type ProductAdvertisingDenominationWitness,
} from "@/lib/products/rules/productAdvertising";

export type ProductAdvertisingFamily = "media" | "manufacturing";

export const ADVERTISING_FAMILY = {
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

/** Pool accounts: one document per (family, buyer currency). */
export const PRODUCT_ADVERTISING_CLEARING_COLLECTION = "productAdvertisingClearing";
/** Owed per-order seller payables, inserted by stage 1 and removed once cleared. */
export const PRODUCT_ADVERTISING_PAYABLES_COLLECTION = "productAdvertisingPayables";
/** Append-only clearance receipts, inserted by the stage 2 projection. */
export const PRODUCT_ADVERTISING_CLEARANCES_COLLECTION = "productAdvertisingClearances";
/** Native cash balance field on a pool document. */
export const CLEARING_POOL_BALANCE_PATH = "cashLocal";

export interface ProductAdvertisingClearingPool {
  _id: string;
  family: ProductAdvertisingFamily;
  currencyCode: CurrencyCode;
  cashLocal: number;
}

export interface ProductAdvertisingPayableAllocation {
  corporationId: string;
  amountLocal: number;
  currencyCode: string;
  localPerAnchor: number;
  denomination: ProductAdvertisingDenominationWitness;
}

export interface ProductAdvertisingPayable {
  /** The stage 1 settlement key of the order. */
  _id: string;
  clearingVersion: 1;
  family: ProductAdvertisingFamily;
  turn: number;
  buyerCorporationId: string;
  projectId: string;
  poolId: string;
  poolCurrencyCode: string;
  poolLocalPerAnchor: number;
  poolAmountLocal: number;
  sellerAllocations: ProductAdvertisingPayableAllocation[];
}

export function clearingPoolId(family: ProductAdvertisingFamily, currencyCode: string): string {
  return `${family}:${currencyCode}`;
}

export function clearingTransitionKind(family: ProductAdvertisingFamily): string {
  return `${ADVERTISING_FAMILY[family].kind}.clearing`;
}

/** Raw-field guard that refuses cash when the account's denomination moved since the quote. */
export function denominationConditions(
  witness: ProductAdvertisingDenominationWitness | undefined
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

/** Create the pool account before any leg targets it. Idempotent. */
export async function ensureClearingPool(
  db: Db,
  family: ProductAdvertisingFamily,
  currencyCode: string
): Promise<string> {
  const _id = clearingPoolId(family, currencyCode);
  await db
    .collection<ProductAdvertisingClearingPool>(PRODUCT_ADVERTISING_CLEARING_COLLECTION)
    .updateOne(
      { _id },
      {
        $setOnInsert: {
          family,
          currencyCode: currencyCode as CurrencyCode,
          [CLEARING_POOL_BALANCE_PATH]: 0,
        },
      },
      { upsert: true }
    );
  return _id;
}

function denominationKey(witness: ProductAdvertisingDenominationWitness): string {
  return JSON.stringify([
    witness.liquidCurrencyCodePresent,
    witness.liquidCurrencyCode,
    witness.countryIdPresent,
    witness.countryId,
  ]);
}

/** Deterministic stage 2 key: the same owed set in the same turn is the same transition. */
export function clearingSettlementKey(
  family: ProductAdvertisingFamily,
  turn: number,
  payableIds: readonly string[]
): string {
  const digest = createHash("sha256")
    .update([...payableIds].sort().join("\n"))
    .digest("hex")
    .slice(0, 32);
  return `${ADVERTISING_FAMILY[family].journalPrefix}-clearing:${turn}:${digest}`;
}

/**
 * Build the stage 2 transition for a set of owed payables.
 *
 * `poolBalances` lets a debit absorb floating point dust: the pool received
 * each order's amount as a separate `$inc`, so its balance can sit one ulp
 * below the batch sum. A shortfall within a quarter of the journal's own
 * balance tolerance is taken off that pool's debit; anything larger is left
 * for the debit guard to refuse.
 */
export function productAdvertisingClearingTransition(
  family: ProductAdvertisingFamily,
  turn: number,
  payables: readonly ProductAdvertisingPayable[],
  poolBalances: ReadonlyMap<string, number> = new Map(),
  canPay: (allocation: ProductAdvertisingPayableAllocation) => boolean = () => true
): BankingTransition | null {
  const definition = ADVERTISING_FAMILY[family];
  // A seller that cannot receive cash right now (its denomination moved since
  // the quote, or it no longer exists) is deferred, not refused: its frozen
  // allocations move to a residual payable and their money stays in the pool.
  const plans = [...payables]
    .sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0))
    .flatMap((payable) => {
      const paid = payable.sellerAllocations.filter((allocation) => canPay(allocation));
      if (paid.length === 0) return [];
      const deferred = payable.sellerAllocations.filter((allocation) => !canPay(allocation));
      const deferredPool =
        deferred.reduce((sum, seller) => sum + seller.amountLocal / seller.localPerAnchor, 0) *
        payable.poolLocalPerAnchor;
      const residual: ProductAdvertisingPayable | null =
        deferred.length > 0
          ? {
              ...payable,
              _id: `${payable._id}~${turn}`,
              poolAmountLocal: deferredPool,
              sellerAllocations: deferred,
            }
          : null;
      return [
        {
          payable,
          paid,
          residual,
          poolAmountLocal: residual
            ? payable.poolAmountLocal - deferredPool
            : payable.poolAmountLocal,
        },
      ];
    });
  if (plans.length === 0) return null;
  const sorted = plans.map((plan) => plan.payable);
  const residuals = plans.flatMap((plan) => (plan.residual ? [plan.residual] : []));
  const key = clearingSettlementKey(
    family,
    turn,
    sorted.map((payable) => payable._id)
  );
  // One debit per pool document. Two debits on one balance would subtract
  // floating point amounts in sequence, and the second guard can miss by one
  // ulp. The leg's valuation is the pool's frozen anchor total over its local
  // total, so every order's own frozen buyer rate is carried through exactly.
  const debits = new Map<
    string,
    { poolId: string; currencyCode: string; amount: number; anchor: number }
  >();
  const credits = new Map<
    string,
    {
      corporationId: string;
      currencyCode: string;
      localPerAnchor: number;
      denomination: ProductAdvertisingDenominationWitness;
      amount: number;
    }
  >();
  for (const { payable, paid, poolAmountLocal } of plans) {
    const debit = debits.get(payable.poolId) ?? {
      poolId: payable.poolId,
      currencyCode: payable.poolCurrencyCode,
      amount: 0,
      anchor: 0,
    };
    debit.amount += poolAmountLocal;
    debit.anchor += poolAmountLocal / payable.poolLocalPerAnchor;
    debits.set(payable.poolId, debit);
    for (const seller of paid) {
      const creditKey = [
        seller.corporationId,
        seller.currencyCode,
        seller.localPerAnchor,
        denominationKey(seller.denomination),
      ].join("|");
      const credit = credits.get(creditKey) ?? {
        corporationId: seller.corporationId,
        currencyCode: seller.currencyCode,
        localPerAnchor: seller.localPerAnchor,
        denomination: seller.denomination,
        amount: 0,
      };
      credit.amount += seller.amountLocal;
      credits.set(creditKey, credit);
    }
  }
  const byKey = <T>(map: Map<string, T>) =>
    [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, value]) => value);
  const debitGroups = byKey(debits);
  const creditGroups = byKey(credits);

  const creditLegs: TransitionLeg[] = creditGroups.map((credit, index) => ({
    kind: "credit",
    amount: credit.amount,
    valuation: { currencyCode: credit.currencyCode, localPerAnchor: credit.localPerAnchor },
    collection: "corporations",
    filter: {
      _id: oid(credit.corporationId),
      $and: denominationConditions(credit.denomination),
    },
    path: "liquidCapital",
    note: `Clear title advertising payable ${index + 1}`,
  }));
  const debitLeg = (debit: (typeof debitGroups)[number]): TransitionLeg => ({
    kind: "debit",
    amount: debit.amount,
    valuation: { currencyCode: debit.currencyCode, localPerAnchor: debit.amount / debit.anchor },
    collection: PRODUCT_ADVERTISING_CLEARING_COLLECTION,
    filter: { _id: debit.poolId },
    path: CLEARING_POOL_BALANCE_PATH,
    note: "Pay owed title advertising from the clearing pool",
  });

  const tolerance = netTolerance([...debitGroups.map(debitLeg), ...creditLegs]);
  for (const debit of debitGroups) {
    const balance = poolBalances.get(debit.poolId);
    if (balance === undefined || !Number.isFinite(balance)) continue;
    const shortfall = debit.amount - balance;
    const rate = debit.amount / debit.anchor;
    if (shortfall > 0 && shortfall <= (rate * tolerance) / 4 && debit.amount > shortfall) {
      // Dust only: the leg keeps its anchor value (and so its balance check)
      // within the journal tolerance while its local amount matches the pool.
      debit.amount = balance;
      debit.anchor = balance / rate;
    }
  }

  const amountAnchor = debitGroups.reduce((sum, debit) => sum + debit.anchor, 0);
  return {
    key,
    kind: clearingTransitionKind(family),
    turn,
    currency: [...new Set(debitGroups.map((debit) => debit.currencyCode))].sort().join(","),
    // A seller whose denomination moved since the quote refuses its credit.
    // The pool keeps that money and recovery retries only the refused credit.
    retryCreditLegOnGuardFailure: true,
    legs: [...debitGroups.map(debitLeg), ...creditLegs],
    projections: [
      ...(residuals.length > 0
        ? [
            {
              collection: PRODUCT_ADVERTISING_PAYABLES_COLLECTION,
              inserts: residuals as unknown as Record<string, unknown>[],
              note: "Keep deferred title advertising allocations owed",
            },
          ]
        : []),
      {
        collection: PRODUCT_ADVERTISING_CLEARANCES_COLLECTION,
        inserts: sorted.map((payable) => ({
          _id: payable._id,
          clearingKey: key,
          family,
          turn,
        })),
        note: "Record every title advertising payable this clearing paid",
      },
    ],
    event: {
      kind: "monetary.executed",
      command: `${definition.command}.clearing`,
      subjectType: "productAdvertisingClearing",
      subjectId: key,
      amount: amountAnchor,
      meta: {
        payables: sorted.length,
        sellerGroups: creditGroups.length,
        deferredPayables: residuals.length,
      },
    },
  };
}

interface ClearingJournalRecord {
  _id: string;
  status?: string;
  legs?: Array<{
    kind: string;
    applied?: boolean;
    collection?: string;
    filter?: { _id?: unknown };
  }>;
  projections?: Array<{ projection?: { inserts?: Array<{ _id?: unknown }> } }>;
}

function paidSellerIds(record: ClearingJournalRecord | null): ObjectId[] {
  const ids = new Map<string, ObjectId>();
  for (const leg of record?.legs ?? []) {
    if (leg.kind !== "credit" || !leg.applied || leg.collection !== "corporations") continue;
    const raw = leg.filter?._id;
    const hex =
      raw instanceof ObjectId
        ? raw.toHexString()
        : raw && typeof raw === "object" && "$oid" in raw
          ? String((raw as { $oid: unknown }).$oid)
          : typeof raw === "string"
            ? raw
            : null;
    if (hex && ObjectId.isValid(hex)) ids.set(hex, new ObjectId(hex));
  }
  return [...ids.values()];
}

/** Matches the raw-field guard `denominationConditions` builds, evaluated on a read row. */
export function denominationMatches(
  row: { liquidCurrencyCode?: unknown; countryId?: unknown },
  witness: ProductAdvertisingDenominationWitness
): boolean {
  const check = (value: unknown, present: boolean, frozen: string | null) => {
    if (!present) return value === undefined;
    if (frozen === null) return value === null;
    return value === frozen;
  };
  return (
    check(row.liquidCurrencyCode, witness.liquidCurrencyCodePresent, witness.liquidCurrencyCode) &&
    check(row.countryId, witness.countryIdPresent, witness.countryId)
  );
}

async function sellerEligibility(
  db: Db,
  payables: readonly ProductAdvertisingPayable[]
): Promise<(allocation: ProductAdvertisingPayableAllocation) => boolean> {
  const ids = [
    ...new Set(
      payables.flatMap((payable) =>
        payable.sellerAllocations.map((allocation) => allocation.corporationId)
      )
    ),
  ].filter((id) => ObjectId.isValid(id));
  const rows = await db
    .collection<{ _id: ObjectId; liquidCurrencyCode?: unknown; countryId?: unknown }>(
      "corporations"
    )
    .find(
      { _id: { $in: ids.map((id) => new ObjectId(id)) } },
      { projection: { _id: 1, liquidCurrencyCode: 1, countryId: 1 } }
    )
    .toArray();
  const byId = new Map(rows.map((row) => [row._id.toHexString(), row]));
  return (allocation) => {
    const row = byId.get(allocation.corporationId);
    return row !== undefined && denominationMatches(row, allocation.denomination);
  };
}

/**
 * Stage 2: pay every owed payable of one family exactly once.
 *
 * - A clearing a previous run claimed and did not finish (crash, or a seller
 *   whose guard refused between the eligibility read and its credit) is
 *   resumed from its own journal record. Its payables stay out of any new
 *   clearing until that record finishes, so no seller is paid twice.
 * - A payable whose clearance receipt exists was paid; it is removed.
 * - Every other payable goes into one new clearing transition, with sellers
 *   that currently fail their denomination witness deferred to a residual.
 *
 * Returns the sellers whose cash moved, for the caller's snapshot refresh.
 */
export async function clearProductAdvertisingPayables(
  db: Db,
  family: ProductAdvertisingFamily,
  turn: number
): Promise<ObjectId[]> {
  const journal = db.collection<ClearingJournalRecord>(MONEY_MOVE_COLLECTION);
  const payablesCollection = db.collection<ProductAdvertisingPayable>(
    PRODUCT_ADVERTISING_PAYABLES_COLLECTION
  );
  const touched = new Map<string, ObjectId>();
  const touch = (ids: ObjectId[]) => ids.forEach((id) => touched.set(id.toHexString(), id));
  const recordOf = (key: string) =>
    journal.findOne({ _id: key }, { projection: { status: 1, legs: 1, projections: 1 } });

  const inFlight = new Set<string>();
  const unfinished = await journal
    .find({ status: "partial", kind: clearingTransitionKind(family) }, { projection: { _id: 1 } })
    .toArray();
  for (const row of unfinished) {
    await resumeSettlement(db, row._id);
    const record = await recordOf(row._id);
    touch(paidSellerIds(record));
    const anyLegApplied = (record?.legs ?? []).some((leg) => leg.applied);
    const settled =
      record?.status === "applied" || (record?.status === "rejected" && !anyLegApplied);
    if (settled) continue;
    for (const projection of record?.projections ?? []) {
      for (const insert of projection.projection?.inserts ?? []) {
        if (typeof insert._id === "string") inFlight.add(insert._id);
      }
    }
  }

  const owed = await payablesCollection.find({ family }).sort({ _id: 1 }).toArray();
  if (owed.length === 0) return [...touched.values()];
  const cleared = new Set(
    (
      await db
        .collection<{ _id: string }>(PRODUCT_ADVERTISING_CLEARANCES_COLLECTION)
        .find({ _id: { $in: owed.map((payable) => payable._id) } }, { projection: { _id: 1 } })
        .toArray()
    ).map((row) => row._id)
  );
  if (cleared.size > 0) await payablesCollection.deleteMany({ _id: { $in: [...cleared] } });
  const due = owed.filter((payable) => !cleared.has(payable._id) && !inFlight.has(payable._id));
  if (due.length === 0) return [...touched.values()];

  const poolIds = [...new Set(due.map((payable) => payable.poolId))];
  const pools = await db
    .collection<ProductAdvertisingClearingPool>(PRODUCT_ADVERTISING_CLEARING_COLLECTION)
    .find({ _id: { $in: poolIds } }, { projection: { _id: 1, [CLEARING_POOL_BALANCE_PATH]: 1 } })
    .toArray();
  const canPay = await sellerEligibility(db, due);
  const transition = productAdvertisingClearingTransition(
    family,
    turn,
    due,
    new Map(pools.map((pool) => [pool._id, pool.cashLocal])),
    canPay
  );
  if (!transition) return [...touched.values()];
  const result = await settleTransition(db, transition);
  const record = await recordOf(transition.key);
  touch(paidSellerIds(record));
  if (result.status === "applied" || record?.status === "applied") {
    const clearedIds = (transition.projections.at(-1)?.inserts ?? []).map((row) => row._id);
    await payablesCollection.deleteMany({ _id: { $in: clearedIds as string[] } });
  }
  return [...touched.values()];
}
