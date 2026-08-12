/**
 * A8 phase 2, part A: benefits in payment.
 *
 * A scheme that only ever collects is a savings account. This is the turn pass
 * where the promise comes due.
 *
 * ## Who gets paid
 *
 * Nobody addressable, and that is a finding rather than a shortcut. Union
 * membership is modelled in aggregate (a sector's unionization rate and a
 * union's membership pressure); there is no member document and no link from a
 * character to a union. A player character who retires is DELETED outright by
 * `retireCharacter`, which snapshots them into `retiredCharacters` and removes
 * the wallet a benefit could be credited to. So benefits are a flow paid to the
 * modelled covered workforce and out of the instrumented perimeter, ledgered
 * against `counterpartyType: "system"` exactly like every other payment to
 * households. The scheme's assets fall by what it pays; nothing is created.
 *
 * ## The cut
 *
 * Benefits are paid from CASH. When the cash is short every pensioner takes the
 * same proportional cut and the unpaid claim stays on the books. This is the
 * whole consequence of underfunding and the reason the funding ratio is worth
 * computing. See `pensionBenefitPayment` for why the scheme never overdraws.
 */

import type { Db } from "mongodb";
import type { PensionScheme } from "@/lib/db/types/pensionScheme";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { emitTx } from "@/lib/financialTxLog/emit";
import {
  pensionBenefitPayment,
  pensionBenefitsDueForTurn,
  pensionRetirementsForTurn,
} from "./rules";
import { PENSION_SCHEMES } from "./schemeAssets";

export interface PensionBenefitsResult {
  schemesPaying: number;
  retirementsAnchor: number;
  benefitsPaidAnchor: number;
  /** Benefits that fell due against assets that were not there. */
  benefitsUnpaidAnchor: number;
  /** Schemes that had to cut. The visible face of underfunding. */
  schemesCutting: number;
  errors: string[];
}

/**
 * Retire claims, then pay this turn's benefits, for every scheme that has one.
 *
 * Order matters: claims retire BEFORE the drawdown is computed, so a scheme's
 * first pensioners start drawing the turn they retire rather than a turn later,
 * and the buffer the investment pass reserves is sized off the up-to-date
 * in-payment stock.
 */
export async function runPensionBenefitsTurn(
  db: Db,
  currentTurn: number
): Promise<PensionBenefitsResult> {
  const result: PensionBenefitsResult = {
    schemesPaying: 0,
    retirementsAnchor: 0,
    benefitsPaidAnchor: 0,
    benefitsUnpaidAnchor: 0,
    schemesCutting: 0,
    errors: [],
  };

  const schemes = await db
    .collection<PensionScheme>(PENSION_SCHEMES)
    .find({ liabilitiesAnchor: { $gt: 0 } })
    .toArray();
  if (schemes.length === 0) return result;

  for (const scheme of schemes) {
    try {
      const inPaymentBefore = scheme.benefitsInPaymentAnchor ?? 0;

      const retirements = pensionRetirementsForTurn({
        liabilitiesAnchor: scheme.liabilitiesAnchor,
        benefitsInPaymentAnchor: inPaymentBefore,
      });
      const inPayment = inPaymentBefore + retirements;

      const due = pensionBenefitsDueForTurn(inPayment);
      const payment = pensionBenefitPayment({
        benefitsDueAnchor: due,
        cashAnchor: scheme.assetsAnchor,
      });

      const now = new Date();
      // A guarded update. `assetsAnchor: { $gte: paid }` is the belt to the
      // pure function's braces: if anything else moved this scheme's cash
      // between the read and the write, the payment simply does not happen
      // rather than driving the balance negative. A pension scheme with
      // negative assets would be a mint wearing a disguise.
      const update = await db.collection<PensionScheme>(PENSION_SCHEMES).updateOne(
        { _id: scheme._id, assetsAnchor: { $gte: payment.paidAnchor } },
        {
          $inc: {
            assetsAnchor: -payment.paidAnchor,
            // Paying a benefit discharges the claim. Without this the funding
            // ratio would never improve no matter how much a scheme paid out,
            // and the whole measure would be meaningless.
            liabilitiesAnchor: -payment.paidAnchor,
            benefitsInPaymentAnchor: retirements - payment.paidAnchor,
            totalBenefitsPaidAnchor: payment.paidAnchor,
            totalBenefitsUnpaidAnchor: payment.unpaidAnchor,
          },
          $set: {
            lastBenefitTurn: currentTurn,
            lastBenefitCutFraction: payment.cutFraction,
            updatedAt: now,
          },
        }
      );
      if (update.matchedCount === 0) {
        result.errors.push(
          `Scheme ${scheme._id.toString()}: cash moved under the benefit payment; skipped`
        );
        continue;
      }

      result.schemesPaying += 1;
      result.retirementsAnchor += retirements;
      result.benefitsPaidAnchor += payment.paidAnchor;
      result.benefitsUnpaidAnchor += payment.unpaidAnchor;
      if (payment.cutFraction > 0) result.schemesCutting += 1;

      if (payment.paidAnchor > 0) {
        await emitBenefitTx(db, scheme, currentTurn, now, payment.paidAnchor, payment.cutFraction);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Scheme ${scheme._id.toString()}: ${message}`);
    }
  }

  return result;
}

async function emitBenefitTx(
  db: Db,
  scheme: PensionScheme,
  turn: number,
  now: Date,
  paidAnchor: number,
  cutFraction: number
): Promise<void> {
  await emitTx(db, {
    type: "pension_benefit",
    turn,
    createdAt: now,
    subjectType: "pension_scheme",
    subjectId: scheme._id,
    subjectName: `${scheme.unionName} pension scheme`,
    amount: -paidAnchor,
    anchorAmount: -paidAnchor,
    // The scheme's own country currency, matching how the phase 1 contribution
    // rows are denominated. Amounts are ₳, stated outright as `anchorAmount`.
    currencyCode: (COUNTRY_CURRENCY_MAP[scheme.countryId] ?? "USD") as CurrencyCode,
    // Pensioners are modelled workforce, not documents. The other leg leaves
    // the instrumented perimeter, so it derives to a sink rather than to an
    // account that does not exist.
    counterpartyType: "system",
    counterpartyName: "Pensioners",
    meta: {
      schemeId: scheme._id.toString(),
      unionId: scheme.unionId.toString(),
      cutFraction,
    },
  });
}
