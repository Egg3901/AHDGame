import { LAW_COUNTRY_IDS } from "@/lib/politicalLegislation/types";
import type { FederalBudget } from "@/lib/db/types/budget";
import { PLAYER_RESET_DEFICIT_GDP_SHARE_1991 } from "@/lib/seeds/reference/rules/openingFiscalEnvelope";

/** Grow the separately calibrated non-law fiscal envelope with nominal GDP. */
export function nonLawSpendingAmount(gdp: number, share: number | undefined): number {
  if (
    !Number.isFinite(gdp) ||
    gdp <= 0 ||
    typeof share !== "number" ||
    !Number.isFinite(share) ||
    share <= 0
  )
    return 0;
  return Math.round(gdp * share);
}

/**
 * Smallest gap between a country's seeded spending envelope and its law book
 * worth calibrating, as a share of GDP. Below it the law book is complete.
 */
export const NON_LAW_CALIBRATION_MIN_SHARE = 0.005;

/**
 * Version of the non-law calibration a stored share was made with. A share
 * stored without this version (or with an older one) is recalibrated once.
 * v2 caps the gap at the opening fiscal envelope.
 */
export const NON_LAW_CALIBRATION_VERSION = "opening-envelope-v2";

/**
 * Share of GDP a country's law book leaves out of its spending envelope.
 *
 * Countries outside the player law book (LAW_COUNTRY_IDS) carry a handful of
 * seed laws that price only part of what their government spends, plus a
 * seeded general-government envelope (baselineSpendingByCategory and
 * baselineStateGrants). Once the law book takes over, spending fell to the law
 * book alone: in the live 1991 world Germany went from 33% to 12% of GDP and
 * China from 18% to 7% while revenue stayed whole, leaving surpluses no
 * government runs. The gap becomes a fixed share of GDP, the same mechanism the
 * calibrated Russian envelope uses, so later law changes still move spending.
 *
 * The gap is filled only up to what the country can afford at opening: receipts
 * plus the small opening deficit, after debt service (the same envelope
 * fitOpeningFiscalEnvelope sizes openings with). A stale seeded envelope larger
 * than receipts, such as Brazil's pre-fix 1991 book, must not open a deficit of
 * a fifth of GDP.
 *
 * Returns 0 when there is no gap worth booking, undefined when the inputs are
 * unusable.
 */
export function calibrateNonLawSpendingShare(args: {
  gdp: number;
  baselineTotal: number;
  lawTotal: number;
  annualRevenue: number;
  annualDebtService: number;
}): number | undefined {
  const { gdp, baselineTotal, lawTotal, annualRevenue, annualDebtService } = args;
  if (!Number.isFinite(gdp) || gdp <= 0) return undefined;
  if (!Number.isFinite(baselineTotal) || baselineTotal <= 0) return undefined;
  if (!Number.isFinite(lawTotal) || lawTotal <= 0) return undefined;
  if (!Number.isFinite(annualRevenue) || !Number.isFinite(annualDebtService)) return undefined;
  const affordableOperating = Math.max(
    0,
    annualRevenue + gdp * PLAYER_RESET_DEFICIT_GDP_SHARE_1991 - Math.max(0, annualDebtService)
  );
  const target = Math.min(baselineTotal, affordableOperating);
  const share = (target - lawTotal) / gdp;
  return share >= NON_LAW_CALIBRATION_MIN_SHARE ? share : 0;
}

/** Seeded general-government spending envelope (categories plus grants). */
export function seededSpendingEnvelope(
  budget: Pick<FederalBudget, "baselineSpendingByCategory" | "baselineStateGrants">
): number {
  const cats = Object.values(budget.baselineSpendingByCategory ?? {}).reduce<number>(
    (a, v) => a + (typeof v === "number" && Number.isFinite(v) ? v : 0),
    0
  );
  const grants =
    typeof budget.baselineStateGrants === "number" && Number.isFinite(budget.baselineStateGrants)
      ? budget.baselineStateGrants
      : 0;
  return cats + grants;
}

/**
 * Countries in the player law book are calibrated at seed (the Russian
 * envelope, the US/UK opening programs). Everyone else is calibrated on first
 * exposure, once per calibration version: a share stored by the current
 * version, even zero, is never recomputed.
 */
export function needsNonLawCalibration(
  budget: Pick<
    FederalBudget,
    "nonLawSpendingGdpShareBaseline" | "nonLawSpendingCalibration" | "baselineSpendingByCategory"
  >,
  countryId: string
): boolean {
  if ((LAW_COUNTRY_IDS as readonly string[]).includes(countryId)) return false;
  if (!budget.baselineSpendingByCategory) return false;
  return !(
    typeof budget.nonLawSpendingGdpShareBaseline === "number" &&
    budget.nonLawSpendingCalibration === NON_LAW_CALIBRATION_VERSION
  );
}
