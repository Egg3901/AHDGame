import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { FederalBudget } from "@/lib/db/types/budget";

/** The budget fields the intelligence line reads. */
export type IntelligenceLineSource = Pick<FederalBudget, "spending">;

/**
 * A country's intelligence appropriation for the year, in absolute local currency.
 *
 * ENACTED ONLY. Deliberately unlike `resolveDefenseLineFrom`, which cascades enacted →
 * baseline category → a fraction of GDP: that cascade would hand every country in the world
 * a funded intelligence service the moment this field shipped, which is the exact opposite
 * of the seed-at-zero property the funding law is built around. Absent means UNFUNDED,
 * because unfunded is a real and common state here, and it is the state every country
 * starts in until a legislature votes otherwise.
 */
export function resolveIntelligenceLineFrom(budget: IntelligenceLineSource | null): number {
  const enacted = budget?.spending?.byCategory?.intelligence;
  if (typeof enacted === "number" && Number.isFinite(enacted) && enacted > 0) return enacted;
  return 0;
}

/** A turn's income: the annual intelligence line spread over the game year. */
export function intelligenceAccrualPerTurn(line: number): number {
  return Number.isFinite(line) && line > 0 ? line / TURNS_PER_YEAR : 0;
}
