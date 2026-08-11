import type { Db } from "mongodb";
import type { Character, ExchangeRate, GameConfig } from "@/lib/db/types";
import {
  COUNTRY_CURRENCY_MAP,
  INITIAL_RATES,
  getCountryIdForCurrency,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { emitTx } from "@/lib/financialTxLog/emit";

/**
 * One-time payout for completing all seven onboarding checklist steps,
 * expressed as a fraction of the flat starting campaign funds
 * (gameConfig.startingFunds, ₳250,000 by default → ₳50,000 reward).
 */
export const ONBOARDING_REWARD_FRACTION = 0.2;

/** Fallback when gameConfig is missing (matches seeds/reference/gameConfig.ts). */
const DEFAULT_STARTING_FUNDS = 250_000;

/** Anchor-denominated (₳) reward for the current world's starting funds. */
export function onboardingRewardAmount(startingFunds: number | undefined): number {
  return Math.round((startingFunds ?? DEFAULT_STARTING_FUNDS) * ONBOARDING_REWARD_FRACTION);
}

export interface OnboardingRewardResult {
  /** False when the reward was already granted (never pays twice). */
  granted: boolean;
  /** Anchor-denominated (₳) amount paid (or that would have been paid). */
  amount: number;
}

/**
 * Grant the checklist completion reward as campaign funds.
 *
 * Idempotency is atomic: the balance credit and the `onboarding.rewardGrantedAt`
 * stamp happen in one updateOne whose filter requires the stamp to be absent,
 * so two concurrent claims can never both pay.
 *
 * Mirrors the admin resources-grant semantics for campaign funds: `funds`
 * carries the anchor (₳) mirror; when forex is on the canonical
 * `currencyBalances.campaign` is credited in home currency at the live rate.
 * The payout is logged to financialTxLog as `onboarding_reward` (an attributed
 * system mint in the shadow ledger).
 *
 * The caller is responsible for verifying the checklist is complete first.
 */
export async function grantOnboardingReward(
  db: Db,
  character: Pick<Character, "_id" | "name" | "countryId" | "sequentialId">,
  turn: number
): Promise<OnboardingRewardResult> {
  const [gameConfig, forexEnabled] = await Promise.all([
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { startingFunds: 1 } }),
    isForexEnabled(),
  ]);
  const amount = onboardingRewardAmount(gameConfig?.startingFunds);

  const homeCurrency = (COUNTRY_CURRENCY_MAP[character.countryId as CountryId] ??
    "USD") as CurrencyCode;
  // Resolve the live rate via the currency's anchor country so shared
  // currencies (EUR: DE + IE) convert identically (see grantCashBuilder.ts).
  const anchorCountry = getCountryIdForCurrency(homeCurrency);
  const rateDoc = forexEnabled
    ? await db.collection<ExchangeRate>("exchangeRates").findOne({ _id: anchorCountry })
    : null;
  // A zero/negative stored rate would credit ₳0 usable currency while the
  // funds mirror and anchorAmount still say full value; treat it like an
  // absent rate instead.
  const storedRate = rateDoc?.rate;
  const homeRate = forexEnabled
    ? storedRate !== undefined && storedRate > 0
      ? storedRate
      : (INITIAL_RATES[anchorCountry as CountryId] ?? 1)
    : 1;
  const localAmount = Math.round(amount * homeRate);

  const inc: Record<string, number> = { funds: amount };
  if (forexEnabled) {
    inc["currencyBalances.campaign"] = localAmount;
  }

  const now = new Date();
  const result = await db.collection<Character>("characters").updateOne(
    { _id: character._id, "onboarding.rewardGrantedAt": { $exists: false } },
    {
      $inc: inc,
      $set: {
        "onboarding.rewardGrantedAt": now,
        "onboarding.rewardAmount": amount,
        updatedAt: now,
      },
    }
  );

  if (result.matchedCount === 0) {
    return { granted: false, amount };
  }

  await emitTx(db, {
    type: "onboarding_reward",
    turn,
    createdAt: now,
    subjectType: "character",
    subjectId: character._id,
    subjectName: character.name,
    subjectSequentialId: character.sequentialId,
    amount: localAmount,
    currencyCode: homeCurrency,
    anchorAmount: amount,
    meta: { source: "onboarding_checklist" },
  });

  return { granted: true, amount };
}
