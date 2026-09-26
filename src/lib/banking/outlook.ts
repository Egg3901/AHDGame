import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { BankCharter, BankLoan, InterbankLoan } from "@/lib/db/types/bank";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { LendingProfileId } from "@/lib/banking/creditBands";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { savingsApyPercent } from "@/lib/currency/savingsInterest";
import { domesticDepositRetention } from "@/lib/centralBank/marketEffects";
import { loadCentralBankPricingAdjustment } from "@/lib/monetaryPolicy/centralBankPricing";
import { isDepositTakingCharter } from "@/lib/banking/charterKinds";
import { effectiveBankRatesFromPrime, playerDepositRatePercent } from "@/lib/banking/rules/rates";
import { computeNpcDepositShare } from "@/lib/banking/rules/deposits";
import {
  MAX_NPC_FLOW_PER_TURN_FRACTION,
  fundedNpcFlowDelta,
  npcFlowDelta,
  perTurnInterest,
  perTurnInterestOn,
} from "@/lib/banking/rules/loans";
import {
  LEGACY_BAND,
  LENDING_PROFILES,
  bandOriginationTargets,
  bandRatePercent,
  getCreditBand,
} from "@/lib/banking/rules/creditBands";
import { computeInsurancePremium, computeReserveRatioActual } from "@/lib/banking/rules/insurance";
import {
  discountWindowRatePercent,
  discountWindowStigma,
} from "@/lib/banking/rules/discountWindow";
import { cbMarginRatePercent } from "@/lib/banking/rules/decide";
import { computeConfidence } from "@/lib/banking/rules/confidence";
import {
  MIN_CAPITAL_RATIO,
  RECAP_GRACE_TURNS,
  STRESS_CAPITAL_RATIO,
  assessCapital,
  borrowingsFromCharter,
  capitalShortfall,
} from "@/lib/banking/rules/capitalAdequacy";
import { PROP_LEVERAGE_MULTIPLE, computePropEquityBase } from "@/lib/banking/rules/propLeverage";
import { requiredReserves as computeRequiredReserves } from "@/lib/banking/rules/balanceSheet";
import type { BankBalanceSheet } from "@/lib/banking/rules/balanceSheet";

/**
 * Next-turn outlook for the bank CEO console.
 *
 * Presentation only: every figure replays the arithmetic the banking turn
 * already enforces, from the same rule modules, with "do nothing" inputs.
 * Nothing here writes, nothing here retunes a constant, and the turn pipeline
 * never reads this object back. When a figure cannot be derived from a rule
 * (per-depositor insurance caps without per-depositor balances), the field
 * carries the approximation in its comment rather than inventing precision.
 */

export interface OutlookStancePreview {
  profile: LendingProfileId;
  /** Expected interest per turn if the book stood at this stance's targets. */
  expectedReturnPerTurn: number;
  /** Expected default write-offs per turn at this stance's targets. */
  expectedLossPerTurn: number;
  /** Funding tied up at this stance's targets. */
  fundingTied: number;
  /** Turns for the book to travel from here to the targets at the flow cap. */
  turnsToTarget: number;
}

export interface BankOutlook {
  /** Prime rate the projection priced off. */
  primeRate: number;
  /** Central-bank savings APY households compare against. */
  cbSavingsApy: number;
  /** Expected NPC deposit movement next turn. Null for non-deposit charters. */
  depositFlow: number | null;
  depositDirection: "in" | "out" | "flat" | null;
  targetNpcDeposits: number | null;
  /** Expected gross new household originations next turn. */
  newLoanDemand: number;
  /** Expected household repayments/run-off next turn. */
  loanRunoff: number;
  /** Expected household default write-offs next turn, in charter currency. */
  expectedDefaults: number;
  projectedCash: number;
  projectedRequired: number;
  projectedBand: "green" | "amber" | "red";
  /** One line when the projection moves the band, else null. */
  bandReason: string | null;
  projectedEarnedPerTurn: number;
  projectedPaidPerTurn: number;
  projectedPremiumPerTurn: number;
  projectedNetPerTurn: number;
  projectedBottomLine: number;
  /** Annualised net interest over the projected loan book, percent. */
  netInterestMarginPercent: number | null;
  /** Annualised interest paid over projected deposits, percent. */
  costOfFundsPercent: number | null;
  recommendationKind: "capital" | "reserves" | "confidence" | "ceiling" | "stress" | "none";
  recommendation: string;
  stancePreview: OutlookStancePreview[];
  /**
   * Prop-book leverage against the cap (banking/propTrading:
   * PROP_LEVERAGE_MULTIPLE of the equity base). Null for charters without a
   * book, so the investing tab can preview headroom before opening.
   */
  propLeverage: {
    equityBase: number;
    markValue: number;
    multiple: number;
    headroom: number;
  } | null;
}

export interface OutlookContext {
  corporationIdHex: string;
  charter: BankCharter;
  currency: CurrencyCode;
  currentTurn: number;
  reserveRatio: number;
  rates: { depositRatePercent: number; lendingRatePercent: number };
  sheet: BankBalanceSheet;
  loans: BankLoan[];
  interbankLoans: InterbankLoan[];
  /** Weakest-confidence-term lever from the console risk readout, if any. */
  weakestTermLever: { key: string; lever: string } | null;
  currentBand: "green" | "amber" | "red";
  /** Whether player savings count as cash-backed liabilities in this currency. */
  playerDepositsAreLiabilities: boolean;
}

const money = (n: number): string =>
  Math.abs(n) >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : `$${Math.round(n).toLocaleString()}`;

export async function buildBankOutlook(db: Db, ctx: OutlookContext): Promise<BankOutlook | null> {
  const { charter, currency, reserveRatio } = ctx;
  const liabilitiesAreReal = ctx.playerDepositsAreLiabilities === true;

  const depositTaking = isDepositTakingCharter(charter);
  const cash = ctx.sheet.cashReserves;
  const npc = Math.max(0, charter.npcDeposits ?? 0);
  // Every savings balance pointed at this bank, whether the currency counts it
  // as vault cash (authoritative) or as a pointer (legacy). The ceiling binds
  // pointers either way, which is why this sums both sheet lines.
  const playerPointed = Math.max(0, ctx.sheet.playerDeposits + ctx.sheet.pointerDeposits);

  const bankId = getBankId(getCountryIdForCurrency(currency));
  const cb = await db
    .collection<CentralBank>("centralBanks")
    .findOne(
      { _id: bankId },
      { projection: { primeRate: 1, inflationHistory: 1, externalBroadMoney: 1, chairInfamy: 1 } }
    );
  const prime =
    typeof cb?.primeRate === "number" && Number.isFinite(cb.primeRate) ? cb.primeRate : 0;
  const inflation = cb?.inflationHistory?.at(-1)?.rate ?? 0;
  const externalBroadMoney =
    typeof cb?.externalBroadMoney === "number" && Number.isFinite(cb.externalBroadMoney)
      ? Math.max(0, cb.externalBroadMoney)
      : 0;
  const pricing = await loadCentralBankPricingAdjustment(db, ctx.currentTurn);
  const cbApy = savingsApyPercent(prime, inflation, pricing.depositBonusPercentPoints);

  // ── Deposit flow: the turn's share math, run for this bank ──────────────
  // Shares are computed across every deposit taker in the currency (rules/
  // deposits.computeNpcDepositShare), exactly as the turn does, so competition
  // and the total cap are in the number rather than assumed away.
  let depositFlow: number | null = null;
  let direction: BankOutlook["depositDirection"] = null;
  let targetNpc: number | null = null;
  if (depositTaking) {
    const peers = await db
      .collection<Corporation>("corporations")
      .find(
        { "bankCharter.status": "active", "bankCharter.currency": currency },
        { projection: { "bankCharter.depositOffset": 1, "bankCharter.type": 1 } }
      )
      .toArray();
    const takers = peers.filter((p) => {
      const t = p.bankCharter?.type;
      return t === "retail" || t === "universal";
    });
    const shares = computeNpcDepositShare(
      takers.map((p) => ({
        bankId: String(p._id),
        effectiveDepositRatePercent: effectiveBankRatesFromPrime(
          { depositOffset: p.bankCharter?.depositOffset ?? 0, lendingOffset: 0 },
          prime
        ).depositRatePercent,
      })),
      cbApy
    );
    const retention = domesticDepositRetention(cb?.chairInfamy ?? 0);
    const mine = shares.find((s) => s.bankId === ctx.corporationIdHex);
    const share = (mine?.share ?? 0) * retention;
    const npcRoom = Math.max(0, ctx.sheet.depositCeiling - playerPointed);
    targetNpc = Math.min(share * externalBroadMoney, npcRoom);
    const flow = Math.max(npcFlowDelta(npc, targetNpc), -Math.floor(cash * 100) / 100);
    depositFlow = flow;
    targetNpc = targetNpc;
    direction = flow > 0.005 ? "in" : flow < -0.005 ? "out" : "flat";
  }

  const requiredNow = ctx.sheet.requiredReserves;
  let cashWalk = cash + (depositFlow ?? 0);
  const projNpc = npc + (depositFlow ?? 0);

  // ── Household book flow: band targets, steered at the flow cap ──────────
  // Per-band targets from rules/creditBands.bandOriginationTargets (the helper
  // the turn enforces), moved with rules/loans.fundedNpcFlowDelta, which caps
  // each band at MAX_NPC_FLOW_PER_TURN_FRACTION and at the cash each payer can
  // deliver. Interest and defaults per turn divide by TURNS_PER_YEAR, as the
  // turn's household servicing does.
  const bulk = ctx.loans.filter(
    (l) => l.borrowerType === "npcBulk" && (l.status === "current" || l.status === "arrears")
  );
  const outstandingByBand = new Map<string, { outstanding: number; rate: number | null }>();
  for (const loan of bulk) {
    const band = loan.creditBand ?? LEGACY_BAND;
    const row = outstandingByBand.get(band) ?? { outstanding: 0, rate: null };
    const out = Math.max(0, loan.outstanding ?? 0);
    const prevOut = row.outstanding;
    row.outstanding = prevOut + out;
    if (out > 0 && loan.ratePercent != null) {
      row.rate =
        prevOut > 0 && row.rate != null
          ? (row.rate * prevOut + loan.ratePercent * out) / row.outstanding
          : loan.ratePercent;
    }
    outstandingByBand.set(band, row);
  }
  const npcOutstanding = bulk.reduce((s, l) => s + Math.max(0, l.outstanding ?? 0), 0);

  const fundingCapacity =
    ctx.sheet.cashBackedDeposits * (1 - reserveRatio) -
    Math.max(0, ctx.sheet.totalLoans - npcOutstanding);
  const targets = bandOriginationTargets({
    fundingCapacity: Math.max(0, fundingCapacity),
    lendingRatePercent: ctx.rates.lendingRatePercent,
    profile: charter.lendingProfile,
  });

  let newDemand = 0;
  let runoff = 0;
  let householdInterest = 0;
  let householdDefaults = 0;
  if (depositTaking) {
    for (const entry of targets) {
      const row = outstandingByBand.get(entry.band);
      const current = row?.outstanding ?? 0;
      const adjust = fundedNpcFlowDelta(current, entry.target, {
        cashReserves: cashWalk,
        requiredReserves: requiredNow,
        householdPool: externalBroadMoney,
      });
      cashWalk -= adjust;
      if (adjust > 0) newDemand += adjust;
      else runoff -= adjust;
      const after = Math.max(0, current + adjust);
      const rate = row?.rate ?? entry.ratePercent;
      householdInterest += (after * (rate / 100)) / TURNS_PER_YEAR;
      householdDefaults +=
        (after * (getCreditBand(entry.band).defaultRatePercent / 100)) / TURNS_PER_YEAR;
    }
  } else {
    for (const row of outstandingByBand.values()) {
      householdInterest += (row.outstanding * ((row.rate ?? 0) / 100)) / TURNS_PER_YEAR;
      householdDefaults +=
        (row.outstanding * (getCreditBand(undefined).defaultRatePercent / 100)) / TURNS_PER_YEAR;
    }
  }

  // Named loans: simple interest on current/arrears balances, as the named
  // servicing pass charges (rules/loans.perTurnInterestOn).
  let namedInterest = 0;
  let arrearsOutstanding = 0;
  for (const loan of ctx.loans) {
    if (loan.borrowerType === "npcBulk") continue;
    const out = Math.max(0, loan.outstanding ?? 0);
    if (loan.status === "arrears" || loan.status === "defaulted") arrearsOutstanding += out;
    if (loan.status === "current" || loan.status === "arrears") {
      namedInterest += (out * ((loan.ratePercent ?? 0) / 100)) / TURNS_PER_YEAR;
    }
  }
  let ibReceived = 0;
  let ibPaid = 0;
  for (const loan of ctx.interbankLoans) {
    if (loan.status !== "current") continue;
    const out = Math.max(0, loan.outstanding ?? 0);
    if (out <= 0) continue;
    if (loan.lenderCorporationId.toString() === ctx.corporationIdHex) {
      // rules/interbankServicing.decideInterbankService: interest-only.
      ibReceived += perTurnInterestOn(out, loan.ratePercent);
    } else {
      ibPaid += perTurnInterestOn(out, loan.ratePercent);
    }
  }

  const earned = householdInterest + namedInterest + ibReceived;

  // Deposit interest: the NPC book at the posted rate, player pointers at the
  // premium over base (rules/rates.playerDepositRatePercent), both rounded to
  // the minor unit as the turn pays them (rules/loans.perTurnInterest).
  const playerRate = playerDepositRatePercent(
    ctx.rates.depositRatePercent,
    liabilitiesAreReal,
    prime,
    inflation
  );
  const npcInterest = perTurnInterest(projNpc, ctx.rates.depositRatePercent, currency);
  const playerInterest = perTurnInterest(playerPointed, playerRate, currency);
  // Facilities price off prime plus their spreads (rules/discountWindow,
  // rules/decide.cbMarginRatePercent), per turn over TURNS_PER_YEAR.
  const windowInterest = perTurnInterestOn(
    Math.max(0, charter.discountWindowDebt ?? 0),
    discountWindowRatePercent(prime)
  );
  const marginInterest = perTurnInterestOn(
    Math.max(0, charter.cbMarginDebt ?? 0),
    cbMarginRatePercent(prime)
  );
  const paid = npcInterest + playerInterest + ibPaid + windowInterest + marginInterest;
  cashWalk += householdInterest + namedInterest + ibReceived - paid;

  // Insurance premium on the projected base (rules/insurance): the insured
  // base is NPC plus every player balance pointed at the bank, because a
  // depositor's claim is a claim either way. Without per-depositor balances
  // the per-account cap cannot be applied, so this reads high for banks with
  // whales over the cap; the direction and scale still follow the rule.
  const insuredBase = projNpc + playerPointed;
  const cashBackedBase = projNpc + (liabilitiesAreReal ? playerPointed : 0);
  const actualRatio = computeReserveRatioActual(cashWalk, cashBackedBase);
  const premium = computeInsurancePremium(insuredBase, actualRatio, reserveRatio);
  cashWalk -= premium;

  const projLoans = Math.max(0, ctx.sheet.totalLoans + (newDemand - runoff) - householdDefaults);
  const projRequired = computeRequiredReserves(
    { npcDeposits: projNpc, playerDeposits: charter.playerDeposits ?? 0 },
    reserveRatio,
    { playerDepositsAreLiabilities: liabilitiesAreReal }
  );

  const projected = computeConfidence({
    cashReserves: cashWalk,
    cashBackedDeposits: cashBackedBase,
    totalLoans: projLoans,
    reserveRatioRequired: reserveRatio,
    arrearsOutstanding,
    defaultsLastTurn: 0,
    panicTurns: charter.panicTurns ?? 0,
    discountWindowStigma: discountWindowStigma(
      {
        npcDeposits: charter.npcDeposits,
        playerDeposits: charter.playerDeposits,
        discountWindowDebt: charter.discountWindowDebt,
      },
      { playerDepositsAreLiabilities: liabilitiesAreReal }
    ),
  });

  const net = earned - paid;
  const bottom = net - premium - householdDefaults;
  const netInterestMarginPercent = projLoans > 0 ? (net * TURNS_PER_YEAR * 100) / projLoans : null;
  const depositBase = projNpc + playerPointed;
  const costOfFundsPercent = depositBase > 0 ? (paid * TURNS_PER_YEAR * 100) / depositBase : null;

  let bandReason: string | null = null;
  if (projected.band !== ctx.currentBand) {
    const cover = projRequired > 0 ? cashWalk / projRequired : 1;
    bandReason =
      projected.band === "green"
        ? `Flows would rebuild cover to ${(cover * 100).toFixed(0)}% of required reserves, back to green.`
        : `Flows would leave cover at ${(cover * 100).toFixed(0)}% of required reserves (${money(cashWalk)} against ${money(projRequired)} required), moving confidence to ${projected.band}.`;
  }

  // ── Recommendation: capital first, then reserves, then the weakest term ──
  // Capital standing comes from rules/capitalAdequacy.assessCapital, the same
  // assessment the console and the supervisor read.
  const position = assessCapital({
    cashReserves: cash,
    totalLoans: ctx.sheet.totalLoans,
    borrowings: borrowingsFromCharter(charter),
    propBookMarkValue: charter.propBookMarkValue,
  });
  const shortfall = capitalShortfall(position);
  let recommendationKind: BankOutlook["recommendationKind"] = "none";
  let recommendation =
    "No action needed: capital clears the 8% minimum and next turn's flows keep reserves above the requirement.";
  const reserveGap = projRequired - cashWalk;
  if (position.standing === "undercapitalized") {
    recommendationKind = "capital";
    recommendation =
      `Post ${money(shortfall)} capital to clear the 8% minimum. ` +
      `Below 8% the supervisor starts a ${RECAP_GRACE_TURNS}-turn (about ${RECAP_GRACE_TURNS}-hour) clock; ` +
      `missing it revokes the charter and winds the bank up in an orderly way, with remaining capital returned.`;
  } else if (reserveGap > 0.005) {
    recommendationKind = "reserves";
    recommendation =
      `Next turn leaves reserves ${money(reserveGap)} short of the requirement. ` +
      `Hold more cash: raise the deposit rate to pull household money in, slow new lending, or draw emergency funding before the turn runs.`;
  } else if (ctx.weakestTermLever && (projected.band !== "green" || ctx.currentBand !== "green")) {
    recommendationKind = "confidence";
    const key = ctx.weakestTermLever.key;
    recommendation =
      key === "reserves"
        ? `Confidence is thinnest on reserve cover: ${money(cashWalk)} cash against ${money(projRequired)} required. ${ctx.weakestTermLever.lever}`
        : key === "capital"
          ? `Confidence is thinnest on capital cover at ${(position.capitalRatio * 100).toFixed(1)}% against the ${(MIN_CAPITAL_RATIO * 100).toFixed(0)}% minimum. ${ctx.weakestTermLever.lever}`
          : `Confidence is thinnest on loan quality: expected defaults run ${money(householdDefaults)} a turn. ${ctx.weakestTermLever.lever}`;
  } else if (
    depositTaking &&
    targetNpc != null &&
    targetNpc >= Math.max(0, ctx.sheet.depositCeiling - playerPointed) - 0.005 &&
    (depositFlow ?? 0) > 0.005
  ) {
    recommendationKind = "ceiling";
    recommendation = `Deposit demand is pressing against the ${money(ctx.sheet.depositCeiling)} ceiling, which currently binds on ${ctx.sheet.depositCeilingBinds === "equity" ? "capital (12x book equity)" : "branch capacity"}. Shift network share toward branches or post capital to grow room.`;
  } else if (position.standing === "stressed") {
    recommendationKind = "stress";
    recommendation = `The bank clears the ${(MIN_CAPITAL_RATIO * 100).toFixed(0)}% minimum but would fall below ${(STRESS_CAPITAL_RATIO * 100).toFixed(0)}% in the supervisor's published shock, so payouts stay barred. Keep profits in the bank until the stressed ratio clears.`;
  }

  // Per-stance preview: the same band targets at each lending profile, with
  // expected return, expected loss, funding tied, and the travel time at the
  // household flow cap (MAX_NPC_FLOW_PER_TURN_FRACTION per turn).
  const stancePreview: OutlookStancePreview[] = LENDING_PROFILES.map((profile) => {
    const profileTargets = bandOriginationTargets({
      fundingCapacity: Math.max(0, fundingCapacity),
      lendingRatePercent: ctx.rates.lendingRatePercent,
      profile: profile.id,
    });
    let expectedReturnPerTurn = 0;
    let expectedLossPerTurn = 0;
    let fundingTied = 0;
    for (const t of profileTargets) {
      fundingTied += t.target;
      expectedReturnPerTurn +=
        (t.target * (bandRatePercent(getCreditBand(t.band), ctx.rates.lendingRatePercent) / 100)) /
        TURNS_PER_YEAR;
      expectedLossPerTurn +=
        (t.target * (getCreditBand(t.band).defaultRatePercent / 100)) / TURNS_PER_YEAR;
    }
    const gap = Math.abs(fundingTied - npcOutstanding);
    const perTurn = MAX_NPC_FLOW_PER_TURN_FRACTION * Math.max(fundingTied, npcOutstanding);
    return {
      profile: profile.id,
      expectedReturnPerTurn,
      expectedLossPerTurn,
      fundingTied,
      turnsToTarget: gap <= 0.005 || perTurn <= 0 ? 0 : Math.ceil(gap / perTurn),
    };
  });

  const runsPropBook = charter.type === "investment" || charter.type === "universal";
  const propMark = Math.max(0, charter.propBookMarkValue ?? 0);
  const propEquityBase = runsPropBook ? computePropEquityBase(cash, charter) : 0;

  return {
    primeRate: prime,
    cbSavingsApy: cbApy,
    propLeverage: runsPropBook
      ? {
          equityBase: propEquityBase,
          markValue: propMark,
          multiple: PROP_LEVERAGE_MULTIPLE,
          headroom: PROP_LEVERAGE_MULTIPLE * propEquityBase - propMark,
        }
      : null,
    depositFlow,
    depositDirection: direction,
    targetNpcDeposits: targetNpc,
    newLoanDemand: newDemand,
    loanRunoff: runoff,
    expectedDefaults: householdDefaults,
    projectedCash: cashWalk,
    projectedRequired: projRequired,
    projectedBand: projected.band,
    bandReason,
    projectedEarnedPerTurn: earned,
    projectedPaidPerTurn: paid,
    projectedPremiumPerTurn: premium,
    projectedNetPerTurn: net,
    projectedBottomLine: bottom,
    netInterestMarginPercent,
    costOfFundsPercent,
    recommendationKind,
    recommendation,
    stancePreview,
  };
}
