/**
 * Retail-bank calibration model. Uses the shared rules to project the household
 * book, deposit cost and insurance premium. This is a diagnosis tool, not the
 * full-world qualification gate; it has no bond inventory or failure resolver.
 */

import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { effectiveBankRatesFromPrime } from "@/lib/banking/rules/rates";
import { computeNpcDepositShare } from "@/lib/banking/rules/deposits";
import { npcFlowDelta, fundedNpcFlowDelta } from "@/lib/banking/rules/loans";
import { bandOriginationTargets, getCreditBand } from "@/lib/banking/rules/creditBands";
import { computeInsurancePremium } from "@/lib/banking/rules/insurance";
import { savingsApyPercent } from "@/lib/currency/savingsInterest";
import { NPC_DEPOSIT_MAX_EQUITY_LEVERAGE } from "@/lib/banking/rules/balanceSheet";
import type { LendingProfileId } from "@/lib/banking/rules/creditBands";

type Run = {
  prime: number;
  inflation: number;
  rr: number;
  depOff: number;
  lendOff: number;
  profile: LendingProfileId;
  turns: number;
  shockTurn?: number;
  shockPp?: number;
};

function simulate(r: Run) {
  const E0 = 10_000_000;
  let cash = E0;
  let npcDeposits = 0;
  const tranches = new Map<string, { out: number; rate: number }>();
  const ebm = 1e12;
  let lastIncome = 0;
  let cumIncome = 0;
  for (let t = 0; t < r.turns; t++) {
    const prime =
      r.shockTurn !== undefined && t >= r.shockTurn ? r.prime + (r.shockPp ?? 0) : r.prime;
    const rates = effectiveBankRatesFromPrime(
      { depositOffset: r.depOff, lendingOffset: r.lendOff },
      prime
    );
    const cbApy = savingsApyPercent(prime, r.inflation, 0);
    const share = computeNpcDepositShare(
      [{ bankId: "b", effectiveDepositRatePercent: rates.depositRatePercent }],
      cbApy
    )[0]!.share;
    const loans = [...tranches.values()].reduce((s, x) => s + x.out, 0);
    const equity = cash + loans - npcDeposits;
    const ceiling = Math.max(0, equity) * NPC_DEPOSIT_MAX_EQUITY_LEVERAGE;
    const target = Math.min(share * ebm, ceiling);
    const delta = Math.max(npcFlowDelta(npcDeposits, target), -cash);
    cash += delta;
    npcDeposits += delta;
    // deposit interest: capitalized onto NPC deposits, cash stays
    const depInt = (npcDeposits * rates.depositRatePercent) / 100 / TURNS_PER_YEAR;
    npcDeposits += depInt;
    // premium
    const prem = computeInsurancePremium(npcDeposits, cash / Math.max(1, npcDeposits), r.rr);
    cash -= Math.min(prem, cash);
    // household book
    const capacity = npcDeposits * (1 - r.rr);
    const targets = bandOriginationTargets({
      fundingCapacity: capacity,
      lendingRatePercent: rates.lendingRatePercent,
      primeRatePercent: prime,
      profile: r.profile,
    });
    let interest = 0;
    let defaults = 0;
    for (const tg of targets) {
      const existing = tranches.get(tg.band);
      if (!tg.open && !existing) continue;
      const cur = existing?.out ?? 0;
      const rate = existing ? existing.rate : tg.ratePercent; // frozen at origination
      const adj = fundedNpcFlowDelta(cur, tg.target, {
        cashReserves: cash,
        requiredReserves: npcDeposits * r.rr,
        householdPool: ebm,
      });
      cash -= adj;
      const next = Math.max(0, cur + adj);
      const i = (next * rate) / 100 / TURNS_PER_YEAR;
      const d = (next * getCreditBand(tg.band).defaultRatePercent) / 100 / TURNS_PER_YEAR;
      interest += i;
      defaults += d;
      cash += i;
      tranches.set(tg.band, { out: Math.max(0, next - d), rate });
    }
    lastIncome = interest - depInt - prem - defaults;
    cumIncome += lastIncome;
  }
  const loans = [...tranches.values()].reduce((s, x) => s + x.out, 0);
  const equity = cash + loans - npcDeposits;
  return {
    equityEnd: Math.round(equity),
    annualRoePercent: +(((lastIncome * TURNS_PER_YEAR) / Math.max(1, equity)) * 100).toFixed(2),
    deposits: Math.round(npcDeposits),
    loans: Math.round(loans),
    loanToDeposit: +(loans / Math.max(1, npcDeposits)).toFixed(3),
    annualIncomeOnInitialEquityPct: +(((lastIncome * TURNS_PER_YEAR) / E0) * 100).toFixed(2),
    cumIncomePctOfE0: +((cumIncome / E0) * 100).toFixed(1),
  };
}

const base = { prime: 8.5, inflation: 4.2, rr: 0.2, turns: 480 };
for (const prime of [5.75, 8.5, 12])
  for (const profile of ["conservative", "balanced", "aggressive"] as LendingProfileId[])
    console.log(
      JSON.stringify({
        prime,
        profile,
        depositOffset: -1.75,
        lendingOffset: 4.125,
        ...simulate({ ...base, prime, depOff: -1.75, lendOff: 4.125, profile }),
      })
    );
