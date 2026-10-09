/**
 * Contest cash prize: the weekly round winner is paid contestPrizeAnchor ₳ as
 * personal cash in their home currency (payContestPrize), logged as an
 * attributed `contest_prize` mint and announced by notification.
 */
import type { Db } from "mongodb";
import type { Character, ExchangeRate } from "@/lib/db/types";
import type { ContestKind } from "@/lib/db/types/contestRound";
import { getCountryIdForCurrency, type CurrencyCode } from "@/lib/constants/currencies";
import { buildPersonalBalanceInc, getHomeCurrency } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { emitTx } from "@/lib/financialTxLog/emit";
import { onboardingRewardLocalAmount } from "@/lib/onboarding/rules";
import { createNotification } from "@/lib/notifications";
import { contestPrizeAnchor } from "./rules";

export const CONTEST_KIND_TITLES: Record<ContestKind, string> = {
  corp_growth_small: "Small Business Growth",
  corp_growth_large: "Big Business Growth",
  influence_gain: "National Influence",
  approval_gain: "Government Approval",
};

export interface ContestPrizeInput {
  character: Pick<Character, "_id" | "userId" | "name" | "countryId" | "sequentialId">;
  round: { _id: string; kind: ContestKind; roundNumber: number };
  subjectName: string;
  turn: number;
  preset: string | undefined;
  now: Date;
}

export interface ContestPrizeResult {
  credited: boolean;
  anchorAmount: number;
  localAmount: number;
  currencyCode: CurrencyCode;
}

export async function payContestPrize(
  db: Db,
  input: ContestPrizeInput
): Promise<ContestPrizeResult> {
  const { character, round, turn, preset, now } = input;
  const forexEnabled = await isForexEnabled();
  const anchorAmount = contestPrizeAnchor(preset);
  const currencyCode = getHomeCurrency(character, preset);
  const rateDoc = forexEnabled
    ? await db
        .collection<ExchangeRate>("exchangeRates")
        .findOne({ _id: getCountryIdForCurrency(currencyCode) })
    : null;
  const localAmount = onboardingRewardLocalAmount(
    anchorAmount,
    forexEnabled,
    currencyCode,
    rateDoc?.rate,
    preset
  );

  const credit = await db.collection<Character>("characters").updateOne(
    { _id: character._id },
    {
      $inc: buildPersonalBalanceInc(localAmount, currencyCode, forexEnabled),
      $set: { updatedAt: now },
    }
  );
  if (credit.matchedCount === 0) {
    return { credited: false, anchorAmount, localAmount, currencyCode };
  }

  await emitTx(db, {
    type: "contest_prize",
    turn,
    createdAt: now,
    subjectType: "character",
    subjectId: character._id,
    subjectName: character.name,
    subjectSequentialId: character.sequentialId,
    amount: localAmount,
    currencyCode,
    anchorAmount,
    meta: { roundId: round._id, kind: round.kind },
  });

  await createNotification({
    userId: character.userId,
    type: "system",
    title: "You won a weekly contest",
    message: `${input.subjectName} topped the ${CONTEST_KIND_TITLES[round.kind]} contest. Your prize has been added to your personal cash.`,
    metadata: { roundId: round._id, href: "/contests" },
  });

  return { credited: true, anchorAmount, localAmount, currencyCode };
}
