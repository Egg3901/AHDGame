import { randomUUID } from "node:crypto";
import type { ClientSession, Db, ObjectId } from "mongodb";
import type { BondMarketPool, Bond, IndexFund, IndexFundTransaction } from "@/lib/db/types";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { corpCapitalToAnchor, loadFxRatesRecord } from "@/lib/currency/corporationCapital";
import { makeReserveBondUnitsStep } from "@/lib/bonds/bondHolderOps";
import { sovereignBondCapError } from "@/lib/bonds/holderCap";
import {
  advanceBondPoolSnapshot,
  ensureBondPoolShell,
  loadBondQuote,
  makeBondPoolCreditStep,
} from "@/lib/bonds/marketPool";
import { FUND_TRANSACTION_COLLECTION } from "@/lib/indexFunds/fundQueries";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  claimMoneyFlowReceipt,
  keyedInsertId,
  makeInsertStep,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";

export type PurchaseBondUnitsForFundResult =
  { ok: true; units: number; costAnchor: number; bondId: ObjectId } | { ok: false; reason: string };

/** Fund debit failed: cash raced below the cost. */
export const BOND_FUND_BUY_CASH = "BOND_FUND_BUY_CASH";
/** Holder reservation failed: the float raced below the units. */
export const BOND_FUND_BUY_RESERVE = "BOND_FUND_BUY_RESERVE";
/** Pool credit failed: the pool row vanished mid-flight (shell ensured). */
export const BOND_FUND_BUY_POOL = "BOND_FUND_BUY_POOL";
/** Fund-transaction insert failed after money moved (prefix compensated). */
export const BOND_FUND_BUY_TX = "BOND_FUND_BUY_TX";

function resolveBondCurrency(bond: Bond): CurrencyCode {
  return (bond.currencyCode ??
    (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
      ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
      : "USD")) as CurrencyCode;
}

/**
 * Buy bond units from public float on behalf of an index fund so the result
 * is exactly-once on every topology (issue #1672). Debits fund `cashAnchor`
 * (anchor currency) and credits `holders.fundId`, with the pool credit and
 * the fund-transaction row in the same keyed flow: step order mirrors the
 * historical write order (debit, reserve, pool credit, transaction row), and
 * a later failure compensates its own prefix (pool un-credit, unit release,
 * cash refund) instead of leaving a strand where the fund paid but holds
 * nothing.
 *
 * The caller may pass a stable `idempotencyKey` (plus `fingerprint`) when one
 * attempt must be retried after a crash; otherwise a key is minted per call
 * and a client retry is a new attempt guarded by the atomic holder claim,
 * exactly like the legacy debit-first path. The in-memory pool snapshot
 * advance is unchanged.
 */
export async function purchaseBondUnitsForFund(
  db: Db,
  fund: Pick<IndexFund, "_id" | "name" | "quotedNav" | "anchorCurrencyCode">,
  bond: Bond,
  units: number,
  options?: {
    /** Preloaded bond pools for a pass of many purchases; advanced as each credits its pool. */
    bondPools?: Map<CurrencyCode, BondMarketPool>;
    /** Stable key for crash-retry convergence. Omit to mint one per call. */
    idempotencyKey?: string;
    /** Fingerprint override; defaults to fund/bond/units/cost. */
    fingerprint?: string;
  }
): Promise<PurchaseBondUnitsForFundResult> {
  const wholeUnits = Math.floor(units);
  if (wholeUnits <= 0) return { ok: false, reason: "invalid_units" };
  if (bond.matured || bond.defaulted) return { ok: false, reason: "bond_unavailable" };
  if ((bond.publicFloat ?? 0) < wholeUnits) return { ok: false, reason: "insufficient_float" };
  if (sovereignBondCapError(bond, "fundId", fund._id, wholeUnits)) {
    return { ok: false, reason: "position_limit" };
  }

  const bondCurrency = resolveBondCurrency(bond);
  const fxRates = await loadFxRatesRecord(db);
  const bondFxRate =
    fxRates[bondCurrency] && fxRates[bondCurrency]! > 0 ? fxRates[bondCurrency]! : 1;
  const quote = await loadBondQuote(db, bond, { pools: options?.bondPools });
  const costLocal = wholeUnits * quote.askPerUnit;
  const costAnchor =
    Math.round(corpCapitalToAnchor(costLocal, bondCurrency, bondFxRate) * 100) / 100;
  if (costAnchor <= 0) return { ok: false, reason: "zero_cost" };

  const key = options?.idempotencyKey !== undefined ? options.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Bond fund purchase idempotency key must be 1-128 characters");
  }
  const fingerprint =
    options?.fingerprint ??
    `bond-fund-buy:${fund._id.toHexString()}:${bond._id.toHexString()}:${wholeUnits}:${costAnchor}`;
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const now = new Date();
  const pricePerUnit = quote.askPerUnit;

  const mapBuyError = (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error => {
    if (step.name === "fund-debit") return new Error(`${BOND_FUND_BUY_CASH}:${outcome}`);
    if (step.name === "holder-reserve") return new Error(`${BOND_FUND_BUY_RESERVE}:${outcome}`);
    if (step.name === "pool-credit") return new Error(`${BOND_FUND_BUY_POOL}:${outcome}`);
    return new Error(`${BOND_FUND_BUY_TX}:${outcome}`);
  };

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    // Money-neutral pool shell (see ensureBondPoolShell): safe on resumed
    // attempts, no cash moves.
    await ensureBondPoolShell(db, bondCurrency, now, opts);
    const claim = await claimMoneyFlowReceipt(receipts, key, fingerprint, opts);
    if (claim === "duplicate") return { duplicate: true as boolean };

    try {
      await runMoneyFlowSteps(
        receipts,
        key,
        [
          makeLegStep(key, {
            name: "fund-debit",
            collection: db.collection<IndexFund>("indexFunds"),
            docId: fund._id,
            field: "cashAnchor",
            delta: -costAnchor,
            minBalance: costAnchor,
            set: { updatedAt: now },
          }),
          makeReserveBondUnitsStep(
            key,
            db,
            bond._id,
            { field: "fundId", id: fund._id },
            wholeUnits,
            now,
            {
              avgCostPerUnit: pricePerUnit,
            }
          ),
          makeBondPoolCreditStep(key, db, bondCurrency, costLocal, "purchasesIn", now),
          makeInsertStep<IndexFundTransaction>(
            "fund-tx",
            db.collection<IndexFundTransaction>(FUND_TRANSACTION_COLLECTION),
            {
              _id: keyedInsertId(key, "fund-bond-tx"),
              fundId: fund._id,
              kind: "bond_allocation",
              amountAnchor: costAnchor,
              navAnchor: fund.quotedNav,
              note: `Purchased ${wholeUnits} bond units (${bond.issuerName ?? "sovereign"})`,
              createdAt: now,
            }
          ),
        ],
        mapBuyError,
        opts
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      // A lost cash race settles `failed` with nothing applied; a lost float
      // race compensates the debit and reports the historical
      // `reservation_failed`. Anything later is pathological (the shell is
      // ensured, the insert id is deterministic) and throws after
      // compensation, like the legacy refund-and-rethrow.
      if (message.startsWith(BOND_FUND_BUY_CASH)) {
        return { ok: false as const, reason: "insufficient_fund_cash" };
      }
      if (message.startsWith(BOND_FUND_BUY_RESERVE)) {
        return { ok: false as const, reason: "reservation_failed" };
      }
      throw error;
    }
    return { duplicate: claim === "in-progress" };
  };

  const outcome = await runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
  if ("ok" in outcome && !outcome.ok) return outcome;

  // A same-key replay already credited the pool on the first attempt (and
  // advanced the caller's snapshot then); advancing again would double-count
  // the in-memory quote aid.
  if (!outcome.duplicate) {
    advanceBondPoolSnapshot(options?.bondPools, bondCurrency, costLocal);
  }

  return { ok: true, units: wholeUnits, costAnchor, bondId: bond._id };
}
