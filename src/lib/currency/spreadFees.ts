// src/lib/currency/spreadFees.ts
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  SPREAD_FEE_FOREX_REVENUE_RATIO,
  SPREAD_FEE_RESERVE_RATIO,
} from "@/lib/constants/currencies";
import type { CentralBank } from "@/lib/db/types/centralBank";
import { getBankId } from "@/lib/centralBank/helpers";

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
 * - **forexRevenue** (40%, home-currency revenue) → the **source** country's CB
 *   (`sourceCountryId`), the home country of the collected currency.
 * - **reserve slice** (10%, denominated in the *collected* currency) → the
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
export async function distributeSpreadFee(
  db: Db,
  totalFee: number,
  sourceCountryId: CountryId,
  currencyCode: CurrencyCode,
  destinationCountryId?: CountryId
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
