import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import { DEFENSE_ENVELOPE_FALLBACK_GDP_FRACTION } from "@/lib/constants/military";

/** The budget fields the defence-line cascade reads. */
export type DefenseLineSource = Pick<
  FederalBudget,
  "spending" | "baselineSpendingByCategory" | "gdp"
>;

/**
 * A country's defence appropriation for the year, in absolute local currency:
 * enacted → baseline category → a fraction of GDP.
 *
 * UNSLICED and UNCAPPED — this is the whole enacted line, and the appropriation accrues it
 * whole. It was once also sliced and floored into a synthetic "discretionary envelope" for
 * the Defense metrics; that gauge is retired, because its floor was country-independent and
 * 26 of 27 live nations sat exactly on it. The metrics now read the upkeep burden instead.
 *
 * ⚠️ The burden does NOT vary with this line — see `upkeepBurden`, where the accrual cancels.
 * The line still matters for what the appropriation ACCRUES and therefore what procurement
 * can afford; it just does not move the Defense metrics.
 *
 * Shared by the appropriation and the metrics on purpose: a line that one of them read and
 * the other did not would be a silent divergence between what a player is charged and what
 * the force metrics measure them against.
 */
export function resolveDefenseLineFrom(budget: DefenseLineSource | null): number {
  if (!budget) return 0;
  const enacted = budget.spending?.byCategory?.defense;
  if (typeof enacted === "number" && enacted > 0) return enacted;
  const baseline = budget.baselineSpendingByCategory?.defense;
  if (typeof baseline === "number" && baseline > 0) return baseline;
  const gdp = budget.gdp;
  if (typeof gdp === "number" && gdp > 0) return gdp * DEFENSE_ENVELOPE_FALLBACK_GDP_FRACTION;
  return 0;
}

/** DB-reading form of {@link resolveDefenseLineFrom}. */
export async function resolveDefenseLine(db: Db, countryId: string): Promise<number> {
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ countryId });
  return resolveDefenseLineFrom(budget);
}
