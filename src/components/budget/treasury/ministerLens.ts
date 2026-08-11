import { formatFundsCompact } from "@/lib/utils/formatters";

/**
 * Pure derivations for the Finance-Minister lens (risk flags + next-FY
 * projection), ported from the design prototype `bbreakdowns.jsx`. Kept separate
 * from the component so the thresholds are unit-tested.
 */

export interface MinisterInputs {
  sym: string;
  revenueTotal: number;
  spendingTotal: number;
  gdp: number;
  debtPrincipal: number;
  debtCeiling: number;
  /** Per-country ceiling label (e.g. "Debt Ceiling", "Borrowing Limit"). */
  ceilingLabel: string;
  /** Real GDP growth %, e.g. 4.6. */
  gdpGrowth: number;
  /** Inflation %, e.g. 1.8. */
  inflationRate: number;
}

export type MinisterFlagTone = "up" | "warning" | "down";

export interface MinisterFlag {
  tone: MinisterFlagTone;
  title: string;
  detail: string;
}

/**
 * Confidential fiscal-health flags: deficit vs GDP, debt-to-GDP, and ceiling
 * headroom. Always returns the deficit + debt-to-GDP flags (one tone each); adds
 * a ceiling flag only when headroom is under ~2.5 years at the current deficit.
 */
export function deriveMinisterFlags(i: MinisterInputs): MinisterFlag[] {
  const surplus = i.revenueTotal - i.spendingTotal;
  const deficitToGdp = i.gdp > 0 ? (surplus / i.gdp) * 100 : 0;
  const dg = i.gdp > 0 ? i.debtPrincipal / i.gdp : 0;
  const headroom = i.debtCeiling - i.debtPrincipal;
  const headroomYrs = surplus < 0 ? headroom / -surplus : Infinity;

  const flags: MinisterFlag[] = [];

  if (deficitToGdp < -5) {
    flags.push({
      tone: "down",
      title: "Deficit breaches 5% of GDP",
      detail: `At ${deficitToGdp.toFixed(1)}%, the gap is wide enough that debt keeps growing faster than the economy.`,
    });
  } else if (deficitToGdp < -3) {
    flags.push({
      tone: "warning",
      title: "Deficit above 3% of GDP",
      detail: `${deficitToGdp.toFixed(1)}%. That is above the level most treasuries treat as safe, but you can carry it while growth holds up.`,
    });
  } else {
    flags.push({
      tone: "up",
      title: "Deficit within tolerance",
      detail: `${deficitToGdp.toFixed(1)}% of GDP. At normal growth, debt should stop rising as a share of the economy.`,
    });
  }

  if (dg > 1.2) {
    flags.push({
      tone: "down",
      title: "Debt-to-GDP above 120%",
      detail: `${(dg * 100).toFixed(0)}% leaves you almost no room to borrow if the economy slumps or interest rates jump.`,
    });
  } else if (dg > 0.9) {
    flags.push({
      tone: "warning",
      title: "Debt-to-GDP near 100%",
      detail: `${(dg * 100).toFixed(0)}% is high. Interest on the debt is now one of your biggest bills.`,
    });
  } else {
    flags.push({
      tone: "up",
      title: "Debt-to-GDP contained",
      detail: `${(dg * 100).toFixed(0)}% is low enough that lenders still see you as a safe bet.`,
    });
  }

  if (Number.isFinite(headroomYrs) && headroomYrs < 2.5) {
    flags.push({
      tone: "down",
      title: `${i.ceilingLabel} within reach`,
      detail: `Only ${formatFundsCompact(headroom, i.sym)} left to borrow, about ${headroomYrs.toFixed(1)} years at the current deficit. You will have to raise the limit, cut spending, or raise taxes.`,
    });
  }

  return flags;
}

export interface MinisterProjection {
  projRevenue: number;
  projSpending: number;
  projSurplus: number;
  projDebtToGdp: number;
  currentDebtToGdp: number;
}

/**
 * Illustrative next-FY projection: revenue tracks GDP growth, spending tracks
 * inflation + a ~1.4pp demographic drift; a projected deficit adds to debt.
 */
export function deriveMinisterProjection(i: MinisterInputs): MinisterProjection {
  const projRevenue = i.revenueTotal * (1 + i.gdpGrowth / 100);
  const projSpending = i.spendingTotal * (1 + (i.inflationRate + 1.4) / 100);
  const projSurplus = projRevenue - projSpending;
  const projDebt = i.debtPrincipal + Math.max(0, -projSurplus);
  const projGdp = i.gdp * (1 + i.gdpGrowth / 100);
  return {
    projRevenue,
    projSpending,
    projSurplus,
    projDebtToGdp: projGdp > 0 ? projDebt / projGdp : 0,
    currentDebtToGdp: i.gdp > 0 ? i.debtPrincipal / i.gdp : 0,
  };
}
