/**
 * A8 phase 2, part B: schemes invest.
 *
 * Cash sitting in a pension scheme is a savings account. A pension fund is an
 * institutional investor, and the whole 1.1 fund arc exists to give one somewhere
 * to put its money.
 *
 * ## Through the existing path, not a parallel one
 *
 * A scheme subscribes with the same primitives a player does: `creditFundPosition`
 * for the position, an `$inc` on the fund's `unitSupply` and `cashAnchor`, and an
 * `indexFundTransactions` row. It is a new HOLDER KIND, not a new fund mechanic.
 * Whole units only, priced at the fund's quoted NAV, so the fund's backing ratio
 * is unaffected by the subscription: it receives exactly the ₳ the units are
 * worth.
 *
 * ## Fail closed
 *
 * If index funds are off, this pass returns having done nothing and schemes hold
 * cash. Every other part of A8 keeps working: contributions arrive, liabilities
 * accrue, benefits are paid, funding ratios read off cash alone. Investment is an
 * option a scheme has, never a dependency it carries.
 *
 * ## The buffer
 *
 * See `pensionInvestableCashAnchor`. Fund units are not a payment instrument for
 * a scheme (there is no scheme redemption path), so anything invested is
 * unavailable to pensioners. The buffer is what stops the scheme manufacturing
 * its own benefit cut.
 */

import type { Db } from "mongodb";
import type { IndexFund, IndexFundTransaction } from "@/lib/db/types/indexFund";
import type { PensionScheme } from "@/lib/db/types/pensionScheme";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { emitTx } from "@/lib/financialTxLog/emit";
import { isIndexFundsEnabled } from "@/lib/indexFunds/featureFlag";
import { creditFundPosition, insertFundTransaction } from "@/lib/indexFunds/fundQueries";
import { pensionInvestableCashAnchor } from "./rules";
import { PENSION_SCHEMES, INDEX_FUNDS } from "./schemeAssets";

export interface PensionInvestingResult {
  schemesInvesting: number;
  investedAnchor: number;
  errors: string[];
}

/**
 * Choose where a scheme invests.
 *
 * A scheme is a conservative, mandate-bound institution, not a stock picker:
 * the country-scoped broad index for its own country, falling back to the
 * global broad index when its country has none. Sector funds are deliberately
 * not eligible. Concentrating a country's pensions in the sector its members
 * work in is exactly the failure mode occupational schemes are regulated
 * against, and the game does not need a scheme whose assets collapse in the
 * same turn its employer does.
 */
export function chooseSchemeFund(funds: IndexFund[], countryId: string): IndexFund | null {
  const eligible = funds.filter((f) => f.status === "active" && f.kind === "broad");
  const home = eligible.find((f) => f.scope === "country" && f.countryId === countryId);
  if (home) return home;
  return eligible.find((f) => f.scope === "global") ?? null;
}

export async function runPensionSchemeInvestments(
  db: Db,
  currentTurn: number
): Promise<PensionInvestingResult> {
  const result: PensionInvestingResult = { schemesInvesting: 0, investedAnchor: 0, errors: [] };

  // Fail closed. Schemes simply hold cash and every other pension mechanic is
  // untouched.
  if (!(await isIndexFundsEnabled())) return result;

  const schemes = await db
    .collection<PensionScheme>(PENSION_SCHEMES)
    .find({ assetsAnchor: { $gt: 0 } })
    .toArray();
  if (schemes.length === 0) return result;

  const funds = await db
    .collection<IndexFund>(INDEX_FUNDS)
    .find({ status: "active", kind: "broad" })
    .toArray();
  if (funds.length === 0) return result;

  for (const scheme of schemes) {
    try {
      const investable = pensionInvestableCashAnchor({
        cashAnchor: scheme.assetsAnchor,
        benefitsInPaymentAnchor: scheme.benefitsInPaymentAnchor ?? 0,
      });
      if (investable <= 0) continue;

      const fund = chooseSchemeFund(funds, scheme.countryId);
      if (!fund) continue;
      // A fund quoting at or below zero cannot price units. Skipping is the
      // fail-closed reading; buying at a nonsense NAV would hand the scheme
      // units it did not pay for, which is a mint.
      if (!Number.isFinite(fund.quotedNav) || fund.quotedNav <= 0) continue;

      const units = Math.floor(investable / fund.quotedNav);
      if (units < 1) continue;
      // Cost is derived from WHOLE units at NAV, never from `investable`, so the
      // ₳ that leave the scheme and the ₳ that arrive at the fund are the same
      // number by construction.
      const costAnchor = units * fund.quotedNav;

      const now = new Date();
      // Guarded debit first. If the scheme's cash moved since the read (the
      // benefit pass runs earlier in the same turn), no units are issued.
      const debit = await db
        .collection<PensionScheme>(PENSION_SCHEMES)
        .updateOne(
          { _id: scheme._id, assetsAnchor: { $gte: costAnchor } },
          {
            $inc: { assetsAnchor: -costAnchor, totalInvestedAnchor: costAnchor },
            $set: { updatedAt: now },
          }
        );
      if (debit.matchedCount === 0) continue;

      await creditFundPosition(
        db,
        fund._id,
        "pension_scheme",
        { pensionSchemeId: scheme._id },
        units,
        fund.quotedNav
      );
      await db
        .collection<IndexFund>(INDEX_FUNDS)
        .updateOne(
          { _id: fund._id },
          { $inc: { unitSupply: units, cashAnchor: costAnchor }, $set: { updatedAt: now } }
        );
      await insertFundTransaction(db, {
        fundId: fund._id,
        kind: "subscription",
        turn: currentTurn,
        holderKind: "pension_scheme",
        pensionSchemeId: scheme._id,
        units,
        navAnchor: fund.quotedNav,
        amountAnchor: costAnchor,
        note: `${scheme.unionName} pension scheme`,
        createdAt: now,
      } as Omit<IndexFundTransaction, "_id">);

      await emitTx(db, {
        type: "index_fund_subscribe",
        turn: currentTurn,
        createdAt: now,
        subjectType: "pension_scheme",
        subjectId: scheme._id,
        subjectName: `${scheme.unionName} pension scheme`,
        amount: -costAnchor,
        anchorAmount: -costAnchor,
        currencyCode: (COUNTRY_CURRENCY_MAP[scheme.countryId] ?? "USD") as CurrencyCode,
        counterpartyType: "system",
        counterpartyName: fund.name,
        meta: {
          schemeId: scheme._id.toString(),
          fundId: fund._id.toString(),
          fundSlug: fund.slug,
          units,
          navAnchor: fund.quotedNav,
          source: "cron",
        },
      });

      result.schemesInvesting += 1;
      result.investedAnchor += costAnchor;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Scheme ${scheme._id.toString()}: ${message}`);
    }
  }

  return result;
}
