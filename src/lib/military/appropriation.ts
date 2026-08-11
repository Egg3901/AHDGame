import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/**
 * The share of its appropriation a country's SEEDED order of battle consumes in upkeep.
 *
 * The single balance dial in this system — the per-country table beside it
 * (`seedRosterUpkeep.ts`) holds measured facts only, so this is the one number to move if
 * standing forces feel too cheap or too expensive.
 *
 * Read it as: a nation at its historical starting force spends 55% of its defence budget
 * sustaining that force, leaving 45% for procurement. Double the roster and upkeep is 110%
 * of the budget — the overdraft, and then arrears.
 */
export const SEED_UPKEEP_TARGET_SHARE = 0.55;

/** A turn's income: the annual defence line spread over the game year. */
export function accrualPerTurn(defenseLine: number): number {
  return defenseLine > 0 ? defenseLine / TURNS_PER_YEAR : 0;
}

/**
 * What the standing force costs this turn, in absolute local currency.
 *
 * Denominated against the APPROPRIATION, not against GDP. Two reasons, both learned the
 * hard way:
 *
 *  1. `upkeepBase` is an abstract unit shared by every country — a British and an American
 *     division both cost 70 — so it cannot be compared to money directly. The existing
 *     defence envelope only works because its baseline floor dwarfs every small country's
 *     real slice; it is a synthetic allowance, not currency.
 *  2. A GDP-keyed divisor fails one era later. The defence-line-to-GDP ratio swings hugely
 *     (US 13.6% in 1953, ~3.4% in 2019), so a divisor calibrated in one era puts the same
 *     country deep in arrears in another while looking correct where it was measured.
 *
 * `totalUpkeep` and `seedRosterUpkeep` are BOTH `aggregateForce().totalUpkeep` values, so
 * MILITARY_COUNTRY_SCALE, posture and force-tier multipliers appear on both sides and
 * cancel. Never re-apply the country scale here — doing so double-scales RU by 2.4x.
 *
 * Returns 0 on any unusable input rather than throwing or guessing: this runs as a per-turn
 * sweep over every country, so a data gap must not take down the turn loop, and an invented
 * charge would put a whole nation into arrears over a missing table entry. The coverage
 * test in `seedRosterUpkeep.test.ts` is what stops that path being reached in practice.
 */
export function upkeepPerTurn(
  totalUpkeep: number,
  seedRosterUpkeep: number,
  defenseLine: number
): number {
  if (!(seedRosterUpkeep > 0) || !(defenseLine > 0)) return 0;
  return accrualPerTurn(defenseLine) * SEED_UPKEEP_TARGET_SHARE * (totalUpkeep / seedRosterUpkeep);
}

/**
 * How far the pot may go negative: one year's accrual, i.e. the whole annual line.
 *
 * Returned POSITIVE; the balance floor is its negation. A country with no usable defence
 * line gets a floor of 0 and therefore cannot borrow at all, which is correct — there is no
 * appropriation to borrow against.
 */
export function overdraftFloor(defenseLine: number): number {
  return defenseLine > 0 ? defenseLine : 0;
}

export interface AppropriationSettlement {
  /** Closing balance after accrual and whatever upkeep could be funded. */
  balance: number;
  /**
   * The NET change this turn (`accrual − paid`), which is what the persist path applies.
   *
   * The absolute `balance` above is for reporting only. Writing it back would be a
   * read-modify-write over money: a player recruiting between this step's read and its write
   * has their debit silently reverted by the absolute value, minting the unit for free. The
   * delta is applied as an atomic `$inc` instead, so concurrent spends compose.
   */
  delta: number;
  /** Upkeep actually funded this turn. */
  paid: number;
  /** How much further below zero the balance went — drawn as national debt. */
  overdraftDrawn: number;
  /** 0..1 share of this turn's upkeep left unfunded. */
  arrearsRatio: number;
}

/**
 * Credit the turn's accrual, then fund as much upkeep as the balance and the overdraft
 * allow.
 *
 * Upkeep is funded continuously rather than all-or-nothing: it is an obligation already
 * incurred, not a purchase, so it is paid down to the exact floor and only the remainder
 * becomes arrears. That also makes the arrears ratio a smooth signal — a force 10% beyond
 * its budget sags slightly rather than collapsing.
 */
export function settleAppropriation(
  opening: number,
  accrual: number,
  upkeep: number,
  floor: number
): AppropriationSettlement {
  const afterAccrual = opening + accrual;
  const minBalance = -Math.max(0, floor);
  const payable = Math.max(0, afterAccrual - minBalance);
  const due = Math.max(0, upkeep);
  const paid = Math.min(due, payable);
  const balance = afterAccrual - paid;
  // The INCREASE in the negative position — an opening balance already below zero has
  // been borrowed for in an earlier turn and must not be charged to the treasury twice.
  const overdraftDrawn = Math.max(0, -balance) - Math.max(0, -afterAccrual);
  const arrearsRatio = due > 0 ? (due - paid) / due : 0;
  return { balance, delta: accrual - paid, paid, overdraftDrawn, arrearsRatio };
}

/**
 * Share of a turn's defence income the standing force consumes — the affordability signal
 * the Defense metrics read.
 *
 * Reduces to `SEED_UPKEEP_TARGET_SHARE × (liveRoster / seedRoster)`. A country at its
 * historical starting force reads 0.55 whatever its currency or decade, and diverges only as
 * a player grows the force past the size that country was seeded at.
 *
 * ⚠️ The defence LINE CANCELS. `upkeepPerTurn` is itself `accrual × 0.55 × (live/seed)`, so
 * dividing by accrual leaves `0.55 × (live/seed)` — measured at every line from 1e12 down to
 * 1e-6, the burden is 0.5500 throughout. This measures the force against the country's OWN
 * SEEDED order of battle, not against its budget: a minister who triples or guts the defence
 * line moves this by nothing, and only hits a cliff to null at exactly zero.
 *
 * That is a real improvement over the envelope it replaced — that denominator was a
 * country-independent constant, so 26 of 27 nations divided by the same number — but it is
 * NOT budget sensitivity, and it inherits one hole from the appropriation model: because
 * upkeep is defined as a share of your own accrual, zeroing the defence line zeroes upkeep
 * too, so it never produces arrears and never suppresses readiness. Making this respond to
 * budget choices means pinning the seed calibration to a fixed currency amount instead of to
 * the live accrual — a separate design decision, not a rename.
 *
 * Returns null — not 0 — when there is no usable defence line. 0 would read as "this force
 * is free", which is the most positive signal there is; absent means the metric has nothing
 * to say and must contribute nothing.
 */
export function upkeepBurden(upkeep: number, accrual: number): number | null {
  if (!(accrual > 0)) return null;
  return Math.max(0, upkeep) / accrual;
}
