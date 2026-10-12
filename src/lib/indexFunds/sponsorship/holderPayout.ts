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

import {
  anchorToCorpLiquidCapital,
  loadFxRatesRecord,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import type { Corporation } from "@/lib/db/types";
import { ObjectId, type Db } from "mongodb";
import type { IndexFund, IndexFundPosition, IndexFundTransaction } from "@/lib/db/types/indexFund";
import { buildPersonalBalanceInc, loadCharacterFxRate } from "@/lib/currency/characterFunds";
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
  let fundFxRate = await loadFundPayoutFxRate(db, fund.anchorCurrencyCode, forexEnabled);
  if (forexEnabled && fund.seedAccounting === "paid_units") {
    const quote = await loadCharacterFxRate(db, fund.anchorCurrencyCode);
    if (!quote.ok || !Number.isFinite(quote.rate) || quote.rate <= 0)
      throw new Error("Fund payout exchange rate unavailable");
    fundFxRate = quote.rate;
  }

  if (position.holderKind === "character" && position.characterId) {
    const credited = await db.collection("characters").updateOne(
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
    if (!credited.matchedCount) return false;
  } else if (position.holderKind === "imperial_character" && position.imperialCharacterId) {
    const credited = await db.collection("imperialCharacters").updateOne(
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
    if (!credited.matchedCount) return false;
  } else if (position.holderKind === "corporation" && position.corporationId) {
    const corp = await db
      .collection<Corporation>("corporations")
      .findOne(
        { _id: position.corporationId },
        { projection: { liquidCurrencyCode: 1, countryId: 1 } }
      );
    if (!corp) return false;
    const currency = resolveCorpLiquidCurrencyCode(corp);
    const rates = forexEnabled ? await loadFxRatesRecord(db) : {};
    const rate = forexEnabled && currency ? rates[currency] : 1;
    if (!rate || rate <= 0) throw new Error("Corporate payout exchange rate unavailable");
    const credited = await db.collection("corporations").updateOne(
      { _id: corp._id },
      {
        $inc: { liquidCapital: anchorToCorpLiquidCapital(payoutAnchor, corp, rate) },
        $set: { updatedAt: now },
      }
    );
    if (!credited.matchedCount) return false;
  } else if (position.holderKind === "npp" && position.nppId) {
    // NPP investment cash is denominated in ₳ already - no rate.
    const credited = await db
      .collection("npps")
      .updateOne(
        { _id: position.nppId },
        { $inc: { nppInvestmentCashAnchor: payoutAnchor }, $set: { updatedAt: now } }
      );
    if (!credited.matchedCount) return false;
  } else if (position.holderKind === "pension_scheme" && position.pensionSchemeId) {
    const credited = await db
      .collection("pensionSchemes")
      .updateOne(
        { _id: position.pensionSchemeId },
        { $inc: { assetsAnchor: payoutAnchor }, $set: { updatedAt: now } }
      );
    if (!credited.matchedCount) return false;
  } else {
    return false;
  }

  await db.collection<IndexFundTransaction>(FUND_TX).insertOne({
    _id: new ObjectId(),
    fundId: fund._id,
    kind: "wind_up_distribution",
    turn: currentTurn,
    holderKind: position.holderKind,
    ...(position.corporationId ? { corporationId: position.corporationId } : {}),
    ...(position.characterId ? { characterId: position.characterId } : {}),
    ...(position.imperialCharacterId ? { imperialCharacterId: position.imperialCharacterId } : {}),
    ...(position.nppId ? { nppId: position.nppId } : {}),
    ...(position.pensionSchemeId ? { pensionSchemeId: position.pensionSchemeId } : {}),
    units: position.units,
    amountAnchor: payoutAnchor,
    note: `Wind-up distribution from ${fund.name}`,
    createdAt: now,
  } as IndexFundTransaction);

  return true;
}
