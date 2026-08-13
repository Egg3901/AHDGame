/**
 * Winding up a sponsored fund.
 *
 * A sponsor cannot simply close a fund holding other people's money. Wind-up is
 * a state, not an event:
 *
 *   active → winding_down → (holdings sold, holders paid) → delisted
 *
 * While `winding_down` the fund stops absorbing float, stops rebalancing and
 * stops charging its expense fee, and the cron sells its holdings back into the
 * public float each pass. Once the portfolio is cash, every unit holder is paid
 * out at the final NAV, and only THEN does the sponsor's seed capital come
 * back. Seed capital is the sponsor's skin in the game: it is the last money
 * out, so a fund that lost value costs the sponsor before it costs anyone else.
 *
 * `delisted` was a declared status with no behaviour anywhere in the codebase.
 * This gives it one.
 */

import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { IndexFund, IndexFundPosition, IndexFundTransaction } from "@/lib/db/types/indexFund";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  anchorToCorpLiquidCapital,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { creditCorpLiquidCapital } from "@/lib/financialTxLog/atomicCashGuard";
import { emitTx } from "@/lib/financialTxLog/emit";
import { sellFundHoldingsForRedemptionCash } from "@/lib/indexFunds/fundRedemptionLiquidity";
import { payFundHolderCash } from "./holderPayout";
import { recordAudit } from "@/lib/audit/recordAudit";

const FUND_TX = "indexFundTransactions";
const POSITIONS = "indexFundPositions";

export type WindUpResult =
  { ok: false; error: string; status: number } | { ok: true; status: IndexFund["status"] };

/**
 * Sponsor initiates wind-up. Idempotent: a fund already winding down or
 * delisted is left alone rather than restarted.
 */
export async function beginWindUp(
  db: Db,
  fund: IndexFund,
  currentTurn: number
): Promise<WindUpResult> {
  if (!fund.sponsorCorporationId)
    return { ok: false, error: "Only a sponsored fund can be wound up.", status: 400 };
  if (fund.status === "winding_down" || fund.status === "delisted")
    return { ok: true, status: fund.status };

  const claim = await db.collection<IndexFund>("indexFunds").updateOne(
    { _id: fund._id, status: { $in: ["active", "paused"] } },
    {
      $set: {
        status: "winding_down",
        windDownStartedAtTurn: currentTurn,
        updatedAt: new Date(),
      },
    }
  );
  if (claim.modifiedCount === 0)
    return { ok: false, error: "This fund is no longer open.", status: 409 };

  recordAudit({
    source: "api",
    action: "indexFund.windUp.begin",
    category: "money",
    turn: currentTurn,
    ts: new Date(),
    subject: { type: "corporation", id: fund.sponsorCorporationId, name: fund.sponsorName ?? "" },
    outcome: "ok",
    meta: { fundId: fund._id, tickerSymbol: fund.tickerSymbol, unitSupply: fund.unitSupply },
  });

  return { ok: true, status: "winding_down" };
}

export interface WindDownPassResult {
  fundsProcessed: number;
  fundsCompleted: number;
  holdersPaid: number;
  errors: string[];
}

/**
 * One cron pass over every winding-down fund: sell what is left, and finish any
 * fund whose portfolio has become cash.
 */
export async function advanceWindDowns(db: Db, currentTurn: number): Promise<WindDownPassResult> {
  const result: WindDownPassResult = {
    fundsProcessed: 0,
    fundsCompleted: 0,
    holdersPaid: 0,
    errors: [],
  };

  const funds = await db
    .collection<IndexFund>("indexFunds")
    .find({ status: "winding_down" })
    .toArray();

  for (const fund of funds) {
    result.fundsProcessed += 1;
    try {
      if (fund.holdings.length > 0) {
        // Sell everything we can this pass. An issuer that will not take its
        // shares back simply leaves the holding for the next pass; the fund
        // stays in wind-down until the portfolio clears rather than stranding
        // holders on a partial payout.
        const holdingsValueAnchor = fund.holdings.reduce(
          (sum, h) => sum + (h.lastValueAnchor ?? 0),
          0
        );
        if (holdingsValueAnchor > 0) {
          await sellFundHoldingsForRedemptionCash(db, fund, holdingsValueAnchor, {
            note: "Wind-up liquidation",
          });
        }
        continue;
      }

      const paid = await completeWindUp(db, fund, currentTurn);
      result.holdersPaid += paid;
      result.fundsCompleted += 1;
    } catch (err) {
      result.errors.push(`${fund.tickerSymbol}: ${(err as Error).message}`);
    }
  }

  return result;
}

/**
 * Pay every holder out at the final NAV, return what is left of the seed
 * capital to the sponsor, and delist.
 *
 * The order is the whole point. Holders are paid from cash first; the sponsor
 * receives the REMAINDER, which may be less than the seed they put in and may
 * be nothing at all.
 */
export async function completeWindUp(
  db: Db,
  fund: IndexFund,
  currentTurn: number
): Promise<number> {
  const now = new Date();
  const positions = await db
    .collection<IndexFundPosition>(POSITIONS)
    .find({ fundId: fund._id, units: { $gt: 0 } })
    .toArray();

  const totalUnits = positions.reduce((sum, p) => sum + p.units, 0);
  // Final NAV is what the cash actually supports, not the last quote. If the
  // portfolio sold for less than it was marked at, holders take that loss here
  // rather than the sponsor covering an unfundable quote.
  const finalNav = totalUnits > 0 ? fund.cashAnchor / totalUnits : 0;

  let holdersPaid = 0;
  let distributedAnchor = 0;
  for (const position of positions) {
    const payoutAnchor = Math.floor(position.units * finalNav);
    if (payoutAnchor <= 0) continue;
    const paid = await payFundHolderCash(db, fund, position, payoutAnchor, currentTurn, now);
    if (!paid) continue;
    distributedAnchor += payoutAnchor;
    holdersPaid += 1;
  }

  await db
    .collection<IndexFundPosition>(POSITIONS)
    .updateMany({ fundId: fund._id }, { $set: { units: 0, updatedAt: now } });

  const remainingAnchor = Math.max(0, fund.cashAnchor - distributedAnchor);

  if (fund.sponsorCorporationId && remainingAnchor > 0) {
    const sponsor = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: fund.sponsorCorporationId });
    if (sponsor) {
      const fxRate = await getCorpFxRate(db, sponsor);
      const localAmount = Math.round(anchorToCorpLiquidCapital(remainingAnchor, sponsor, fxRate));
      if (localAmount > 0) {
        await creditCorpLiquidCapital(db, sponsor._id, localAmount);
        await emitTx(db, {
          type: "corp_capital_seed",
          turn: currentTurn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: sponsor._id,
          subjectName: sponsor.name,
          amount: localAmount,
          currencyCode: (resolveCorpLiquidCurrencyCode(sponsor) ?? "USD") as CurrencyCode,
          counterpartyType: "system",
          counterpartyName: fund.name,
          meta: {
            kind: "fund_seed_capital_return",
            fundId: fund._id.toString(),
            seedCapitalAnchor: fund.seedCapitalAnchor ?? 0,
            returnedAnchor: remainingAnchor,
          },
        });
      }
    }
  }

  await db.collection<IndexFundTransaction>(FUND_TX).insertOne({
    _id: new ObjectId(),
    fundId: fund._id,
    kind: "seed_capital_return",
    turn: currentTurn,
    ...(fund.sponsorCorporationId ? { corporationId: fund.sponsorCorporationId } : {}),
    amountAnchor: remainingAnchor,
    note: `Wind-up complete: ${holdersPaid} holder(s) paid, ₳${Math.round(remainingAnchor).toLocaleString()} returned to sponsor`,
    createdAt: now,
  } as IndexFundTransaction);

  await db.collection<IndexFund>("indexFunds").updateOne(
    { _id: fund._id },
    {
      $set: {
        status: "delisted",
        cashAnchor: 0,
        unitSupply: 0,
        reserveUnits: 0,
        quotedNav: finalNav,
        updatedAt: now,
      },
    }
  );

  recordAudit({
    source: "turn",
    action: "indexFund.windUp.complete",
    category: "money",
    turn: currentTurn,
    ts: now,
    subject: { type: "fund", id: fund._id, name: fund.name },
    outcome: "ok",
    meta: {
      tickerSymbol: fund.tickerSymbol,
      finalNav,
      holdersPaid,
      distributedAnchor,
      returnedToSponsorAnchor: remainingAnchor,
      seedCapitalAnchor: fund.seedCapitalAnchor ?? 0,
    },
  });

  return holdersPaid;
}
