/**
 * Per-turn IMF sovereign-facility processor.
 *
 * Mirrors `imfBailoutTurn.ts` for sovereigns:
 *   - reads each country with `imfSovereignBailoutActive: true`
 *   - per-turn income approximated as annual revenue / TURNS_PER_YEAR
 *   - delegates math to existing `computeImfFacilityPaymentTurn`
 *   - persists new principal/amortization on the federal-budget row
 *   - credits IMF Corp `liquidCapital` by the actual payment, FX-converted
 *     from the country's local revenue currency to the IMF Corp's
 *     `liquidCurrencyCode` via the anchor.
 *
 * Country-side balance impact (capture acts as forced spending) is left for
 * the existing budget→metrics pipeline. Phase 5 only models the IMF Corp
 * credit side; budget-revenue netting lands in Phase 8 / 10 calibration.
 */

import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { FederalBudget } from "@/lib/db/types/budget";
import { getImfCorporation } from "@/lib/imf/resolveImfCorporation";
import { computeImfFacilityPaymentTurn } from "@/lib/imf/imfFacilityMath";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import {
  anchorToCorpLiquidCapital,
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";
import {
  IMF_SOVEREIGN_AMORTIZATION_TURNS,
  IMF_SOVEREIGN_INCOME_CAPTURE_DEFAULT,
} from "./constants";

const PRINCIPAL_EPS = 1e-6;

export async function processSovereignImfFacilityPayments(
  db: Db,
  _turn: number
): Promise<{ paymentsApplied: number }> {
  const imfCorp = await getImfCorporation(db);
  if (!imfCorp) return { paymentsApplied: 0 };

  const active = await db
    .collection<FederalBudget>("federalBudget")
    .find({ imfSovereignBailoutActive: true })
    .toArray();
  if (active.length === 0) return { paymentsApplied: 0 };

  // FX rates: country revenue is in local currency; IMF Corp liquidCapital
  // is in `liquidCurrencyCode` (typically USD). Convert via the anchor.
  const fxByCurrency = await loadFxRatesByCurrency(db);
  const imfCorpFx = fxRateForCorpFromMap(imfCorp, fxByCurrency);

  let paymentsApplied = 0;
  const now = new Date();

  for (const budget of active) {
    const principal = budget.imfSovereignFacilityPrincipalOutstanding ?? 0;
    if (principal <= PRINCIPAL_EPS) continue;

    const annualRate = budget.imfSovereignFacilityAnnualRate ?? 0;
    const remainingTurns =
      budget.imfSovereignFacilityAmortizationTurnsRemaining ?? IMF_SOVEREIGN_AMORTIZATION_TURNS;
    const captureFraction =
      budget.imfSovereignFacilityIncomeCaptureFraction ?? IMF_SOVEREIGN_INCOME_CAPTURE_DEFAULT;
    const annualRevenue = budget.revenue?.total ?? 0;
    const perTurnRevenue = annualRevenue / TURNS_PER_YEAR;

    const split = computeImfFacilityPaymentTurn({
      principalOutstanding: principal,
      annualRatePercent: annualRate,
      remainingTurns,
      turnIncome: perTurnRevenue,
      incomeCapFraction: captureFraction,
    });

    if (split.actualPayment > PRINCIPAL_EPS) paymentsApplied++;

    const facilityCleared = split.newPrincipal <= PRINCIPAL_EPS;
    const set: Partial<FederalBudget> = {
      imfSovereignFacilityPrincipalOutstanding: facilityCleared ? 0 : split.newPrincipal,
      imfSovereignFacilityAmortizationTurnsRemaining: facilityCleared ? 0 : split.newRemainingTurns,
    };
    if (facilityCleared) {
      set.imfSovereignBailoutActive = false;
    }

    // FX conversion is needed both for the IMF Corp credit AND for the
    // per-budget cumulative-anchor accumulator (Phase 11a). Compute up-front
    // so the budget update can include the cumulative $inc in the same write.
    let paymentAnchor = 0;
    let paymentInImfCurrency = 0;
    if (split.actualPayment > PRINCIPAL_EPS) {
      const countryCcy = budget.countryId
        ? COUNTRY_CURRENCY_MAP[budget.countryId as CountryId]
        : undefined;
      const countryFx = countryCcy ? (fxByCurrency.get(countryCcy) ?? 1) : 1;
      paymentAnchor = corpCapitalToAnchor(split.actualPayment, countryCcy, countryFx);
      paymentInImfCurrency = anchorToCorpLiquidCapital(paymentAnchor, imfCorp, imfCorpFx);
    }

    const update: Record<string, unknown> = { $set: set };
    if (paymentAnchor > 0) {
      update.$inc = { imfSovereignFacilityCumulativePaidAnchor: paymentAnchor };
    }
    await db.collection<FederalBudget>("federalBudget").updateOne({ _id: budget._id }, update);

    if (paymentInImfCurrency > 0) {
      await db.collection<Corporation>("corporations").updateOne(
        { _id: imfCorp._id as ObjectId },
        {
          $inc: { liquidCapital: paymentInImfCurrency },
          $set: { updatedAt: now },
        }
      );
    }
  }

  return { paymentsApplied };
}
