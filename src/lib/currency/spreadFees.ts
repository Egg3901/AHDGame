// src/lib/currency/spreadFees.ts
import type { Collection, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  SPREAD_FEE_FOREX_REVENUE_RATIO,
  SPREAD_FEE_RESERVE_RATIO,
} from "@/lib/constants/currencies";
import type { CentralBank } from "@/lib/db/types/centralBank";
import { getBankId } from "@/lib/centralBank/helpers";
import {
  applyKeyedUpdate,
  deriveMoneyFlowKey,
  insertKeyedDoc,
  type MoneyFlowAccount,
  type MoneyFlowLegOutcome,
  type MoneyFlowOptions,
  type MoneyFlowStep,
} from "@/lib/db/nonAtomicMoneyFlow";

/**
 * Calculate the spread fee amount for a trade.
 * @param amount - Trade amount in the source currency
 * @param spreadRate - Spread rate as a decimal (e.g., 0.00275 for 0.275%)
 * @returns The spread fee amount
 */
export function calculateSpreadFee(amount: number, spreadRate: number): number {
  return Math.round(amount * spreadRate);
}

/**
 * Distribute a spread fee three ways per the SPREAD_FEE_*_RATIO constants:
 * a deflationary destroy sink, home-currency forexRevenue, and the foreign
 * reserve slice. Default split is 25% destroyed / 25% forexRevenue / 50% reserve.
 * Reserve + revenue are rounded; the destroyed share absorbs the remainder so the
 * three slices always sum back to `totalFee`.
 *
 * Routing (the two CB slices can land at different banks):
 * - **forexRevenue** (25%, home-currency revenue) → the **source** country's CB
 *   (`sourceCountryId`), the home country of the collected currency.
 * - **reserve slice** (50%, denominated in the *collected* currency) → the
 *   **destination** country's CB (`destinationCountryId`). On a cross-currency
 *   conversion the collected currency is foreign to the destination CB, so this
 *   is how a central bank accumulates *foreign-currency* reserves — e.g. a JP
 *   holder converting a USD coupon to JPY builds USD reserves at the JP CB.
 *   When `destinationCountryId` is omitted it falls back to `sourceCountryId`
 *   (legacy home-currency behaviour).
 *
 * @param db - Database instance
 * @param totalFee - Total spread fee amount in the collected currency
 * @param sourceCountryId - Home country of the collected currency (receives forexRevenue)
 * @param currencyCode - Currency denomination collected for the fee
 * @param destinationCountryId - Counterparty country whose CB accrues the foreign reserve slice
 * @returns Breakdown of destroyed vs deposited amounts
 */
/**
 * Pure split of a spread fee into its three slices. Shared by
 * {@link distributeSpreadFee} and {@link makeSpreadDistributionSteps} so the
 * keyed money-flow path routes exactly the same amounts as the legacy
 * post-commit path: reserve + revenue rounded, the destroyed sink absorbing
 * the remainder so the slices always sum back to `totalFee`.
 */
export function splitSpreadFee(totalFee: number): {
  toReserveBalance: number;
  toForexRevenue: number;
  destroyed: number;
} {
  const toReserveBalance = Math.round(totalFee * SPREAD_FEE_RESERVE_RATIO);
  const toForexRevenue = Math.round(totalFee * SPREAD_FEE_FOREX_REVENUE_RATIO);
  const destroyed = totalFee - (toReserveBalance + toForexRevenue);
  return { toReserveBalance, toForexRevenue, destroyed };
}

export async function distributeSpreadFee(
  db: Db,
  totalFee: number,
  sourceCountryId: CountryId,
  currencyCode: CurrencyCode,
  destinationCountryId?: CountryId
): Promise<{ destroyed: number; toCentralBank: number; toReserveBalance: number }> {
  const { toReserveBalance, toForexRevenue, destroyed } = splitSpreadFee(totalFee);
  const toCentralBank = toReserveBalance + toForexRevenue;

  if (toCentralBank > 0) {
    const banks = db.collection<CentralBank>("centralBanks");
    const sourceBankId = getBankId(sourceCountryId);
    const reserveCountryId = destinationCountryId ?? sourceCountryId;
    const reserveBankId = getBankId(reserveCountryId);

    if (reserveBankId === sourceBankId) {
      // Same bank (home-currency case, or source === destination): one write.
      await banks.updateOne(
        { _id: sourceBankId },
        {
          $inc: {
            forexRevenue: toForexRevenue,
            [`spreadFeeReserveBalances.${currencyCode}`]: toReserveBalance,
          },
        },
        { upsert: true }
      );
    } else {
      // Cross-currency: forexRevenue stays with the source CB, while the reserve
      // slice (in the collected/outflow currency) accrues to the destination CB
      // as a foreign reserve.
      await Promise.all([
        toForexRevenue !== 0
          ? banks.updateOne(
              { _id: sourceBankId },
              { $inc: { forexRevenue: toForexRevenue } },
              { upsert: true }
            )
          : Promise.resolve(),
        toReserveBalance > 0
          ? banks.updateOne(
              { _id: reserveBankId },
              { $inc: { [`spreadFeeReserveBalances.${currencyCode}`]: toReserveBalance } },
              { upsert: true }
            )
          : Promise.resolve(),
      ]);
    }
  }

  return { destroyed, toCentralBank, toReserveBalance };
}

export interface SpreadDistributionSpec {
  /** Total spread fee in the collected currency (already rounded by the caller). */
  totalFee: number;
  /** Home country of the collected currency (receives forexRevenue). */
  sourceCountryId: CountryId;
  /** Currency denomination collected for the fee. */
  currencyCode: CurrencyCode;
  /** Counterparty country whose CB accrues the foreign reserve slice. */
  destinationCountryId?: CountryId;
}

function negateInc(inc: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(inc).map(([field, delta]) => [field, -delta]));
}

/**
 * One central-bank spread slice as a revertible money-flow step: an
 * existence-ensuring insert (a no-op when the bank row was seeded, matching
 * the legacy upsert path) followed by a keyed `$inc`. The revert negates the
 * exact credited slice with a compensation key, so a crashed-and-retried or
 * concurrently-raced same-key flow routes each slice exactly once instead of
 * double-crediting the bank (money the skim only collected once).
 */
function makeBankSpreadStep<TDoc extends MoneyFlowAccount>(
  key: string,
  collection: Collection<TDoc>,
  name: string,
  docId: TDoc["_id"],
  inc: Record<string, number>
): MoneyFlowStep {
  const revertInc = negateInc(inc);
  return {
    name,
    apply: async (options?: MoneyFlowOptions): Promise<MoneyFlowLegOutcome> => {
      const opts = options ?? {};
      // Existence only: a seeded bank reports already-applied via the `_id`
      // collision and the keyed update below does the real guarded work.
      await insertKeyedDoc(collection, { _id: docId } as TDoc, opts);
      return applyKeyedUpdate(
        key,
        { collection, filter: { _id: docId }, update: { $inc: inc } },
        opts
      );
    },
    revert: (options?: MoneyFlowOptions): Promise<MoneyFlowLegOutcome> =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(key, "compensate", name),
        { collection, filter: { _id: docId }, update: { $inc: revertInc } },
        options ?? {}
      ),
  };
}

/**
 * The {@link distributeSpreadFee} routing as crash-safe idempotent money-flow
 * steps for a SINGLE fee (issue #1672 market-maker execution). Same split
 * (via {@link splitSpreadFee}), same banks, same zero-slice skips as the
 * legacy path (`$inc` by zero is a no-op, so dropping zero slices changes no
 * balance); the destroyed sink needs no write.
 *
 * A non-positive or non-finite fee yields no steps, mirroring the legacy
 * no-op. Steps carry no balance guards (credits only) and their inverses
 * negate the exact slices, so compensation removes exactly what applied.
 *
 * Single-fee only: a flow routing TWO fees (a peer fill's maker + taker
 * half-spreads) must use {@link makeSpreadDistributionStepsForFees}. Two
 * same-bank steps under one key collide — the first step's key record trips
 * the second step's `$ne: key` guard, and the disambiguation reads it as
 * already-applied, so the second slice is silently SKIPPED (and its inverse
 * would then negate a slice that never applied). Merging per bank keeps the
 * module's one-key-per-document invariant.
 */
export function makeSpreadDistributionSteps(
  db: Db,
  key: string,
  spec: SpreadDistributionSpec
): MoneyFlowStep[] {
  if (!Number.isFinite(spec.totalFee) || spec.totalFee <= 0) return [];
  const { toReserveBalance, toForexRevenue } = splitSpreadFee(spec.totalFee);
  const banks = db.collection<CentralBank>("centralBanks");
  const sourceBankId = getBankId(spec.sourceCountryId);
  const reserveBankId = getBankId(spec.destinationCountryId ?? spec.sourceCountryId);
  if (reserveBankId === sourceBankId) {
    const inc: Record<string, number> = {};
    if (toForexRevenue !== 0) inc.forexRevenue = toForexRevenue;
    if (toReserveBalance !== 0) {
      inc[`spreadFeeReserveBalances.${spec.currencyCode}`] = toReserveBalance;
    }
    if (Object.keys(inc).length === 0) return [];
    return [makeBankSpreadStep(key, banks, "spread-home", sourceBankId, inc)];
  }
  const steps: MoneyFlowStep[] = [];
  if (toForexRevenue !== 0) {
    steps.push(
      makeBankSpreadStep(key, banks, "spread-revenue", sourceBankId, {
        forexRevenue: toForexRevenue,
      })
    );
  }
  if (toReserveBalance > 0) {
    steps.push(
      makeBankSpreadStep(key, banks, "spread-reserve", reserveBankId, {
        [`spreadFeeReserveBalances.${spec.currencyCode}`]: toReserveBalance,
      })
    );
  }
  return steps;
}

/**
 * The {@link distributeSpreadFee} routing as crash-safe idempotent money-flow
 * steps for flows routing SEVERAL fees under one key (issue #1672 peer fills
 * and direct accepts route the maker and taker half-spreads together). Same
 * split, same banks, same zero-slice skips as the legacy path — but all
 * slices landing on one bank merge into a single keyed write, so same-bank
 * steps can never collide on the `$ne: key` guard (see
 * {@link makeSpreadDistributionSteps}).
 *
 * Non-positive or non-finite fees contribute no slices, mirroring the legacy
 * no-op. The merged inverses negate the exact per-bank totals, so
 * compensation removes exactly what applied.
 */
export function makeSpreadDistributionStepsForFees(
  db: Db,
  key: string,
  specs: SpreadDistributionSpec[]
): MoneyFlowStep[] {
  const banks = db.collection<CentralBank>("centralBanks");
  const incByBank = new Map<string, Record<string, number>>();
  const add = (bankId: string, field: string, delta: number): void => {
    if (delta === 0) return;
    let inc = incByBank.get(bankId);
    if (!inc) {
      inc = {};
      incByBank.set(bankId, inc);
    }
    inc[field] = (inc[field] ?? 0) + delta;
  };
  for (const spec of specs) {
    if (!Number.isFinite(spec.totalFee) || spec.totalFee <= 0) continue;
    const { toReserveBalance, toForexRevenue } = splitSpreadFee(spec.totalFee);
    const sourceBankId = getBankId(spec.sourceCountryId);
    const reserveBankId = getBankId(spec.destinationCountryId ?? spec.sourceCountryId);
    add(sourceBankId, "forexRevenue", toForexRevenue);
    add(reserveBankId, `spreadFeeReserveBalances.${spec.currencyCode}`, toReserveBalance);
  }
  const steps: MoneyFlowStep[] = [];
  for (const [bankId, inc] of incByBank) {
    if (Object.keys(inc).length === 0) continue;
    steps.push(makeBankSpreadStep(key, banks, `spread-bank-${bankId}`, bankId, inc));
  }
  return steps;
}
