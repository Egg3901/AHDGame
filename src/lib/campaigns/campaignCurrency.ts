import type { Db } from "mongodb";
import type { ExchangeRate } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * Campaign currency shell loads a world's fixed base rates once for the caller.
 * Political income and costs share this snapshot; live forex remains reserved
 * for market transactions. Missing legacy rate rows retain the historical fallback.
 */
export { campaignAnchorToLocal, campaignLocalRate, getCampaignCurrency } from "./rules/currency";
import { getCampaignCurrency, type CampaignCurrencyRates } from "./rules/currency";
export type { CampaignCurrencyRates } from "./rules/currency";

export async function loadCampaignCurrencyRates(db: Db): Promise<CampaignCurrencyRates> {
  const rows = await db
    .collection<ExchangeRate>("exchangeRates")
    .find({}, { projection: { currencyCode: 1, baseRate: 1 } })
    .toArray();
  const rates: CampaignCurrencyRates = {};
  for (const row of rows) {
    if (typeof row.baseRate === "number" && Number.isFinite(row.baseRate) && row.baseRate > 0)
      rates[row.currencyCode] = row.baseRate;
  }
  return rates;
}

/** Convert an anchor amount to local currency, rounded to a whole unit. */
export function anchorToLocal(anchor: number, rate: number): number {
  return Math.round(anchor * rate);
}

/**
 * Resolve a campaign country's local currency + FX rate. Falls back to rate 1.0
 * (anchor == local) when forex is disabled or no rate doc exists, so callers
 * never divide by an undefined rate.
 */
export async function loadCampaignFxRate(
  db: Db,
  countryId: string
): Promise<{ rate: number; currencyCode: CurrencyCode }> {
  const currencyCode = getCampaignCurrency(countryId);
  const rateDoc = await db
    .collection<ExchangeRate>("exchangeRates")
    .findOne({ currencyCode }, { projection: { rate: 1 } });
  if (!rateDoc || !Number.isFinite(rateDoc.rate) || rateDoc.rate <= 0) {
    return { rate: 1.0, currencyCode };
  }
  return { rate: rateDoc.rate, currencyCode };
}
