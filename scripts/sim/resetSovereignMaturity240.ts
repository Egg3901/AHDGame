/**
 * 240-turn opening sovereign-maturity sensitivity.
 *
 * This isolates rollover liquidity from the ordinary budget. It uses the
 * production opening-cohort planner and the production primary-pool maximum.
 * The observed institutional increment is the aggregate share measured by the
 * read-only 2026-10-02 live audit. The five-percent arm is explicitly a
 * provisional stress target, not an enacted balance constant.
 */
import { SOVEREIGN_RECONCILE_DISTRIBUTION } from "../../src/lib/bonds/sovereign";
import { SOVEREIGN_PRIMARY_COMMIT_SHARE } from "../../src/lib/bonds/primaryMarket";
import { planOpeningSovereignMaturityCohorts } from "../../src/lib/bonds/rules/openingMaturity";
import { planSovereignTranches } from "../../src/lib/bonds/sovereignIssueDiagnostics";
import { openingFiscalBooks1991 } from "../../src/lib/resetFinance/opening1991";
import type { BondMaturityTurns } from "../../src/lib/db/types/bond";

type Country = "US" | "UK" | "JP";
type Scenario =
  | "legacy_bullets_current_demand"
  | "staggered_current_demand"
  | "staggered_provisional_institutions"
  | "staggered_institutional_stress";

type Lot = { maturityTurn: number; maturityTurns: BondMaturityTurns; face: number };

const OBSERVED_LIVE_INSTITUTIONAL_SHARE = 0.00618;
const PROVISIONAL_INSTITUTIONAL_TARGET = 0.05;

function legacyLots(debt: number): Lot[] {
  return Object.entries(SOVEREIGN_RECONCILE_DISTRIBUTION).flatMap(([term, share]) =>
    share
      ? [
          {
            maturityTurn: Number(term),
            maturityTurns: Number(term) as BondMaturityTurns,
            face: debt * share,
          },
        ]
      : []
  );
}

function staggeredLots(debt: number): Lot[] {
  return planOpeningSovereignMaturityCohorts({
    totalFace: debt,
    faceValue: 1_000,
    distribution: SOVEREIGN_RECONCILE_DISTRIBUTION,
  }).map((cohort) => ({
    maturityTurn: cohort.maturityOffset,
    maturityTurns: cohort.maturityTurns,
    face: cohort.amount,
  }));
}

function rolloverFraction(scenario: Scenario, turn: number): number {
  const institutional =
    scenario === "staggered_provisional_institutions" ||
    scenario === "staggered_institutional_stress"
      ? PROVISIONAL_INSTITUTIONAL_TARGET
      : OBSERVED_LIVE_INSTITUTIONAL_SHARE;
  const stressed = scenario === "staggered_institutional_stress" && turn > 48 && turn <= 96;
  const pool = stressed ? 0.7 : SOVEREIGN_PRIMARY_COMMIT_SHARE;
  const institution = stressed ? institutional * 0.25 : institutional;
  return Math.min(1, pool + institution);
}

export interface SovereignMaturityRun {
  country: Country;
  scenario: Scenario;
  turns: 240;
  openingFace: number;
  totalMatured: number;
  totalRolled: number;
  totalCashGap: number;
  peakMaturity: number;
  peakCashGap: number;
  peakCashGapGdpShare: number;
  firstMaturityTurn: number | null;
  endingFace: number;
}

export function runSovereignMaturity240(
  country: Country,
  scenario: Scenario
): SovereignMaturityRun {
  const opening = openingFiscalBooks1991()[country];
  const lots = scenario.startsWith("legacy")
    ? legacyLots(opening.debt)
    : staggeredLots(opening.debt);
  let totalMatured = 0;
  let totalRolled = 0;
  let totalCashGap = 0;
  let peakMaturity = 0;
  let peakCashGap = 0;
  let firstMaturityTurn: number | null = null;

  for (let turn = 1; turn <= 240; turn += 1) {
    const due = lots.filter((lot) => lot.maturityTurn === turn);
    if (due.length === 0) continue;
    if (firstMaturityTurn === null) firstMaturityTurn = turn;
    const maturity = due.reduce((sum, lot) => sum + lot.face, 0);
    const fraction = rolloverFraction(scenario, turn);
    const rolled = Math.floor((maturity * fraction) / 1_000) * 1_000;
    const cashGap = maturity - rolled;
    totalMatured += maturity;
    totalRolled += rolled;
    totalCashGap += cashGap;
    peakMaturity = Math.max(peakMaturity, maturity);
    peakCashGap = Math.max(peakCashGap, cashGap);

    // Production combines the quarter's rollover need with any deficit issue,
    // then applies the sovereign's configured tenor profile to the new series.
    // This isolated harness has no deficit, but uses that same re-laddering
    // behavior rather than pretending each old security is exchanged in kind.
    for (const tranche of planSovereignTranches(SOVEREIGN_RECONCILE_DISTRIBUTION, rolled)) {
      lots.push({
        maturityTurn: turn + tranche.maturityTurns,
        maturityTurns: tranche.maturityTurns,
        face: tranche.amount,
      });
    }
  }

  const endingFace = lots
    .filter((lot) => lot.maturityTurn > 240)
    .reduce((sum, lot) => sum + lot.face, 0);
  return {
    country,
    scenario,
    turns: 240,
    openingFace: opening.debt,
    totalMatured,
    totalRolled,
    totalCashGap,
    peakMaturity,
    peakCashGap,
    peakCashGapGdpShare: peakCashGap / opening.gdp,
    firstMaturityTurn,
    endingFace,
  };
}

export function runSovereignMaturityMatrix(): SovereignMaturityRun[] {
  const countries: Country[] = ["US", "UK", "JP"];
  const scenarios: Scenario[] = [
    "legacy_bullets_current_demand",
    "staggered_current_demand",
    "staggered_provisional_institutions",
    "staggered_institutional_stress",
  ];
  return countries.flatMap((country) =>
    scenarios.map((scenario) => runSovereignMaturity240(country, scenario))
  );
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/resetSovereignMaturity240.ts")) {
  console.log(JSON.stringify(runSovereignMaturityMatrix(), null, 2));
}
