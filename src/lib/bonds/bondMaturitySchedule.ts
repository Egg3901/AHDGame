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
 * All bonds a corporation issues carry that corporation's own currency, so the
 * amounts here stay in the caller's units (local, matching `bond.totalIssued`)
 * and need no FX pass. That is what separates this from
 * {@link sumBondPrincipalAnchor}, which normalizes a mixed-issuer list to ₳.
 */

/** Turns before a repayment at which the Bonds tab escalates to a warning. */
export const BOND_MATURITY_WARNING_TURNS = 24;

/** The bond fields this schedule reads; a structural subset of the tab's `BondData`. */
export interface BondMaturityScheduleBond {
  /** Face value outstanding, in the issuing corporation's currency. */
  totalIssued: number;
  maturityTurn: number;
  matured: boolean;
  defaulted: boolean;
}

/** One repayment date, with every bond coming due on it rolled together. */
export interface BondMaturityGroup {
  maturityTurn: number;
  /** Clamped at 0: a bond past its maturity turn settles on the next turn processed. */
  turnsRemaining: number;
  amount: number;
  bondCount: number;
}

export interface BondMaturitySchedule {
  /** Face value still to be repaid across every live bond. */
  totalPrincipalDue: number;
  /** The soonest repayment, or null when nothing is outstanding. */
  next: BondMaturityGroup | null;
  /** True once `next` falls inside {@link BOND_MATURITY_WARNING_TURNS}. */
  approaching: boolean;
}

export function bondMaturitySchedule(
  bonds: readonly BondMaturityScheduleBond[],
  currentTurn: number
): BondMaturitySchedule {
  let totalPrincipalDue = 0;
  // Keyed by maturity turn so two bonds due together read as the one cash
  // event they are, rather than as two smaller ones the CEO can afford apart.
  const byMaturityTurn = new Map<number, BondMaturityGroup>();

  for (const bond of bonds) {
    // A matured bond is already paid and a defaulted one is settled through
    // the dissolution / refinance ladder instead, so neither is money the
    // corporation still has to find.
    if (bond.matured || bond.defaulted) continue;
    totalPrincipalDue += bond.totalIssued;

    const group = byMaturityTurn.get(bond.maturityTurn);
    if (group) {
      group.amount += bond.totalIssued;
      group.bondCount += 1;
      continue;
    }
    byMaturityTurn.set(bond.maturityTurn, {
      maturityTurn: bond.maturityTurn,
      turnsRemaining: Math.max(0, bond.maturityTurn - currentTurn),
      amount: bond.totalIssued,
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
