// src/lib/currency/spreadFees.ts
import type { ClientSession, Collection, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  SPREAD_FEE_FOREX_REVENUE_RATIO,
  SPREAD_FEE_RESERVE_RATIO,
} from "@/lib/constants/currencies";
import type { CentralBank } from "@/lib/db/types/centralBank";
import { getBankId } from "@/lib/centralBank/helpers";

const SETTLED_KEYS_FIELD = "settledKeys";
const SETTLED_KEYS_CAP = 200;

export interface SpreadFeeStamps {
  revenue: string;
  reserve: string;
}

async function applyStampedIncrement(
  banks: Collection<CentralBank>,
  bankId: string,
  increment: Record<string, number>,
  stamp: string | undefined,
  session: ClientSession | undefined
): Promise<boolean> {
  const options = session ? { session } : undefined;
  if (!stamp) {
    await banks.updateOne({ _id: bankId }, { $inc: increment }, { upsert: true, ...options });
    return true;
  }
  const result = await banks.updateOne(
    { _id: bankId, [SETTLED_KEYS_FIELD]: { $ne: stamp } },
    {
      $inc: increment,
      $push: { [SETTLED_KEYS_FIELD]: { $each: [stamp], $slice: -SETTLED_KEYS_CAP } },
    },
    options
  );
  if (result.matchedCount === 1) return true;
  const landed = await banks.findOne(
    { _id: bankId, [SETTLED_KEYS_FIELD]: stamp },
    { projection: { _id: 1 } }
  );
  if (!landed) throw new Error(`Spread-fee distribution target ${bankId} is unavailable`);
  return false;
}

export function calculateSpreadFee(amount: number, spreadRate: number): number {
  return Math.round(amount * spreadRate);
}

export async function distributeSpreadFee(
  db: Db,
  totalFee: number,
  sourceCountryId: CountryId,
  currencyCode: CurrencyCode,
  destinationCountryId?: CountryId,
  options?: { session?: ClientSession; stamps?: SpreadFeeStamps }
): Promise<{ destroyed: number; toCentralBank: number; toReserveBalance: number }> {
  const toReserveBalance = Math.round(totalFee * SPREAD_FEE_RESERVE_RATIO);
  const toForexRevenue = Math.round(totalFee * SPREAD_FEE_FOREX_REVENUE_RATIO);
  const toCentralBank = toReserveBalance + toForexRevenue;
  const destroyed = totalFee - toCentralBank;

  if (toCentralBank > 0) {
    const banks = db.collection<CentralBank>("centralBanks");
    const sourceBankId = getBankId(sourceCountryId);
    const reserveCountryId = destinationCountryId ?? sourceCountryId;
    const reserveBankId = getBankId(reserveCountryId);
    if (reserveBankId === sourceBankId) {
      await applyStampedIncrement(
        banks,
        sourceBankId,
        {
          forexRevenue: toForexRevenue,
          [`spreadFeeReserveBalances.${currencyCode}`]: toReserveBalance,
        },
        options?.stamps?.revenue,
        options?.session
      );
    } else {
      let revenueApplied = false;
      try {
        if (toForexRevenue !== 0) {
          revenueApplied = await applyStampedIncrement(
            banks,
            sourceBankId,
            { forexRevenue: toForexRevenue },
            options?.stamps?.revenue,
            options?.session
          );
        }
        if (toReserveBalance > 0) {
          await applyStampedIncrement(
            banks,
            reserveBankId,
            { [`spreadFeeReserveBalances.${currencyCode}`]: toReserveBalance },
            options?.stamps?.reserve,
            options?.session
          );
        }
      } catch (error) {
        if (!options?.session && revenueApplied) {
          try {
            await banks.updateOne(
              { _id: sourceBankId },
              {
                $inc: { forexRevenue: -toForexRevenue },
                ...(options?.stamps
                  ? { $pull: { [SETTLED_KEYS_FIELD]: options.stamps.revenue } }
                  : {}),
              }
            );
          } catch (compensationError) {
            throw new AggregateError(
              [error, compensationError],
              "Spread-fee distribution failed and its completed leg could not be reversed"
            );
          }
        }
        throw error;
      }
    }
  }
  return { destroyed, toCentralBank, toReserveBalance };
}

export async function reverseSpreadFee(
  db: Db,
  totalFee: number,
  sourceCountryId: CountryId,
  currencyCode: CurrencyCode,
  destinationCountryId?: CountryId
): Promise<void> {
  const toReserveBalance = Math.round(totalFee * SPREAD_FEE_RESERVE_RATIO);
  const toForexRevenue = Math.round(totalFee * SPREAD_FEE_FOREX_REVENUE_RATIO);
  if (toReserveBalance === 0 && toForexRevenue === 0) return;
  const banks = db.collection<CentralBank>("centralBanks");
  const sourceBankId = getBankId(sourceCountryId);
  const reserveBankId = getBankId(destinationCountryId ?? sourceCountryId);
  const errors: unknown[] = [];
  const reverse = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      errors.push(error);
    }
  };
  if (sourceBankId === reserveBankId) {
    await reverse(() =>
      banks.updateOne(
        { _id: sourceBankId },
        {
          $inc: {
            forexRevenue: -toForexRevenue,
            [`spreadFeeReserveBalances.${currencyCode}`]: -toReserveBalance,
          },
        }
      )
    );
  } else {
    if (toReserveBalance > 0) {
      await reverse(() =>
        banks.updateOne(
          { _id: reserveBankId },
          { $inc: { [`spreadFeeReserveBalances.${currencyCode}`]: -toReserveBalance } }
        )
      );
    }
    if (toForexRevenue !== 0) {
      await reverse(() =>
        banks.updateOne({ _id: sourceBankId }, { $inc: { forexRevenue: -toForexRevenue } })
      );
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "One or more spread-fee legs could not be reversed");
  }
}
