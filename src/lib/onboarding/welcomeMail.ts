import { regionNoun } from "@/lib/onboarding/checklist";
import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";

/** Sender name shown on the welcome mail (system mail, no fromCharacterId). */
export const WELCOME_MAIL_SENDER = "Game Guide";

export const WELCOME_MAIL_SUBJECT = "Your first moves";

interface WelcomeMailParams {
  countryId: string;
  /** Campaign funds the character actually started with (₳ anchor mirror). */
  startingFunds: number;
  /** Actions the character actually started with (referral bonus included). */
  startingActions: number;
  /** Checklist completion reward (₳ anchor). */
  rewardAmount: number;
  /** World's actual turn cadence (gameConfig.turnLengthMinutes). */
  turnLengthMinutes: number;
  /**
   * Actual home currency credited (preset-aware, e.g. EUR for a 2027-default
   * euro member). Omit to keep the legacy ₳ anchor labels byte-identical.
   */
  currencyCode?: CurrencyCode;
  /** Local-credited campaign starting balance (home currency), shown when `currencyCode` is set. */
  localStartingFunds?: number;
  /** Local-credited checklist reward (home currency), shown when `currencyCode` is set. */
  localRewardAmount?: number;
}

/** "every hour" / "every 30 minutes" / "every 2 hours", from the real config. */
function turnCadence(turnLengthMinutes: number): string {
  if (turnLengthMinutes === 60) return "every hour";
  if (turnLengthMinutes % 60 === 0) return `every ${turnLengthMinutes / 60} hours`;
  return `every ${turnLengthMinutes} minutes`;
}

/**
 * One-time welcome mail sent at character creation (gated on
 * onboardingChecklistEnabled). Numbers come from the character's actual
 * starting kit so referral bonuses and config changes never make it lie.
 *
 * Deliberately does not enumerate the checklist steps. The player picks what
 * they want to be shown in the welcome flow after creation, so this mail is
 * sent before anyone knows which steps their checklist will carry (see
 * tutorialPlan.ts).
 */
export function buildWelcomeMailBody(params: WelcomeMailParams): string {
  const {
    countryId,
    startingFunds,
    startingActions,
    rewardAmount,
    turnLengthMinutes,
    currencyCode,
    localStartingFunds,
    localRewardAmount,
  } = params;
  const region = regionNoun(countryId);
  // With a home currency the mail names the local credited balances the
  // wallet actually shows; otherwise the legacy ₳ anchor labels apply.
  const symbol = currencyCode ? (CURRENCY_SYMBOLS[currencyCode] ?? currencyCode) : "₳";
  const funds = `${symbol}${(currencyCode && localStartingFunds !== undefined ? localStartingFunds : startingFunds).toLocaleString()}`;
  const reward = `${symbol}${(currencyCode && localRewardAmount !== undefined ? localRewardAmount : rewardAmount).toLocaleString()}`;

  return (
    `You have a character, a home ${region}, ${funds} in campaign funds, and ${startingActions} bonus actions. That is more than most politicians start with.\n\n` +
    `The fastest way to learn is to be shown. The tutorial asks what you want to do, whether that is investing, running a company, running a union, running for office, or running the country, then walks you through it on the real pages. Your checklist on the profile page tracks the same steps and pays out ${reward} when you finish them.\n\n` +
    `Turns run ${turnCadence(turnLengthMinutes)}. Anything you queue now resolves on the next turn. If you get stuck, open the tutorial page or the Getting Started guide in the wiki.`
  );
}
