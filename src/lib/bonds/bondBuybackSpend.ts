import { randomUUID } from "node:crypto";
import type { ClientSession, Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  failMoneyFlowReceipt,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { Bond, Corporation } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { ensureBondPoolShell, makeBondPoolCreditStep } from "@/lib/bonds/marketPool";
import { getCountryForCurrency } from "@/lib/currency/marketMaker";
import {
  makeSpreadDistributionStepsForFees,
  type SpreadDistributionSpec,
} from "@/lib/currency/spreadFees";

export interface BondBuybackSpendInput {
  bondId: ObjectId;
  /** Issuing corporation whose liquid capital pays for the retired units. */
  corpId: ObjectId;
  units: number;
  /** LOCAL cost in the bond's currency: corp-debit basis and pool credit. */
  costLocal: number;
  /** Cost in the corp's own liquid capital (FX-normalized, spread included). */
  costInCorpCapital: number;
  /** Bond currency (pool credit denomination). */
  bondCurrency: CurrencyCode;
  /** Corp liquid currency, for the cross-currency spread routing. */
  corpCurrency: CurrencyCode;
  /** FX spread the corp paid (0 for same-currency buybacks). */
  spreadFee: number;
  now: Date;
  /**
   * Caller-chosen fingerprint of the intended buyback
   * (e.g. `bond-buyback:<bondId>:<corpId>:<units>:<costLocal>:<costCapital>`).
   * A retry presenting the same key with a different fingerprint is rejected
   * instead of returning the stored outcome for the wrong buyback.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same buyback replays the stored outcome instead
   * of retiring again. Omit to mint one: the attempt is still crash-safe
   * within the attempt, but a client retry mints a new key and is treated as
   * a new attempt (still guarded by the atomic float claim).
   */
  idempotencyKey?: string;
}

/** Corp debit failed: liquid capital raced below the cost. */
export const BOND_BUYBACK_FUNDS = "BOND_BUYBACK_FUNDS";
/** Float claim failed: the float raced below the units (or the bond went). */
export const BOND_BUYBACK_FLOAT = "BOND_BUYBACK_FLOAT";
/** Pool credit failed: the pool row vanished mid-flight (shell ensured). */
export const BOND_BUYBACK_POOL = "BOND_BUYBACK_POOL";
/** Spread routing failed: a central-bank write disappeared mid-flight. */
export const BOND_BUYBACK_SPREAD = "BOND_BUYBACK_SPREAD";

function mapBuybackError(stepName: string, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical surface: a lost corp-funds race was
  // `Insufficient corporate funds (race ...)` (400), a lost float race the
  // `Only N units available` refusal (400). Anything after money moved
  // compensates the prefix instead of stranding a half-landed buyback.
  if (stepName === "corp-debit") return new Error(`${BOND_BUYBACK_FUNDS}:${outcome}`);
  if (stepName === "float-claim") return new Error(`${BOND_BUYBACK_FLOAT}:${outcome}`);
  if (stepName === "pool-credit") return new Error(`${BOND_BUYBACK_POOL}:${outcome}`);
  return new Error(`${BOND_BUYBACK_SPREAD}:${outcome}`);
}

/**
 * Retire bond units from the public float for the issuing corporation so the
 * result is exactly-once on every topology (issue #1672). Step order mirrors
 * the historical write order: the guarded corp debit lands first, the float
 * claim second, the pool credit third, the FX spread routing last, and a
 * later failure compensates its own prefix (pool un-credit, float restore,
 * corp refund) instead of leaving a strand where the corp paid but the float
 * never shrank.
 *
 * The full-retirement transition (`matured`, `marketPrice`) stays OUTSIDE the
 * keyed flow as a post-commit best effort in the route: it moves no value
 * (only lifecycle flags on an empty float), so skipping it on failure is
 * harmless, while making it a terminal step would settle `UNCOMPENSATED` on
 * money that already moved. Same for the zero-unit holder sweep, which the
 * buyback never creates (it touches no holder rows).
 *
 * Under real transactions the debit, the claim, the pool credit, the spread
 * slices, and the idempotency receipt join the transaction and commit
 * atomically, preserving the old behavior. On a standalone deployment the
 * fallback runs the same writes as keyed idempotent steps: a crash between
 * any two writes leaves an `in_progress` receipt, and retrying with the same
 * key reconciles to exactly one buyback. A retry after a terminal failure
 * throws `MoneyFlowTerminalError` (fail closed); a new attempt needs a new
 * key.
 */
export async function applyBondBuybackSpend(
  db: Db,
  input: BondBuybackSpendInput
): Promise<{ duplicate: boolean }> {
  if (!input.bondId || !input.corpId) {
    throw new TypeError("Bond buyback spend needs bondId and corpId");
  }
  if (!Number.isInteger(input.units) || input.units <= 0) {
    throw new RangeError("Bond buyback units must be a positive integer");
  }
  if (!Number.isFinite(input.costLocal) || !Number.isFinite(input.costInCorpCapital)) {
    throw new RangeError("Bond buyback costs must be finite");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Bond buyback idempotency key must be 1-128 characters");
  }

  const bonds = db.collection<Bond>("bonds");
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const now = input.now;
  const retiredFaceValue = input.units * BOND_UNIT_FACE_VALUE;

  // The cross-currency spread routing as a keyed spec. Same mapping as the
  // legacy `distributeConversionSpread` (currency home countries, fee in the
  // corp's currency): same split, same banks, same no-ops when the fee is
  // zero, same currency, or unmapped.
  const spreadSpecs: SpreadDistributionSpec[] = [];
  if (
    Number.isFinite(input.spreadFee) &&
    input.spreadFee > 0 &&
    input.corpCurrency !== input.bondCurrency
  ) {
    const fromCountry = getCountryForCurrency(input.corpCurrency);
    if (fromCountry) {
      spreadSpecs.push({
        totalFee: input.spreadFee,
        sourceCountryId: fromCountry,
        currencyCode: input.corpCurrency,
        destinationCountryId: getCountryForCurrency(input.bondCurrency) ?? undefined,
      });
    }
  }

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    // Money-neutral: creates a zeroed pool row for a currency that never
    // traded, so the keyed credit below always finds its document. Safe on
    // resumed attempts (no cash moves).
    await ensureBondPoolShell(db, input.bondCurrency, now, opts);
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") return { duplicate: true as boolean };
    // A fresh claim owns the attempt, so a validation failure settles the
    // receipt `failed` (nothing applied yet — truthful). A resumed
    // `in-progress` claim never settles here: the crashed prefix may have
    // moved money, so it reconciles through the keyed steps below instead.
    const fresh = claim === "fresh";
    if (fresh && !(input.costLocal > 0 && input.costInCorpCapital > 0)) {
      await failMoneyFlowReceipt(receipts, key, `${BOND_BUYBACK_FUNDS}:zero-cost`, opts);
      throw new Error(`${BOND_BUYBACK_FUNDS}:zero-cost`);
    }

    const floatClaimStep: MoneyFlowStep = {
      name: "float-claim",
      apply: (stepOpts) =>
        applyKeyedUpdate(
          key,
          {
            collection: bonds,
            filter: { _id: input.bondId, matured: false, publicFloat: { $gte: input.units } },
            update: {
              $inc: { publicFloat: -input.units, totalIssued: -retiredFaceValue },
              $set: { updatedAt: now },
            },
          },
          stepOpts ?? {}
        ),
      revert: (stepOpts) =>
        applyKeyedUpdate(
          `${key}:compensate:float-claim`,
          {
            collection: bonds,
            filter: { _id: input.bondId },
            update: {
              $inc: { publicFloat: input.units, totalIssued: retiredFaceValue },
              $set: { updatedAt: now },
            },
          },
          stepOpts ?? {}
        ),
    };

    await runMoneyFlowSteps(
      receipts,
      key,
      [
        makeLegStep(key, {
          name: "corp-debit",
          collection: db.collection<Corporation>("corporations"),
          docId: input.corpId,
          field: "liquidCapital",
          delta: -input.costInCorpCapital,
          minBalance: input.costInCorpCapital,
          set: { updatedAt: now },
        }),
        floatClaimStep,
        makeBondPoolCreditStep(key, db, input.bondCurrency, input.costLocal, "retiredIn", now),
        ...makeSpreadDistributionStepsForFees(db, key, spreadSpecs),
      ],
      (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) => mapBuybackError(step.name, outcome),
      opts
    );
    return { duplicate: claim === "in-progress" };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}
