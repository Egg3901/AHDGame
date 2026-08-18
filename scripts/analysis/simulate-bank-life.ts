/**
 * Step ONE freshly chartered bank forward and print what happens to it.
 *
 * Written because reasoning about the banking constants produced a number I had
 * to retract. This drives the engine's OWN pure functions rather than
 * reimplementing their arithmetic, so if the simulated bank dies, it dies for
 * the reason the live bank would.
 *
 * What is reproduced faithfully (real engine functions):
 *   - effective deposit/lending rates from prime and the charter offsets
 *   - NPC deposit share of externalBroadMoney from the rate premium
 *   - the 2.5%/turn flow cap on deposit migration and loan-book ramp
 *   - loan-book volume and expected default rate from the lending rate
 *   - deposit interest, insurance premium, confidence, capital adequacy
 *   - the run-failure trigger and the supervisory recap clock
 *
 * What is approximated, and why it does not change the verdict:
 *   - no player depositors or named loans; this is the NPC path only, which is
 *     what a new bank actually gets
 *   - `externalBroadMoney` is held constant rather than drained by other banks,
 *     which is GENEROUS to the bank under test
 *   - the deposit ceiling is passed in rather than derived from sector capacity
 *
 * Read-only. Touches no database.
 */

import { CONFIDENCE_BAND_AMBER_MIN, computeConfidence } from "../../src/lib/banking/confidence";
import { computeNpcDepositShare } from "../../src/lib/banking/deposits";
import { computeNpcLoanBook } from "../../src/lib/banking/lending";
import {
  computeInsurancePremium,
  computeReserveRatioActual,
} from "../../src/lib/banking/insurance";
import { effectiveBankRatesFromPrime } from "../../src/lib/banking/rates";
import { assessCapital, RECAP_GRACE_TURNS } from "../../src/lib/banking/capitalAdequacy";
import { getEraUnitScale } from "../../src/lib/constants/sectorSeedEra";
import { getGdpAnchorRate } from "../../src/lib/currency/gdpAnchorRate";
import { CORPORATION_FOUNDING_COST } from "../../src/lib/constants/corporations";
import {
  CHARTER_CAPITAL_FOUNDING_MULTIPLE,
  INVESTMENT_CHARTER_CAPITAL_FRACTION,
} from "../../src/lib/banking/charter";
import { RESERVE_REQUIREMENT_HISTORICAL_DEFAULT } from "../../src/lib/banking/reserveBounds";
import { TURNS_PER_YEAR } from "../../src/lib/constants/turnTime";
import type { BankCharter } from "../../src/lib/db/types/bank";

// Mirrors bankingTurn's module-private helpers exactly.
const MAX_NPC_FLOW_PER_TURN_FRACTION = 0.025;
const RUN_FAILURE_COVER_FRACTION = 0.5;
const FLIGHT_RATE_BY_BAND = { amber: 0.1, red: 0.3 } as const;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
function npcFlowDelta(current: number, target: number): number {
  const cur = Math.max(0, current);
  return clamp(
    target - cur,
    -MAX_NPC_FLOW_PER_TURN_FRACTION * cur,
    MAX_NPC_FLOW_PER_TURN_FRACTION * Math.max(target, cur)
  );
}
function perTurnInterest(balance: number, annualPercent: number): number {
  if (!(balance > 0) || !(annualPercent > 0)) return 0;
  return (balance * (annualPercent / 100)) / TURNS_PER_YEAR;
}

const PRESET = "1953-default";
const COUNTRY = "US";
const PRIME = 4.4666; // live US prime at turn 89
const CB_SAVINGS_APY = 2.0; // CB savings APY the NPC share compares against
const RESERVE_RATIO = RESERVE_REQUIREMENT_HISTORICAL_DEFAULT;
const EXTERNAL_BROAD_MONEY = 4_000_000_000; // US pool, held constant (generous)

function charterRequirement(): number {
  const scale = getEraUnitScale(PRESET);
  const rate = getGdpAnchorRate(COUNTRY, PRESET);
  return Math.max(
    1,
    Math.round((CORPORATION_FOUNDING_COST * CHARTER_CAPITAL_FOUNDING_MULTIPLE) / scale / rate)
  );
}

type Result = {
  turn: number;
  deposits: number;
  cash: number;
  loans: number;
  confidence: number;
  band: string;
  capitalRatio: number;
  standing: string;
  event: string;
};

function simulateRetail(opts: {
  depositOffset: number;
  lendingOffset: number;
  startingCash: number;
  depositCeiling: number;
  turns: number;
}): Result[] {
  const rates = effectiveBankRatesFromPrime(
    { depositOffset: opts.depositOffset, lendingOffset: opts.lendingOffset } as BankCharter,
    PRIME
  );
  const share =
    computeNpcDepositShare(
      [{ bankId: "sim", effectiveDepositRatePercent: rates.depositRatePercent }],
      CB_SAVINGS_APY
    )[0]?.share ?? 0;

  let cash = opts.startingCash;
  const posted = opts.startingCash;
  let deposits = 0;
  let loans = 0;
  let band: "green" | "amber" | "red" = "green";
  let priorBand: "green" | "amber" | "red" = "green";
  let undercapSince: number | undefined;
  const out: Result[] = [];

  for (let turn = 1; turn <= opts.turns; turn++) {
    let event = "";

    // (b) NPC deposit flow toward share x pool, capped by the ceiling.
    // The money moves: deposits carry their cash into the bank.
    const target = Math.min(share * EXTERNAL_BROAD_MONEY, opts.depositCeiling);
    const inflow = npcFlowDelta(deposits, target);
    deposits = Math.max(0, deposits + inflow);
    cash = Math.max(0, cash + inflow);

    // (c) deposit interest, paid from cash, credited to depositors
    // NPC interest is credited to an account still held AT this bank: the
    // liability grows, the cash stays.
    const interestDue = perTurnInterest(deposits, rates.depositRatePercent);
    deposits += interestDue;

    // (c2) deposit insurance premium
    const actualRatio = computeReserveRatioActual(cash, deposits);
    const premiumDue = computeInsurancePremium(deposits, actualRatio, RESERVE_RATIO);
    const premiumPaid = Math.min(premiumDue, Math.max(0, cash));
    cash -= premiumPaid;

    // (e) NPC household book. Origination hands over cash and may only spend
    // above the reserve requirement.
    const capacity = deposits * (1 - RESERVE_RATIO);
    const book = computeNpcLoanBook(capacity, rates.lendingRatePercent);
    let adjust = npcFlowDelta(loans, book.volume);
    if (adjust > 0) adjust = Math.min(adjust, Math.max(0, cash - deposits * RESERVE_RATIO));
    cash -= adjust;
    loans = Math.max(0, loans + adjust);
    const loanInterest = perTurnInterest(loans, rates.lendingRatePercent);
    cash += loanInterest; // real cash from the unmodeled NPC economy
    const defaults = (loans * (book.expectedDefaultRatePercent / 100)) / TURNS_PER_YEAR;
    loans = Math.max(0, loans - defaults);

    // ── solvency pass ──
    priorBand = band;
    if (priorBand === "amber" || priorBand === "red") {
      const fled = Math.min(deposits * FLIGHT_RATE_BY_BAND[priorBand], Math.max(0, cash));
      deposits = Math.max(0, deposits - fled);
      cash = Math.max(0, cash - fled);
      if (fled > 0) event += `flight(${priorBand}) `;
    }

    const conf = computeConfidence({
      cashReserves: cash,
      postedCapital: posted,
      cashBackedDeposits: deposits,
      totalLoans: loans,
      reserveRatioRequired: RESERVE_RATIO,
      arrearsOutstanding: 0,
      defaultsLastTurn: defaults,
      panicTurns: 0,
    });
    band = conf.band;

    const capital = assessCapital({
      cashReserves: cash,
      totalLoans: loans,
      borrowings: {},
    });
    if (capital.standing === "undercapitalized") {
      undercapSince ??= turn;
      if (turn - undercapSince >= RECAP_GRACE_TURNS) event += "CHARTER-REVOKED(recap) ";
    } else {
      undercapSince = undefined;
    }

    const failed =
      priorBand === "red" && cash < RUN_FAILURE_COVER_FRACTION * (RESERVE_RATIO * deposits);
    if (failed) event += "BANK-FAILED(run) ";

    out.push({
      turn,
      deposits,
      cash,
      loans,
      confidence: conf.confidence,
      band,
      capitalRatio: capital.capitalRatio,
      standing: capital.standing,
      event: event.trim(),
    });
    if (failed || event.includes("REVOKED")) break;
  }
  return out;
}

function money(n: number): string {
  return Math.round(n).toLocaleString().padStart(15);
}

function report(title: string, rows: Result[]) {
  console.log(`\n=== ${title} ===`);
  console.log(
    "turn" +
      "deposits".padStart(16) +
      "cash".padStart(16) +
      "loans".padStart(16) +
      "conf".padStart(7) +
      "band".padStart(7) +
      "  standing/event"
  );
  for (const r of rows) {
    console.log(
      String(r.turn).padStart(4) +
        money(r.deposits) +
        money(r.cash) +
        money(r.loans) +
        r.confidence.toFixed(3).padStart(7) +
        r.band.padStart(7) +
        "  " +
        r.standing +
        (r.event ? "  << " + r.event : "")
    );
  }
  const last = rows[rows.length - 1];
  console.log(
    last.event.includes("FAILED") || last.event.includes("REVOKED")
      ? `RESULT: dead on turn ${last.turn}`
      : `RESULT: alive after ${last.turn} turns (conf ${last.confidence.toFixed(3)}, band ${last.band})`
  );
}

const req = charterRequirement();
console.log("=== 1953 US entry costs ===");
console.log(`era unit scale                 ${getEraUnitScale(PRESET)}`);
console.log(`gdp anchor rate (US)           ${getGdpAnchorRate(COUNTRY, PRESET)}`);
console.log(`bank charter capital required  ${req.toLocaleString()} USD`);
console.log(`typical new character cash     ~10,800 to ~78,800 USD (live, turn 62-94)`);
console.log(`=> charter costs ~${(req / 45000).toFixed(1)}x a typical starting balance`);
console.log(
  `investment charter requirement ${Math.round(req * INVESTMENT_CHARTER_CAPITAL_FRACTION).toLocaleString()} USD`
);
console.log(`amber confidence threshold     ${CONFIDENCE_BAND_AMBER_MIN}`);

// A player bank: posts the minimum, has a modest branch network.
report(
  "RETAIL, default rates (deposit -1.5, lending +0.5), ceiling 50M",
  simulateRetail({
    depositOffset: -1.5,
    lendingOffset: 0.5,
    startingCash: req,
    depositCeiling: 50_000_000,
    turns: 60,
  })
);

// Deliberately unattractive: the cheapest deposits the corridor allows.
report(
  "RETAIL, minimum deposit rate (deposit -4.0, lending +6.0), ceiling 50M",
  simulateRetail({
    depositOffset: -4.0,
    lendingOffset: 6.0,
    startingCash: req,
    depositCeiling: 50_000_000,
    turns: 60,
  })
);

// Small branch network: the smallest deposit base the CEO can choose.
report(
  "RETAIL, minimum rates, small ceiling 2M",
  simulateRetail({
    depositOffset: -4.0,
    lendingOffset: 6.0,
    startingCash: req,
    depositCeiling: 2_000_000,
    turns: 60,
  })
);

// What capital would actually be needed to survive the default configuration?
for (const mult of [1, 5, 10, 25, 50]) {
  const rows = simulateRetail({
    depositOffset: -1.5,
    lendingOffset: 0.5,
    startingCash: req * mult,
    depositCeiling: 50_000_000,
    turns: 60,
  });
  const last = rows[rows.length - 1];
  const dead = last.event.includes("FAILED") || last.event.includes("REVOKED");
  console.log(
    `capital ${String(mult).padStart(2)}x req (${money(req * mult).trim()}): ` +
      (dead ? `dead turn ${last.turn}` : `survives 60 turns, conf ${last.confidence.toFixed(3)}`)
  );
}
