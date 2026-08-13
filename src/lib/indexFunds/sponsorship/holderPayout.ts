/**
 * Pay one fund holder cash, whatever kind of holder they are.
 *
 * Mirrors the currency handling in `dividendPassThrough`: a character's wallet
 * is NATIVE, so the ₳ amount is multiplied by the fund's FX rate before it
 * lands, while an NPP's investment cash is already ₳ and takes the anchor
 * amount unconverted. Getting this backwards is precisely the A0 defect that
 * mispriced every non-USD fund, so the two paths are kept explicitly apart.
 *
 * `fund_reserve` positions are skipped: the reserve is the fund's own units,
 * and paying it would be the fund paying itself.
 */

import { ObjectId, type Db } from "mongodb";
import type { IndexFund, IndexFundPosition, IndexFundTransaction } from "@/lib/db/types/indexFund";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { loadFundPayoutFxRate } from "@/lib/indexFunds/dividendPassThrough";

const FUND_TX = "indexFundTransactions";

export async function payFundHolderCash(
  db: Db,
  fund: IndexFund,
  position: IndexFundPosition,
  payoutAnchor: number,
  currentTurn: number,
  now: Date
): Promise<boolean> {
  if (position.holderKind === "fund_reserve") return false;
  if (payoutAnchor <= 0) return false;

  const forexEnabled = await isForexEnabled();
  const fundFxRate = await loadFundPayoutFxRate(db, fund.anchorCurrencyCode, forexEnabled);

  if (position.holderKind === "character" && position.characterId) {
    await db.collection("characters").updateOne(
      { _id: position.characterId },
      {
        $inc: buildPersonalBalanceInc(
          payoutAnchor * fundFxRate,
          fund.anchorCurrencyCode,
          forexEnabled
        ),
        $set: { updatedAt: now },
      }
    );
  } else if (position.holderKind === "imperial_character" && position.imperialCharacterId) {
    await db.collection("imperialCharacters").updateOne(
      { _id: position.imperialCharacterId },
      {
        $inc: buildPersonalBalanceInc(
          payoutAnchor * fundFxRate,
          fund.anchorCurrencyCode,
          forexEnabled
        ),
        $set: { updatedAt: now },
      }
    );
  } else if (position.holderKind === "npp" && position.nppId) {
    // NPP investment cash is denominated in ₳ already — no rate.
    await db
      .collection("npps")
      .updateOne(
        { _id: position.nppId },
        { $inc: { nppInvestmentCashAnchor: payoutAnchor }, $set: { updatedAt: now } }
      );
  } else {
    return false;
  }

  await db.collection<IndexFundTransaction>(FUND_TX).insertOne({
    _id: new ObjectId(),
    fundId: fund._id,
    kind: "wind_up_distribution",
    turn: currentTurn,
    holderKind: position.holderKind,
    ...(position.characterId ? { characterId: position.characterId } : {}),
    ...(position.imperialCharacterId ? { imperialCharacterId: position.imperialCharacterId } : {}),
    ...(position.nppId ? { nppId: position.nppId } : {}),
    units: position.units,
    amountAnchor: payoutAnchor,
    note: `Wind-up distribution from ${fund.name}`,
    createdAt: now,
  } as IndexFundTransaction);

  return true;
}
