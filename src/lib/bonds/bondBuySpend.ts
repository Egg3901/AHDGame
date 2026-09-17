import { randomUUID } from "node:crypto";
import type { ClientSession, Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  claimMoneyFlowReceipt,
  failMoneyFlowReceipt,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { Character, Corporation, NPP } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { makeReserveBondUnitsStep, type BondHolderTarget } from "@/lib/bonds/bondHolderOps";
import { ensureBondPoolShell, makeBondPoolCreditStep } from "@/lib/bonds/marketPool";
import { getCountryForCurrency } from "@/lib/currency/marketMaker";
import {
  makeSpreadDistributionStepsForFees,
  type SpreadDistributionSpec,
} from "@/lib/currency/spreadFees";

export type BondBuyerKind = "character" | "imperial" | "corporation" | "npp";

export interface BondBuySpendInput {
  bondId: ObjectId;
  buyerKind: BondBuyerKind;
  /** Character, imperial character, corporation, or NPP id buying the units. */
  buyerId: ObjectId;
  units: number;
  /**
   * Amount debited from the buyer's own balance, in the buyer's own
   * denomination: `costLocal` for characters/imperials (bond currency),
   * `costInCorpCapital` for corporations (liquid capital), `costAnchor` for
   * NPPs (investment cash anchor).
   */
  debitAmount: number;
  /** LOCAL cost in the bond's currency: pool credit basis. */
  costLocal: number;
  /** Bond currency (pool credit + personal debit denomination). */
  bondCurrency: CurrencyCode;
  /** Personal debit field set (`currencyBalances.personal.*` vs `cashOnHand`). */
  forexEnabled: boolean;
  /** Corp liquid currency, for cross-currency spread routing (corp only). */
  corpCurrency?: CurrencyCode;
  /** FX spread the corp paid (0 for same-currency buys; corp only). */
  spreadFee?: number;
  /** Per-unit cost recorded on a new NPP holder row (NPP only). */
  avgCostPerUnit?: number;
  now: Date;
  /**
   * Caller-chosen fingerprint of the intended purchase
   * (e.g. `bond-buy:<bondId>:<kind>:<buyerId>:<units>:<costLocal>`). A retry
   * presenting the same key with a different fingerprint is rejected instead
   * of returning the stored outcome for the wrong purchase.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same purchase replays the stored outcome instead
   * of buying again. Omit to mint one: the attempt is still crash-safe
   * within the attempt, but a client retry mints a new key and is treated as
   * a new attempt (still guarded by the atomic float claim).
   */
  idempotencyKey?: string;
}

/** Buyer debit failed: balance raced below the cost. */
export const BOND_BUY_FUNDS = "BOND_BUY_FUNDS";
/** Holder reservation failed: the float raced below the units. */
export const BOND_BUY_RESERVE = "BOND_BUY_RESERVE";
/** Pool credit failed: the pool row vanished mid-flight (shell ensured). */
export const BOND_BUY_POOL = "BOND_BUY_POOL";
/** Spread routing failed: a central-bank write disappeared mid-flight. */
export const BOND_BUY_SPREAD = "BOND_BUY_SPREAD";

function mapBuyError(stepName: string, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical surface: a lost funds race was the 400
  // insufficient-funds refusal, a lost float race the 409 float refusal with
  // the refreshed float. Anything after money moved compensates the prefix
  // instead of stranding a half-landed purchase.
  if (stepName === "buyer-debit") return new Error(`${BOND_BUY_FUNDS}:${outcome}`);
  if (stepName === "holder-reserve") return new Error(`${BOND_BUY_RESERVE}:${outcome}`);
  if (stepName === "pool-credit") return new Error(`${BOND_BUY_POOL}:${outcome}`);
  return new Error(`${BOND_BUY_SPREAD}:${outcome}`);
}

function holderTarget(kind: BondBuyerKind, buyerId: ObjectId): BondHolderTarget {
  if (kind === "character") return { field: "characterId", id: buyerId };
  if (kind === "imperial") return { field: "imperialCharacterId", id: buyerId };
  if (kind === "corporation") return { field: "corporationId", id: buyerId };
  return { field: "nppId", id: buyerId };
}

/**
 * Buy bond units from the public float so the result is exactly-once on every
 * topology (issue #1672). Step order mirrors the historical write order: the
 * guarded buyer debit lands first, the keyed holder reservation second, the
 * pool credit third, the FX spread routing last, and a later failure
 * compensates its own prefix (pool un-credit, unit release, buyer refund)
 * instead of leaving a strand where the buyer paid but holds nothing.
 *
 * The financial-tx audit row stays OUTSIDE the keyed flow as a post-commit
 * best effort in the caller (`emitTx` never throws): it records no balance,
 * so skipping it on failure is harmless, while making it a terminal step
 * would settle `UNCOMPENSATED` on money that already moved. Same pattern as
 * the bond sell route.
 *
 * Under real transactions the debit, the reservation, the pool credit, the
 * spread slices, and the idempotency receipt join the transaction and commit
 * atomically, preserving the old behavior. On a standalone deployment the
 * fallback runs the same writes as keyed idempotent steps: a crash between
 * any two writes leaves an `in_progress` receipt, and retrying with the same
 * key reconciles to exactly one purchase. A retry after a terminal failure
 * throws `MoneyFlowTerminalError` (fail closed); a new attempt needs a new
 * key.
 */
export async function applyBondBuySpend(
  db: Db,
  input: BondBuySpendInput
): Promise<{ duplicate: boolean }> {
  if (!input.bondId || !input.buyerId) {
    throw new TypeError("Bond buy spend needs bondId and buyerId");
  }
  if (!Number.isInteger(input.units) || input.units <= 0) {
    throw new RangeError("Bond buy units must be a positive integer");
  }
  if (!Number.isFinite(input.debitAmount) || !Number.isFinite(input.costLocal)) {
    throw new RangeError("Bond buy costs must be finite");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Bond buy idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const now = input.now;

  // The cross-currency spread routing as a keyed spec. Same mapping as the
  // legacy `distributeConversionSpread` (currency home countries, fee in the
  // corp's currency): same split, same banks, same no-ops when the fee is
  // zero, same currency, or unmapped.
  const spreadSpecs: SpreadDistributionSpec[] = [];
  if (
    input.buyerKind === "corporation" &&
    Number.isFinite(input.spreadFee) &&
    (input.spreadFee ?? 0) > 0 &&
    input.corpCurrency &&
    input.corpCurrency !== input.bondCurrency
  ) {
    const fromCountry = getCountryForCurrency(input.corpCurrency);
    if (fromCountry) {
      spreadSpecs.push({
        totalFee: input.spreadFee!,
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
    if (fresh && !(input.debitAmount > 0 && input.costLocal > 0)) {
      await failMoneyFlowReceipt(receipts, key, `${BOND_BUY_FUNDS}:zero-cost`, opts);
      throw new Error(`${BOND_BUY_FUNDS}:zero-cost`);
    }

    // Built here (not outside `runSpend`) so the zero-cost validation above
    // settles the receipt before leg construction validates the deltas.
    const buyerDebitStep =
      input.buyerKind === "corporation"
        ? makeLegStep(key, {
            name: "buyer-debit",
            collection: db.collection<Corporation>("corporations"),
            docId: input.buyerId,
            field: "liquidCapital",
            delta: -input.debitAmount,
            minBalance: input.debitAmount,
            set: { updatedAt: now },
          })
        : input.buyerKind === "npp"
          ? makeLegStep(key, {
              name: "buyer-debit",
              collection: db.collection<NPP>("npps"),
              docId: input.buyerId,
              field: "nppInvestmentCashAnchor",
              delta: -input.debitAmount,
              minBalance: input.debitAmount,
              set: { updatedAt: now },
            })
          : makeLegStep(key, {
              name: "buyer-debit",
              collection:
                input.buyerKind === "character"
                  ? db.collection<Character>("characters")
                  : db.collection<ImperialCharacter>("imperialCharacters"),
              docId: input.buyerId,
              field: input.forexEnabled
                ? `currencyBalances.personal.${input.bondCurrency}`
                : "cashOnHand",
              delta: -input.debitAmount,
              minBalance: input.debitAmount,
              set: { updatedAt: now },
            });

    await runMoneyFlowSteps(
      receipts,
      key,
      [
        buyerDebitStep,
        makeReserveBondUnitsStep(
          key,
          db,
          input.bondId,
          holderTarget(input.buyerKind, input.buyerId),
          input.units,
          now,
          input.avgCostPerUnit !== undefined ? { avgCostPerUnit: input.avgCostPerUnit } : undefined
        ),
        makeBondPoolCreditStep(key, db, input.bondCurrency, input.costLocal, "purchasesIn", now),
        ...makeSpreadDistributionStepsForFees(db, key, spreadSpecs),
      ],
      (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) => mapBuyError(step.name, outcome),
      opts
    );
    return { duplicate: claim === "in-progress" };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}
