import { ObjectId, type Collection, type Db, type Filter } from "mongodb";
import {
  applyIdempotentLeg,
  applyKeyedUpdate,
  deriveMoneyFlowKey,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  type MoneyFlowLeg,
  type MoneyFlowLegOutcome,
  type MoneyFlowReceipt,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";

/** Cap-table entry discriminator inside `corporations.shareholders`. */
export type ShareFillCapEntryField =
  "characterId" | "imperialCharacterId" | "corporationId" | "fundId";

/** Wallet/treasury collections a cash leg can target. */
export type ShareFillCashCollection =
  "characters" | "imperialCharacters" | "corporations" | "indexFunds";

export interface ShareFillCashLeg {
  collection: ShareFillCashCollection;
  idHex: string;
  /** Dotted balance field pinned at claim time (e.g. `currencyBalances.personal.USD`). */
  field: string;
  amount: number;
}

export interface ShareFillCapLeg {
  field: ShareFillCapEntryField;
  idHex: string;
  /** Weighted-average basis for credits; compensation basis for debits. */
  pricePerShare: number;
}

export type ShareFillMoneyDirection = "sell-fill" | "buy-fill";

/**
 * Immutable resume plan persisted on the money receipt before the first leg.
 * Every id, amount, currency field, and display-neutral number is pinned
 * here at claim time; recovery never reprices from post-fill state.
 */
export interface ShareFillMoneyPlan {
  version: 1;
  /** Audit attempt key this money flow belongs to (bridge to audit recovery). */
  fillKey: string;
  orderIdHex: string;
  /** Target corp whose cap table moves. */
  corpIdHex: string;
  direction: ShareFillMoneyDirection;
  shares: number;
  turn: number;
  nowIso: string;
  /** Sell-fill only: filler cash debit. Null on buy-fills. */
  fillerDebit: ShareFillCashLeg | null;
  /** Buy-fill only: escrow release credit to the filler. Null on sell-fills. */
  fillerCredit: ShareFillCashLeg | null;
  /** Seller cap-table debit. Null when placement pre-debited or placer is corp/fund. */
  sellerDebit: ShareFillCapLeg | null;
  /** Buyer cap-table credit (filler on sell-fills, placer on buy-fills). */
  buyerCredit: ShareFillCapLeg;
  /** Sell-fill against a fund placer: dual-ledger inventory debit. */
  fundInventoryDebit: { fundIdHex: string; pricePerShareAnchor: number } | null;
  /** Buy-fill into a fund bid: fund holdings credit. */
  buyerHoldingsCredit: { fundIdHex: string; pricePerShareAnchor: number } | null;
  /** Seller proceeds. Null only when the placer is a fund on a buy-fill (no proceeds leg). */
  sellerProceeds: ShareFillCashLeg | null;
  outcome?: ShareFillMoneyOutcome;
}

export interface ShareFillMoneyOutcome {
  sharesMoved: number;
  fillerBalanceAfter?: number;
}

export function isShareFillMoneyPlan(value: unknown): value is ShareFillMoneyPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.fillKey === "string" &&
    typeof plan.corpIdHex === "string" &&
    (plan.direction === "sell-fill" || plan.direction === "buy-fill") &&
    typeof plan.shares === "number" &&
    typeof plan.buyerCredit === "object" &&
    plan.buyerCredit !== null
  );
}

/** Money receipt key, derived from the audit attempt key (restart needs only the fill key). */
export function buildShareFillMoneyKey(fillKey: string): string {
  return deriveMoneyFlowKey(fillKey, "money");
}

/**
 * Wallet balance field for a character/imperial cash leg, pinned at claim
 * time. Mirrors the dispatch in `buildPersonalBalanceInc` /
 * `atomicallyDebitCharacterCash` so keyed legs hit the same field the
 * legacy guarded debits did.
 */
export function personalBalanceField(currency: string, forexEnabled: boolean): string {
  return forexEnabled ? `currencyBalances.personal.${currency}` : "cashOnHand";
}

/**
 * Fingerprint covering every pinned number and party, so a key reused for a
 * different fill fails closed instead of replaying the wrong transfer.
 */
export function buildShareFillMoneyFingerprint(plan: ShareFillMoneyPlan): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  const cash = (leg: ShareFillCashLeg | null): string =>
    leg ? `${leg.collection}:${leg.idHex}:${leg.field}:${cents(leg.amount)}` : "none";
  const cap = (leg: ShareFillCapLeg | null): string =>
    leg ? `${leg.field}:${leg.idHex}:${cents(leg.pricePerShare)}` : "none";
  return [
    "share-fill-money",
    plan.corpIdHex,
    plan.orderIdHex,
    plan.direction,
    `shares:${plan.shares}`,
    `fillerDebit:${cash(plan.fillerDebit)}`,
    `fillerCredit:${cash(plan.fillerCredit)}`,
    `sellerDebit:${cap(plan.sellerDebit)}`,
    `buyerCredit:${cap(plan.buyerCredit)}`,
    plan.fundInventoryDebit
      ? `fundInv:${plan.fundInventoryDebit.fundIdHex}:${cents(plan.fundInventoryDebit.pricePerShareAnchor)}`
      : "fundInv:none",
    plan.buyerHoldingsCredit
      ? `holdings:${plan.buyerHoldingsCredit.fundIdHex}:${cents(plan.buyerHoldingsCredit.pricePerShareAnchor)}`
      : "holdings:none",
    `proceeds:${cash(plan.sellerProceeds)}`,
    `turn:${plan.turn}`,
  ].join(":");
}

export type ShareFillMoneyReceipt = MoneyFlowReceipt & { shareFillMoneyPlan?: ShareFillMoneyPlan };

export function receipts(db: Db): Collection<MoneyFlowReceipt> {
  return db.collection<MoneyFlowReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

export function receiptsEx(db: Db): Collection<ShareFillMoneyReceipt> {
  return db.collection<ShareFillMoneyReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

/**
 * Deterministic-insert domain for the fund-proceeds ledger row the sell-fill
 * route emits post-commit (one row per attempt key, convergent on retry).
 */
export const SHARE_FILL_FUND_SELL_TX_DOMAIN = "share-fill-fund-sell-tx";

/** Legacy-preserving error codes thrown by the money flow. */
export const SHARE_FILL_MONEY_INSUFFICIENT_FUNDS = "SHARE_FILL_MONEY_INSUFFICIENT_FUNDS";
export const SHARE_FILL_MONEY_SELLER_SHARES = "SHARE_FILL_MONEY_SELLER_SHARES";
export const SHARE_FILL_MONEY_LIQUIDITY_SHARES = "SHARE_FILL_MONEY_LIQUIDITY_SHARES";

export function mapMoneyError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  if (step.name === "filler-debit") {
    return new Error(`${SHARE_FILL_MONEY_INSUFFICIENT_FUNDS}:${outcome}`);
  }
  if (step.name === "seller-debit") {
    return new Error(`${SHARE_FILL_MONEY_SELLER_SHARES}:${outcome}`);
  }
  if (step.name === "fund-inventory-debit") {
    return new Error(`${SHARE_FILL_MONEY_LIQUIDITY_SHARES}:${outcome}`);
  }
  if (step.name === "filler-shares-debit") {
    return new Error(`${SHARE_FILL_MONEY_SELLER_SHARES}:${outcome}`);
  }
  return new Error(`share-fill-money:${step.name}:${outcome}`);
}

interface CapAccount {
  _id: ObjectId;
  appliedMoneyFlowKeys?: string[];
}

interface HoldingAccount {
  _id: ObjectId;
  appliedMoneyFlowKeys?: string[];
}

/**
 * Keyed cap-table debit: `$elemMatch` sufficiency + `$ne: key` + `$inc` in
 * one atomic update (the same guard `debitShares` performs with
 * `requireSufficient`), then a best-effort pull of zero-share rows. The pull
 * is naturally idempotent (plain `$pull` on `shares: {$lte: 0}`), so a crash
 * between the two converges on retry: the debit reports `already-applied`
 * and the pull runs again.
 */
export function makeCapDebitStep(
  db: Db,
  subkey: string,
  corpId: ObjectId,
  leg: ShareFillCapLeg,
  shares: number,
  now: Date
): MoneyFlowStep {
  const corps = db.collection<CapAccount>("corporations");
  return {
    name: "seller-debit",
    apply: async () => {
      const outcome = await applyKeyedUpdate(
        subkey,
        {
          collection: corps,
          filter: {
            _id: corpId,
            shareholders: {
              $elemMatch: { [leg.field]: new ObjectId(leg.idHex), shares: { $gte: shares } },
            },
          } as Filter<CapAccount>,
          update: {
            $inc: { "shareholders.$.shares": -shares },
            $set: { updatedAt: now },
          },
        },
        {}
      );
      if (outcome !== "applied" && outcome !== "already-applied") return outcome;
      await corps.updateOne(
        { _id: corpId } as Filter<CapAccount>,
        {
          $pull: { shareholders: { [leg.field]: new ObjectId(leg.idHex), shares: { $lte: 0 } } },
        } as never
      );
      return outcome;
    },
    revert: async () => {
      const revertOutcome = await applyCapCreditKeyed(
        db,
        deriveMoneyFlowKey(subkey, "compensate", "seller-debit"),
        corpId,
        leg,
        shares,
        now
      );
      return revertOutcome;
    },
  };
}

/**
 * Keyed cap-table credit mirroring the legacy inc/push/inc triple
 * (`creditShares`, `creditSharesToCorp`, `creditSharesToFund`,
 * `creditSharesToImperial`): positional increment when the row exists, push
 * when it does not, increment once more when a row raced in between. All
 * three variants share ONE subkey recorded on the parent corp doc, so a
 * retry after the push applied converges at the increment as
 * `already-applied` instead of crediting twice.
 */
export async function applyCapCreditKeyed(
  db: Db,
  subkey: string,
  corpId: ObjectId,
  leg: ShareFillCapLeg,
  shares: number,
  now: Date
): Promise<MoneyFlowLegOutcome> {
  const corps = db.collection<CapAccount>("corporations");
  const entryId = new ObjectId(leg.idHex);
  const attemptInc = async (): Promise<MoneyFlowLegOutcome> => {
    const live = await corps.findOne({ _id: corpId } as Filter<CapAccount>, {
      projection: { shareholders: 1 },
    });
    if (!live) return "missing";
    const existing = (
      live as unknown as {
        shareholders?: Array<
          { shares: number; avgCostPerShare?: number } & Record<string, unknown>
        >;
      }
    ).shareholders?.find((entry) => {
      const value = entry[leg.field];
      return value instanceof ObjectId && value.equals(entryId);
    });
    if (!existing) return "guard-rejected";
    const price = leg.pricePerShare;
    const newAvg =
      existing.shares > 0
        ? (existing.shares * (existing.avgCostPerShare ?? price) + shares * price) /
          (existing.shares + shares)
        : price;
    return applyKeyedUpdate(
      subkey,
      {
        collection: corps,
        filter: {
          _id: corpId,
          [`shareholders.${leg.field}`]: entryId,
        } as Filter<CapAccount>,
        update: {
          $inc: { "shareholders.$.shares": shares },
          $set: { "shareholders.$.avgCostPerShare": newAvg, updatedAt: now },
        },
      },
      {}
    );
  };

  const first = await attemptInc();
  if (first === "applied" || first === "already-applied") return first;
  if (first === "missing") return first;

  const pushed = await applyKeyedUpdate(
    subkey,
    {
      collection: corps,
      filter: {
        _id: corpId,
        shareholders: { $not: { $elemMatch: { [leg.field]: entryId } } },
      } as Filter<CapAccount>,
      update: {
        $push: {
          shareholders: {
            [leg.field]: entryId,
            shares,
            avgCostPerShare: leg.pricePerShare,
          },
        },
        $set: { updatedAt: now },
      },
    },
    {}
  );
  if (pushed === "applied" || pushed === "already-applied") return pushed;
  if (pushed === "missing") return pushed;

  return attemptInc();
}

/**
 * Inverse of the keyed cap-table credit: pulls the row when it holds at
 * most the credited shares (the push variant applied), otherwise removes
 * exactly this credit from the live entry with the exact inverse of the
 * weighted-average apply. A vanished entry means the effect is already
 * gone, so the revert converges.
 */
async function revertCapCreditKeyed(
  db: Db,
  subkey: string,
  corpId: ObjectId,
  leg: ShareFillCapLeg,
  shares: number,
  now: Date
): Promise<MoneyFlowLegOutcome> {
  const corps = db.collection<CapAccount>("corporations");
  const entryId = new ObjectId(leg.idHex);
  const live = await corps.findOne({ _id: corpId } as Filter<CapAccount>, {
    projection: { shareholders: 1 },
  });
  if (!live) return "missing";
  const entry = (
    live as unknown as {
      shareholders?: Array<{ shares: number; avgCostPerShare?: number } & Record<string, unknown>>;
    }
  ).shareholders?.find((row) => {
    const value = row[leg.field];
    return value instanceof ObjectId && value.equals(entryId);
  });
  if (!entry) return "already-applied";
  if (entry.shares <= shares) {
    return applyKeyedUpdate(
      subkey,
      {
        collection: corps,
        filter: { _id: corpId } as Filter<CapAccount>,
        update: {
          $pull: { shareholders: { [leg.field]: entryId } },
          $set: { updatedAt: now },
        },
      },
      {}
    );
  }
  const price = leg.pricePerShare;
  const restoredAvg =
    (entry.shares * (entry.avgCostPerShare ?? price) - shares * price) / (entry.shares - shares);
  return applyKeyedUpdate(
    subkey,
    {
      collection: corps,
      // The row must still exist for the positional `$` to resolve: real
      // Mongo throws when the update carries `shareholders.$` but the
      // filter names no array element, so a bare `{ _id }` filter would
      // crash compensation instead of reverting.
      filter: {
        _id: corpId,
        [`shareholders.${leg.field}`]: entryId,
      } as Filter<CapAccount>,
      update: {
        $inc: { "shareholders.$.shares": -shares },
        $set: { "shareholders.$.avgCostPerShare": restoredAvg, updatedAt: now },
      },
    },
    {}
  );
}

export function makeCapCreditStep(
  db: Db,
  name: string,
  subkey: string,
  corpId: ObjectId,
  leg: ShareFillCapLeg,
  shares: number,
  now: Date
): MoneyFlowStep {
  return {
    name,
    apply: () => applyCapCreditKeyed(db, subkey, corpId, leg, shares, now),
    revert: () =>
      revertCapCreditKeyed(
        db,
        deriveMoneyFlowKey(subkey, "compensate", name),
        corpId,
        leg,
        shares,
        now
      ),
  };
}

/**
 * Keyed fund-holdings debit: the `$elemMatch` sufficiency guard
 * `debitFundHoldingShares` performs, carrying the subkey, plus the same
 * zero-row pull and `lastValueAnchor` repair as best effort. The repair
 * reads live state and writes a `$set`, both naturally idempotent, so a
 * retry converges.
 */
function makeHoldingsDebitStep(
  db: Db,
  subkey: string,
  fundId: ObjectId,
  corpId: ObjectId,
  shares: number,
  pricePerShareAnchor: number,
  now: Date
): MoneyFlowStep {
  const funds = db.collection<HoldingAccount>("indexFunds");
  return {
    name: "fund-holdings-debit",
    apply: async () => {
      const outcome = await applyKeyedUpdate(
        subkey,
        {
          collection: funds,
          filter: {
            _id: fundId,
            holdings: { $elemMatch: { corporationId: corpId, shares: { $gte: shares } } },
          } as Filter<HoldingAccount>,
          update: {
            $inc: { "holdings.$.shares": -shares },
            $set: { "holdings.$.lastValueAnchor": 0, updatedAt: now },
          },
        },
        {}
      );
      if (outcome !== "applied" && outcome !== "already-applied") return outcome;
      const holding = await funds.findOne({ _id: fundId } as Filter<HoldingAccount>, {
        projection: { holdings: 1 },
      });
      const rows = (
        holding as unknown as {
          holdings?: Array<{ corporationId: ObjectId; shares: number }>;
        } | null
      )?.holdings;
      const remaining = rows?.find((row) => row.corporationId.equals(corpId));
      if (!remaining || remaining.shares <= 0) {
        await funds.updateOne(
          { _id: fundId } as Filter<HoldingAccount>,
          {
            $pull: { holdings: { corporationId: { $eq: corpId }, shares: { $lte: 0 } } },
          } as never
        );
      } else {
        await funds.updateOne(
          { _id: fundId, "holdings.corporationId": corpId } as Filter<HoldingAccount>,
          {
            $set: { "holdings.$.lastValueAnchor": remaining.shares * pricePerShareAnchor },
          } as never
        );
      }
      return outcome;
    },
    revert: async () => {
      const revertOutcome = await applyHoldingsCreditKeyed(
        db,
        deriveMoneyFlowKey(subkey, "compensate", "fund-holdings-debit"),
        fundId,
        corpId,
        shares,
        pricePerShareAnchor,
        now
      );
      return revertOutcome;
    },
  };
}

/**
 * Keyed fund-holdings credit mirroring `upsertFundHoldingShares`
 * (increment with blended average when the row exists, push when it does
 * not, increment once more on a race), all variants under one subkey
 * recorded on the parent fund doc.
 */
export async function applyHoldingsCreditKeyed(
  db: Db,
  subkey: string,
  fundId: ObjectId,
  corpId: ObjectId,
  shares: number,
  pricePerShareAnchor: number,
  now: Date
): Promise<MoneyFlowLegOutcome> {
  const funds = db.collection<HoldingAccount>("indexFunds");
  const safePrice = Number.isFinite(pricePerShareAnchor) ? Math.max(0, pricePerShareAnchor) : 0;
  const attemptInc = async (): Promise<MoneyFlowLegOutcome> => {
    const live = await funds.findOne({ _id: fundId } as Filter<HoldingAccount>, {
      projection: { holdings: 1 },
    });
    if (!live) return "missing";
    const existing = (
      live as unknown as {
        holdings?: Array<{
          corporationId: ObjectId;
          shares: number;
          avgCostPerShareAnchor?: number;
        }>;
      }
    ).holdings?.find((row) => row.corporationId.equals(corpId));
    if (!existing) return "guard-rejected";
    const newShares = existing.shares + shares;
    const newAvg =
      existing.avgCostPerShareAnchor !== undefined
        ? (existing.shares * existing.avgCostPerShareAnchor + shares * safePrice) / newShares
        : safePrice;
    return applyKeyedUpdate(
      subkey,
      {
        collection: funds,
        filter: {
          _id: fundId,
          "holdings.corporationId": corpId,
        } as Filter<HoldingAccount>,
        update: {
          $inc: { "holdings.$.shares": shares },
          $set: {
            "holdings.$.avgCostPerShareAnchor": newAvg,
            "holdings.$.lastValueAnchor": newShares * safePrice,
            updatedAt: now,
          },
        },
      },
      {}
    );
  };

  const first = await attemptInc();
  if (first === "applied" || first === "already-applied") return first;
  if (first === "missing") return first;

  const pushed = await applyKeyedUpdate(
    subkey,
    {
      collection: funds,
      filter: {
        _id: fundId,
        holdings: { $not: { $elemMatch: { corporationId: corpId } } },
      } as Filter<HoldingAccount>,
      update: {
        $push: {
          holdings: {
            corporationId: corpId,
            shares,
            avgCostPerShareAnchor: safePrice,
            lastValueAnchor: shares * safePrice,
          },
        },
        $set: { updatedAt: now },
      },
    },
    {}
  );
  if (pushed === "applied" || pushed === "already-applied") return pushed;
  if (pushed === "missing") return pushed;

  return attemptInc();
}

export async function revertHoldingsCreditKeyed(
  db: Db,
  subkey: string,
  fundId: ObjectId,
  corpId: ObjectId,
  shares: number,
  pricePerShareAnchor: number,
  now: Date
): Promise<MoneyFlowLegOutcome> {
  const funds = db.collection<HoldingAccount>("indexFunds");
  const live = await funds.findOne({ _id: fundId } as Filter<HoldingAccount>, {
    projection: { holdings: 1 },
  });
  if (!live) return "missing";
  const entry = (
    live as unknown as {
      holdings?: Array<{ corporationId: ObjectId; shares: number; avgCostPerShareAnchor?: number }>;
    }
  ).holdings?.find((row) => row.corporationId.equals(corpId));
  if (!entry) return "already-applied";
  const safePrice = Number.isFinite(pricePerShareAnchor) ? Math.max(0, pricePerShareAnchor) : 0;
  if (entry.shares <= shares) {
    return applyKeyedUpdate(
      subkey,
      {
        collection: funds,
        filter: { _id: fundId } as Filter<HoldingAccount>,
        update: {
          $pull: { holdings: { corporationId: corpId } },
          $set: { updatedAt: now },
        },
      },
      {}
    );
  }
  const restoredAvg =
    entry.avgCostPerShareAnchor !== undefined
      ? (entry.shares * entry.avgCostPerShareAnchor - shares * safePrice) / (entry.shares - shares)
      : safePrice;
  return applyKeyedUpdate(
    subkey,
    {
      collection: funds,
      filter: {
        _id: fundId,
        "holdings.corporationId": corpId,
      } as Filter<HoldingAccount>,
      update: {
        $inc: { "holdings.$.shares": -shares },
        $set: {
          "holdings.$.avgCostPerShareAnchor": restoredAvg,
          "holdings.$.lastValueAnchor": (entry.shares - shares) * safePrice,
          updatedAt: now,
        },
      },
    },
    {}
  );
}

/** Plain wallet/treasury `$inc` as a revertible keyed step (debits gate `$gte`). */
export function makeCashStep(
  db: Db,
  name: string,
  key: string,
  leg: ShareFillCashLeg,
  debit: boolean,
  now: Date
): MoneyFlowStep {
  const collection = db.collection<{ _id: ObjectId; appliedMoneyFlowKeys?: string[] }>(
    leg.collection
  );
  const moneyLeg: MoneyFlowLeg<{ _id: ObjectId; appliedMoneyFlowKeys?: string[] }> = {
    name,
    collection,
    docId: new ObjectId(leg.idHex),
    field: leg.field,
    delta: debit ? -leg.amount : leg.amount,
    ...(debit ? { minBalance: leg.amount } : {}),
    set: { updatedAt: now },
  };
  return {
    name,
    apply: (options) => applyIdempotentLeg(key, moneyLeg, options ?? {}),
    revert: (options) =>
      applyIdempotentLeg(
        deriveMoneyFlowKey(key, "compensate", name),
        {
          ...moneyLeg,
          delta: debit ? leg.amount : -leg.amount,
          minBalance: undefined,
          extraFilter: undefined,
        },
        options ?? {}
      ),
  };
}

/**
 * Fund-inventory debit as one step with a keyed inverse: cap-table debit
 * first, then the holdings-ledger debit. A crash between the two converges
 * on retry (each subleg is keyed); the revert reverses both in order, so
 * the prefix never strands half-moved inventory.
 */
export function makeFundInventoryDebitStep(
  db: Db,
  moneyKey: string,
  corpId: ObjectId,
  fundId: ObjectId,
  shares: number,
  pricePerShareAnchor: number,
  now: Date
): MoneyFlowStep {
  const capSub = deriveMoneyFlowKey(moneyKey, "fund-inventory-debit", "cap");
  const holdingsSub = deriveMoneyFlowKey(moneyKey, "fund-inventory-debit", "holdings");
  const capStep = makeCapDebitStep(
    db,
    capSub,
    corpId,
    { field: "fundId", idHex: fundId.toHexString(), pricePerShare: pricePerShareAnchor },
    shares,
    now
  );
  const holdingsStep = makeHoldingsDebitStep(
    db,
    holdingsSub,
    fundId,
    corpId,
    shares,
    pricePerShareAnchor,
    now
  );
  return {
    name: "fund-inventory-debit",
    apply: async () => {
      const capOutcome = await capStep.apply();
      if (capOutcome !== "applied" && capOutcome !== "already-applied") return capOutcome;
      const holdingsOutcome = await holdingsStep.apply();
      if (holdingsOutcome === "applied" || holdingsOutcome === "already-applied") {
        return holdingsOutcome;
      }
      // The cap-table subleg landed but the holdings ledger refused (liquidity
      // race): reverse our own sub-prefix before reporting failure. A failed
      // step's revert never runs, so without this the cap debit would strand
      // while the receipt settles compensated. The compensate write is keyed,
      // so a crash here converges on retry instead of double-reverting.
      if (capStep.revert) {
        const reversal = await capStep.revert();
        if (reversal !== "applied" && reversal !== "already-applied") {
          throw new Error(`share-fill-money:fund-inventory-debit:compensate-${reversal}`);
        }
      }
      return holdingsOutcome;
    },
    revert: async () => {
      const holdingsRevert = holdingsStep.revert ? await holdingsStep.revert() : "guard-rejected";
      if (holdingsRevert !== "applied" && holdingsRevert !== "already-applied") {
        return holdingsRevert;
      }
      if (!capStep.revert) return "guard-rejected";
      return capStep.revert();
    },
  };
}
