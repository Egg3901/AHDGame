/**
 * A8: occupational pension funds.
 *
 * The state pension already exists and is a BUDGET line: each country's
 * `{cc}.health.socialInsurance.primary` sets a pay-as-you-go contributory
 * system funded out of tax. That is the first pillar and this does not touch
 * it.
 *
 * This is the SECOND pillar: a funded scheme attached to a union, holding real
 * assets that were paid in by real employers out of real cash. It exists
 * because the bargaining system shipped in 1.1 gives a union something to
 * bargain FOR beyond this quarter's wage, and because a scheme that holds
 * assets is an institutional investor with weight in the corporate economy the
 * fund work has been building all release.
 *
 * ## No mint anywhere
 *
 * Every ₳ in a scheme was debited from an employer's `liquidCapital` and
 * ledgered on both legs. This is deliberately unlike the NPP investable-cash
 * accrual (`nppInvesting.ts`), which is an uninstrumented modelled mint sitting
 * outside the ledger perimeter. A pension scheme that minted its own assets
 * would be a second one of those, in a system whose whole point is that the
 * assets are real and can fall short.
 *
 * ## Liabilities are what make the assets mean something
 *
 * A scheme that only ever accumulates is a savings account with extra steps.
 * Each covered worker accrues a claim every turn they are covered, so the
 * scheme has a number it has to cover, and the ratio between the two is the
 * fact everybody argues about: the union when it bargains, the employer when it
 * is asked to top up.
 */

/** Employer contribution as a share of the covered wage bill. */
export const PENSION_CONTRIBUTION_RATE_MIN = 0;
export const PENSION_CONTRIBUTION_RATE_MAX = 0.15;

/**
 * Liability accrued per worker per turn, as a multiple of that worker's wage
 * cost for the turn.
 *
 * Set BELOW the contribution ceiling on purpose: a scheme contributing at the
 * maximum rate builds a surplus rather than running to stand still, so the
 * bargained rate is a real choice with a visible consequence either way. At the
 * default rate of zero a scheme accrues liabilities it cannot fund, which is
 * the correct picture of promising a pension and paying nothing in.
 */
export const PENSION_ACCRUAL_RATE = 0.08;

/** Below this funding ratio a scheme is in deficit and the employer owes a top-up. */
export const PENSION_DEFICIT_RATIO = 0.9;

/**
 * Share of the shortfall an employer is asked for in one turn. Deliberately
 * partial: a deficit that had to be closed in a single turn would bankrupt an
 * employer for a slow-moving accounting number, and a scheme that recovers over
 * a couple of game-years is the realistic shape.
 */
export const PENSION_TOPUP_FRACTION = 0.05;

/** Funding ratio bands, for the surface and for the bargaining argument. */
export type PensionFundingBand = "surplus" | "funded" | "deficit" | "critical";

export const PENSION_CRITICAL_RATIO = 0.6;

/**
 * Phase 2: what a scheme owns, all of it.
 *
 * THE most important function in this file. Phase 1 could get away with reading
 * `scheme.assetsAnchor` as "the assets" because cash was all a scheme could
 * hold. The moment a scheme buys index-fund units, that field is only the cash
 * leg, and any funding ratio computed from it alone reports a scheme that just
 * invested half its money as half funded. Every ratio, band and top-up read
 * goes through here.
 *
 * Invested value is marked to market: units times the fund's quoted NAV. A
 * scheme whose funds fall is genuinely less well funded, and its employer is
 * genuinely asked for more. That is the point of holding assets rather than a
 * number.
 */
export function pensionSchemeAssetsAnchor(scheme: {
  assetsAnchor: number;
  investedValueAnchor?: number;
}): number {
  const cash = Number.isFinite(scheme.assetsAnchor) ? Math.max(0, scheme.assetsAnchor) : 0;
  const invested =
    typeof scheme.investedValueAnchor === "number" && Number.isFinite(scheme.investedValueAnchor)
      ? Math.max(0, scheme.investedValueAnchor)
      : 0;
  return cash + invested;
}

/**
 * Share of the not-yet-in-payment liability that comes into payment each turn.
 *
 * Union membership is modelled in aggregate (sector unionization rates and a
 * union's membership pressure), and a player character who retires is DELETED
 * by `retireCharacter`, so there is no individual pensioner anywhere in the
 * data to pay. Benefits are therefore a flow against the covered workforce as a
 * whole, exactly like the wage bill the contribution and the accrual are keyed
 * off. Roughly one in a hundred accrued claims falling into payment per turn is
 * a working lifetime measured in the game's turn cadence.
 */
export const PENSION_RETIREMENT_RATE = 0.01;

/**
 * Share of the in-payment stock paid out per turn. A pensioner draws a pension
 * for years, not once, so the stock drains gradually and a scheme that stops
 * receiving contributions still owes benefits for a long time. That lag is what
 * makes underfunding a slow, visible problem rather than a one-turn event.
 */
export const PENSION_BENEFIT_DRAWDOWN_RATE = 0.02;

/**
 * How many turns of benefits a scheme keeps in cash before it may invest.
 *
 * Eight turns at the drawdown rate above. Chosen rather than derived: it is
 * long enough that an ordinary run of turns never forces a cut caused purely by
 * the scheme having invested, and short enough that a mature scheme still puts
 * the overwhelming majority of its assets to work. Investing to the last ₳ and
 * then cutting pensions would be the scheme's own fault rather than a
 * consequence of underfunding, which is the only thing the cut is supposed to
 * mean.
 */
export const PENSION_LIQUIDITY_BUFFER_TURNS = 8;

/**
 * A hard ceiling on the share of CASH that may be invested in one turn,
 * independent of the benefit buffer.
 *
 * A young scheme has no benefits in payment at all, so the buffer above is zero
 * and would let it invest every ₳ it holds. This keeps a tenth back regardless,
 * so a scheme always has something liquid the turn its first pensioners appear.
 */
export const PENSION_CASH_FLOOR_FRACTION = 0.1;

/** Below this, investing is not worth a fund transaction. */
export const PENSION_MIN_INVESTMENT_ANCHOR = 1000;

export function pensionFundingRatio(assetsAnchor: number, liabilitiesAnchor: number): number {
  // A scheme with no liabilities is trivially funded rather than dividing by
  // zero. That is the state of every scheme on the turn it is created.
  if (!Number.isFinite(liabilitiesAnchor) || liabilitiesAnchor <= 0) return 1;
  if (!Number.isFinite(assetsAnchor) || assetsAnchor <= 0) return 0;
  return assetsAnchor / liabilitiesAnchor;
}

export function pensionFundingBand(ratio: number): PensionFundingBand {
  if (ratio >= 1) return ratio > 1.1 ? "surplus" : "funded";
  if (ratio < PENSION_CRITICAL_RATIO) return "critical";
  if (ratio < PENSION_DEFICIT_RATIO) return "deficit";
  return "funded";
}

export function isValidContributionRate(rate: number): boolean {
  return (
    Number.isFinite(rate) &&
    rate >= PENSION_CONTRIBUTION_RATE_MIN &&
    rate <= PENSION_CONTRIBUTION_RATE_MAX
  );
}

/**
 * One employer's contribution for one turn.
 *
 * `coveredWageBill` is the summed labour cost of the sectors the agreement
 * covers. An absent or unusable wage bill contributes NOTHING rather than
 * guessing: the labour system can be switched off entirely, and inventing a
 * wage bill would charge an employer for workers the economy is not modelling.
 */
export function pensionContributionForTurn(params: {
  coveredWageBill: number;
  contributionRate: number;
}): number {
  const { coveredWageBill, contributionRate } = params;
  if (!Number.isFinite(coveredWageBill) || coveredWageBill <= 0) return 0;
  if (!isValidContributionRate(contributionRate) || contributionRate <= 0) return 0;
  return coveredWageBill * contributionRate;
}

/**
 * The claim covered workers accrue this turn.
 *
 * Keyed off the same wage bill as the contribution, so a scheme covering
 * better-paid workers owes more, and so a workplace that shrinks stops accruing
 * rather than carrying a liability for workers who are not there.
 */
export function pensionAccrualForTurn(coveredWageBill: number): number {
  if (!Number.isFinite(coveredWageBill) || coveredWageBill <= 0) return 0;
  return coveredWageBill * PENSION_ACCRUAL_RATE;
}

/**
 * What an employer is asked to top up this turn, if anything.
 *
 * Returns 0 for a scheme in balance, so the ordinary case writes nothing. The
 * top-up is a fraction of the SHORTFALL, not of the liability, so a scheme that
 * is nearly funded asks for nearly nothing.
 */
export function pensionTopUpForTurn(params: {
  assetsAnchor: number;
  liabilitiesAnchor: number;
}): number {
  const ratio = pensionFundingRatio(params.assetsAnchor, params.liabilitiesAnchor);
  if (ratio >= PENSION_DEFICIT_RATIO) return 0;

  const target = params.liabilitiesAnchor * PENSION_DEFICIT_RATIO;
  const shortfall = target - Math.max(0, params.assetsAnchor);
  if (shortfall <= 0) return 0;
  return shortfall * PENSION_TOPUP_FRACTION;
}

/**
 * Claims that come into payment this turn.
 *
 * Only the part of the liability NOT already in payment can retire, so the
 * in-payment stock can never exceed the total promise. A scheme with no accrued
 * liability retires nothing, which is the state of a scheme on the turn it is
 * created.
 */
export function pensionRetirementsForTurn(params: {
  liabilitiesAnchor: number;
  benefitsInPaymentAnchor: number;
}): number {
  const total = Number.isFinite(params.liabilitiesAnchor)
    ? Math.max(0, params.liabilitiesAnchor)
    : 0;
  const inPayment = Number.isFinite(params.benefitsInPaymentAnchor)
    ? Math.max(0, params.benefitsInPaymentAnchor)
    : 0;
  const notYetInPayment = total - inPayment;
  if (notYetInPayment <= 0) return 0;
  return notYetInPayment * PENSION_RETIREMENT_RATE;
}

/** What pensioners are owed this turn, before anyone checks whether it is there. */
export function pensionBenefitsDueForTurn(benefitsInPaymentAnchor: number): number {
  if (!Number.isFinite(benefitsInPaymentAnchor) || benefitsInPaymentAnchor <= 0) return 0;
  return benefitsInPaymentAnchor * PENSION_BENEFIT_DRAWDOWN_RATE;
}

export interface PensionBenefitPayment {
  /** What the scheme actually pays. Never more than the cash it holds. */
  paidAnchor: number;
  /** What fell due and did not get paid. */
  unpaidAnchor: number;
  /** 0 when benefits were paid in full, up to 1 when nothing could be paid. */
  cutFraction: number;
}

/**
 * The pro-rata cut. The entire reason the funding ratio exists.
 *
 * A scheme pays benefits out of the CASH it holds. It does not overdraw, it
 * does not borrow, and it categorically does not mint: a scheme that could pay
 * a benefit it had no assets for would make every contribution, every top-up
 * and every funding ratio in phase 1 decorative. When the cash is short, every
 * pensioner takes the same proportional cut, because a pension scheme that paid
 * some members in full and others nothing would be choosing between them, and
 * nothing in the model gives it a basis to choose.
 *
 * The unpaid part is NOT forgiven and NOT carried as arrears: the claim stays
 * on the books as liability, so the scheme still shows as underfunded and the
 * employer still gets asked for a top-up next turn.
 */
export function pensionBenefitPayment(params: {
  benefitsDueAnchor: number;
  cashAnchor: number;
}): PensionBenefitPayment {
  const due =
    Number.isFinite(params.benefitsDueAnchor) && params.benefitsDueAnchor > 0
      ? params.benefitsDueAnchor
      : 0;
  if (due <= 0) return { paidAnchor: 0, unpaidAnchor: 0, cutFraction: 0 };

  const cash = Number.isFinite(params.cashAnchor) && params.cashAnchor > 0 ? params.cashAnchor : 0;
  if (cash >= due) return { paidAnchor: due, unpaidAnchor: 0, cutFraction: 0 };

  return { paidAnchor: cash, unpaidAnchor: due - cash, cutFraction: (due - cash) / due };
}

/**
 * How much cash a scheme may put into index funds this turn.
 *
 * Two constraints, and the tighter one wins:
 *
 * 1. Keep `PENSION_LIQUIDITY_BUFFER_TURNS` turns of benefits in cash. Fund
 *    units are not a payment instrument here: the scheme has no redemption
 *    path, so anything invested is unavailable to pensioners. Investing past
 *    the buffer would manufacture the pro-rata cut rather than reveal it.
 * 2. Never invest more than `1 - PENSION_CASH_FLOOR_FRACTION` of cash, so a
 *    scheme with no pensioners yet does not go fully illiquid before its first
 *    one appears.
 *
 * Returns 0 below `PENSION_MIN_INVESTMENT_ANCHOR` so a scheme with pocket
 * change does not generate a fund transaction every turn forever.
 */
export function pensionInvestableCashAnchor(params: {
  cashAnchor: number;
  benefitsInPaymentAnchor: number;
}): number {
  const cash = Number.isFinite(params.cashAnchor) ? Math.max(0, params.cashAnchor) : 0;
  if (cash <= 0) return 0;

  const inPayment = Number.isFinite(params.benefitsInPaymentAnchor)
    ? Math.max(0, params.benefitsInPaymentAnchor)
    : 0;
  const buffer = pensionBenefitsDueForTurn(inPayment) * PENSION_LIQUIDITY_BUFFER_TURNS;

  const afterBuffer = cash - buffer;
  const afterFloor = cash * (1 - PENSION_CASH_FLOOR_FRACTION);
  const investable = Math.min(afterBuffer, afterFloor);
  if (!Number.isFinite(investable) || investable < PENSION_MIN_INVESTMENT_ANCHOR) return 0;
  return investable;
}

/**
 * Copy for the union dashboard and the employer's console. One sentence per
 * band, because "0.83" tells a player nothing about what to do next.
 */
export function describeFundingBand(band: PensionFundingBand): string {
  switch (band) {
    case "surplus":
      return "The scheme holds more than it owes. There is room to bargain the contribution rate down, or the pension up.";
    case "funded":
      return "The scheme can cover what it has promised.";
    case "deficit":
      return "The scheme is short. The employer is being asked for a top-up every turn until it recovers.";
    case "critical":
      return "The scheme is badly short of what it owes. Top-ups alone will take a long time to close this.";
  }
}
