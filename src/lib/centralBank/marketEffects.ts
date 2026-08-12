/**
 * B4 market effects: the second half of central-bank credibility.
 *
 * `credibility.ts` gave scrutiny (`CentralBank.chairInfamy`, 0-100) one
 * consequence, a floored dampener on the inflation-EXPECTATIONS channel. This
 * module gives it the three market consequences that were deliberately split
 * out of that PR because they are the ones that cannot spiral:
 *
 *  1. Sovereign spread. A discredited bank's government borrows dearer.
 *  2. FX target adherence. The same reserves buy less of the target.
 *  3. Deposit flight. Households park savings outside the domestic banking
 *     system, in currencies whose issuer they still believe.
 *
 * Three properties are load-bearing and every function here honours them:
 *
 *  - **No inflation feedback.** Nothing here returns into the inflation term.
 *    The expectations dampener is the ONLY credibility-to-inflation channel,
 *    and a second one is what would close the death-spiral loop.
 *  - **Bounded and floored.** A maximally discredited bank still has a
 *    functioning market: a finite spread, a partly effective intervention, and
 *    a banking system that still takes deposits. Ruin is expensive, not
 *    terminal.
 *  - **Zero at full credibility.** At scrutiny 0 every multiplier here is
 *    exactly 1 and every delta exactly 0, so a clean bank sees literally no
 *    change and existing balance cannot be perturbed.
 *
 * Pure math only. Wiring lives at the three call sites.
 */

import { credibilityFromScrutiny } from "@/lib/centralBank/credibility";

/**
 * Extra percentage points on the sovereign coupon at MAXIMUM scrutiny.
 *
 * Sized against the existing yield curve rather than against real-world crisis
 * spreads: the 5yr term premium is 0.75pp, so 1.5pp makes total loss of
 * credibility cost about twice what the longest maturity costs. That is a
 * genuine budget line on a large debt stock without being the kind of number
 * that pushes a country into sovereign default on its own, which would be an
 * inflation-adjacent spiral by another route.
 */
export const SOVEREIGN_CREDIBILITY_SPREAD_MAX_PP = 1.5;

/**
 * Share of an intervention's market effect that survives at MAXIMUM scrutiny.
 *
 * Mirrors `TRANSMISSION_FLOOR` (0.6) in spirit but sits higher, at 0.7. An
 * intervention is a real reserve outlay, not a statement, so a discredited bank
 * loses less of it than it loses of pure jawboning. The reserve cost is
 * unchanged: what falls is what the spend buys, which is the correct shape for
 * "the market doubts you will hold the line".
 */
export const FX_ADHERENCE_FLOOR = 0.7;

/**
 * Share of NPC household deposits domestic banks still capture at MAXIMUM
 * scrutiny.
 *
 * The highest floor of the three, at 0.8. Deposit flight is sticky in reality
 * (accounts, wages and prices are all denominated at home) and the flagged
 * private-banking system is young, so a fifth of capturable deposits walking is
 * already a visible dent in bank funding without threatening solvency across
 * the board.
 */
export const DEPOSIT_RETENTION_FLOOR = 0.8;

/**
 * Percentage points added to a sovereign bond coupon by lost credibility.
 * 0 at full credibility, {@link SOVEREIGN_CREDIBILITY_SPREAD_MAX_PP} at zero.
 *
 * Linear on purpose: this is a spread investors demand, and a convex curve here
 * would make the last few points of scrutiny catastrophic, which is exactly the
 * cliff the whole B4 design is trying not to build.
 */
export function sovereignCredibilitySpread(scrutiny: number): number {
  const credibility = credibilityFromScrutiny(scrutiny);
  return SOVEREIGN_CREDIBILITY_SPREAD_MAX_PP * (1 - credibility);
}

/**
 * Multiplier on the market effect an FX intervention achieves, NOT on what it
 * costs. 1 at full credibility, {@link FX_ADHERENCE_FLOOR} at zero.
 */
export function interventionAdherenceMultiplier(scrutiny: number): number {
  return FX_ADHERENCE_FLOOR + (1 - FX_ADHERENCE_FLOOR) * credibilityFromScrutiny(scrutiny);
}

/**
 * Multiplier on the share of NPC household deposits domestic banks capture.
 * 1 at full credibility, {@link DEPOSIT_RETENTION_FLOOR} at zero. The remainder
 * is not destroyed, it simply stays outside the domestic banks as foreign
 * currency holdings, so the money-supply books still balance.
 */
export function domesticDepositRetention(scrutiny: number): number {
  return (
    DEPOSIT_RETENTION_FLOOR + (1 - DEPOSIT_RETENTION_FLOOR) * credibilityFromScrutiny(scrutiny)
  );
}
