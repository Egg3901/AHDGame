/**
 * What a play costs the actor who is paying for it, in the units their balance
 * is actually stored in.
 *
 * The two tiers are denominated differently and mixing them silently
 * mis-charges by the FX rate — see `fundsUnit` on `SettlementPlayDef`.
 */
import type { Db } from "mongodb";
import type { Character } from "@/lib/db/types";
import type { SettlementPlayDef } from "@/lib/constants/settlementCrisis";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import { localCampaignBalance } from "@/lib/currency/campaignBalance";

/** The character field that holds the local-currency truth for campaign money. */
export type CampaignFundsField = "funds" | "currencyBalances.campaign";

export interface ResolvedFunds {
  /** Cost in the same units as the balance it will be charged against. */
  local: number;
  field: CampaignFundsField;
}

/**
 * A seat play's cost is already the seat country's own currency — the authored
 * figures are literal. No conversion, and deliberately not a db call.
 */
export function seatFundsLocal(play: SettlementPlayDef): number {
  return play.fundsCost;
}

/**
 * A personal play's cost is ANCHOR and has to be converted before it can be
 * compared with, or subtracted from, a local balance.
 *
 * Returns the field name as well as the amount because the two move together:
 * post-forex the truth lives in `currencyBalances.campaign`, pre-forex in
 * `funds`, and charging the converted amount against the wrong field is the
 * classic way to be wrong by exactly the exchange rate.
 */
export async function resolvePersonalFunds(
  db: Db,
  character: Character,
  play: SettlementPlayDef
): Promise<ResolvedFunds & { balanceLocal: number }> {
  const forexEnabled = await isForexEnabled();
  const field: CampaignFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";
  const balanceLocal = localCampaignBalance(character, forexEnabled);

  if (!forexEnabled) {
    return { local: play.fundsCost, field, balanceLocal };
  }
  // Skip the rate lookup entirely for a free play — most personal plays are.
  if (play.fundsCost === 0) {
    return { local: 0, field, balanceLocal };
  }
  // `ok: false` means no usable exchangeRate row for this currency, and the
  // helper falls back to 1.0 — charging the anchor figure as though it were
  // local. That UNDER-charges a weak-currency character (5,000 RUB instead of
  // ~20,000) and over-charges a strong-currency one.
  //
  // Accepted rather than refused, deliberately: every other money path in the
  // app takes the same fallback, and diverging here would block a player over
  // what is really a seeding gap in `exchangeRates`. The exposure is one
  // personal play's funds cost, which is small by construction. If settlement
  // ever carries a large personal cost, revisit this and fail closed.
  const { rate } = await loadCharacterFxRate(db, getHomeCurrency(character));
  return { local: Math.round(play.fundsCost * rate), field, balanceLocal };
}
