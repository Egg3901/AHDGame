/**
 * Upcoming principal repayments on a corporation's own bonds.
 *
 * A corporate bond hands the issuer the whole face value in cash at issuance
 * and takes the whole face value back in ONE debit on the maturity turn
 * (`bondTurn` Phase 1.5), on every unit outstanding including float that never
 * sold. Nothing in the Bonds tab said so: the issue card priced the coupon and
 * the table showed a countdown, so CEOs spent the proceeds and met the
 * repayment as a surprise, sometimes as a default, because that same debit is
 * folded into the negative-liquid-capital check.
 *
 * Everything here is ₳. A corporation's bonds are NOT guaranteed to share one
 * currency: a relocation re-denominates the corp through convertCorpCurrency
 * but leaves outstanding bonds in the currency they were issued in, so summing
 * raw `totalIssued` across them mixes units and compares wrongly against the
 * corp's present liquid capital. Callers pass the ₳ mirror the bonds route
 * publishes, on the same basis as {@link sumBondPrincipalAnchor}.
 */

/** Turns before a repayment at which the corporation page escalates to a warning. */
export const BOND_MATURITY_WARNING_TURNS = 24;

/** The bond fields this schedule reads. */
export interface BondMaturityScheduleBond {
  /** Face value outstanding, normalized to ₳. */
  principalAnchor: number;
  maturityTurn: number;
  matured: boolean;
  defaulted: boolean;
}

/** One repayment date, with every bond coming due on it rolled together. */
export interface BondMaturityGroup {
  maturityTurn: number;
  /** Clamped at 0: a bond past its maturity turn settles on the next turn processed. */
  turnsRemaining: number;
  /** ₳. */
  amount: number;
  bondCount: number;
}

export interface BondMaturitySchedule {
  /**
   * Face value still to be repaid across every live bond, in ₳.
   *
   * Deliberately NOT the same figure as `bondInfo.totalDebt`, which filters on
   * `!matured` alone and so still counts defaulted paper. Defaulted debt is
   * real debt but it is not a scheduled repayment: it settles through the
   * dissolution / refinance ladder instead. Do not "align" the two.
   */
  totalPrincipalDue: number;
  /** The soonest repayment, or null when nothing is outstanding. */
  next: BondMaturityGroup | null;
  /** True once `next` falls inside {@link BOND_MATURITY_WARNING_TURNS}. */
  approaching: boolean;
}

export function bondMaturitySchedule(
  bonds: readonly BondMaturityScheduleBond[] | undefined,
  currentTurn: number
): BondMaturitySchedule {
  const empty: BondMaturitySchedule = {
    totalPrincipalDue: 0,
    next: null,
    approaching: false,
  };
  // Defensive on both counts: the corporation page already treats
  // `bondInfo.bonds` as possibly absent, and a non-finite turn would render as
  // "due in NaN turns" rather than failing loudly.
  if (!bonds?.length || !Number.isFinite(currentTurn)) return empty;

  let totalPrincipalDue = 0;
  // Keyed by maturity turn so two bonds due together read as the one cash
  // event they are, rather than as two smaller ones the CEO can afford apart.
  const byMaturityTurn = new Map<number, BondMaturityGroup>();

  for (const bond of bonds) {
    // A matured bond is already paid and a defaulted one is settled through
    // the dissolution / refinance ladder instead, so neither is money the
    // corporation still has to find.
    if (bond.matured || bond.defaulted) continue;
    // The bonds route has a redaction branch that returns bond rows carrying
    // only maturity fields, no face value at all. Nothing renders a schedule
    // from that shape today, but one absent principal would otherwise turn the
    // whole sum into NaN, so drop the row rather than poison the total.
    if (!Number.isFinite(bond.principalAnchor)) continue;
    totalPrincipalDue += bond.principalAnchor;

    const group = byMaturityTurn.get(bond.maturityTurn);
    if (group) {
      group.amount += bond.principalAnchor;
      group.bondCount += 1;
      continue;
    }
    byMaturityTurn.set(bond.maturityTurn, {
      maturityTurn: bond.maturityTurn,
      turnsRemaining: Math.max(0, bond.maturityTurn - currentTurn),
      amount: bond.principalAnchor,
      bondCount: 1,
    });
  }

  let next: BondMaturityGroup | null = null;
  for (const group of byMaturityTurn.values()) {
    if (!next || group.maturityTurn < next.maturityTurn) next = group;
  }

  return {
    totalPrincipalDue,
    next,
    approaching: next !== null && next.turnsRemaining <= BOND_MATURITY_WARNING_TURNS,
  };
}
