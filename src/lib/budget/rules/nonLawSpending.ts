import { LAW_COUNTRY_IDS } from "@/lib/politicalLegislation/types";
import type { FederalBudget } from "@/lib/db/types/budget";

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
 * Share of GDP a country's law book leaves out of its seeded spending envelope.
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
 * Returns undefined when there is no envelope to compare with or the gap is
 * negligible.
 */
export function calibrateNonLawSpendingShare(args: {
  gdp: number;
  baselineTotal: number;
  lawTotal: number;
}): number | undefined {
  const { gdp, baselineTotal, lawTotal } = args;
  if (!Number.isFinite(gdp) || gdp <= 0) return undefined;
  if (!Number.isFinite(baselineTotal) || baselineTotal <= 0) return undefined;
  if (!Number.isFinite(lawTotal) || lawTotal <= 0) return undefined;
  const share = (baselineTotal - lawTotal) / gdp;
  return share >= NON_LAW_CALIBRATION_MIN_SHARE ? share : undefined;
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
 * exposure, once: a stored share, even zero, is never recomputed.
 */
export function needsNonLawCalibration(
  budget: Pick<FederalBudget, "nonLawSpendingGdpShareBaseline" | "baselineSpendingByCategory">,
  countryId: string
): boolean {
  if (typeof budget.nonLawSpendingGdpShareBaseline === "number") return false;
  if ((LAW_COUNTRY_IDS as readonly string[]).includes(countryId)) return false;
  return !!budget.baselineSpendingByCategory;
}
