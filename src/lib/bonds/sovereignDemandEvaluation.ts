/**
 * Controlled evaluation harness for #1001: choose among issuance
 * consolidation, safe cross-border fund eligibility, and domestic fund
 * coverage WITHOUT enabling any mechanic.
 *
 * Pure rules module: plain data in, plain data out. No database, wall clock,
 * randomness, or environment reads, so the headless harness and worldsim
 * report evaluators can copy it. The caller loads evidence (trailing-12
 * vital-sign snapshots, active fund rows, country fill medians, terminal
 * reconciliation) from each sandbox world; this module aggregates the issue's
 * gates and emits a deterministic pass/fail report with first-failure
 * evidence. Absent evidence is reported as missing, never as a pass, and
 * never fabricated.
 *
 * Gate order follows the issue text: no-holder rate, fund backing plus the
 * 5% cash buffer, country goods-fill deltas, trial balance, money
 * attribution, then the two-sided equity-depth guardrails.
 */

export const SOVEREIGN_DEMAND_EVALUATION_WINDOW_TURNS = 12;

/** Terminal 12-turn sovereign no-holder rate must sit strictly below this. */
export const SOVEREIGN_NO_HOLDER_MAX_SHARE = 0.35;

/** Every active fund must keep at least this fraction of backing as cash. */
export const FUND_CASH_BUFFER_MIN_FRACTION = 0.05;

/** Every active fund must be fully backed (backing ratio at least this). */
export const FUND_BACKING_MIN_RATIO = 1;

/**
 * No country's goods-fill median may fall further than this below baseline.
 * Fill rates are 0-1 fractions, so 5 points is 0.05. The boundary passes.
 */
export const GOODS_FILL_MAX_DECLINE_POINTS = 0.05;

/** Stable scenario identities. Never rename: evidence files key on these. */
export type SovereignDemandScenarioId =
  | "baseline-1001"
  | "issuance-consolidation-1001"
  | "cross-border-eligibility-1001"
  | "domestic-fund-coverage-1001";

export interface SovereignDemandScenario {
  id: SovereignDemandScenarioId;
  /** Human label for the report header. */
  label: string;
  /** Which demand channel this candidate exercises. */
  demandChannel: "none" | "consolidation" | "cross-border" | "domestic-coverage";
  /**
   * Exact runWorld experiment fragment that reproduces the scenario, or null
   * when no gate exists yet. Baseline pins both existing gates to false so
   * the control is explicit rather than ambient.
   */
  runWorldArgs: string[] | null;
  /** True when the scenario can be queued on worldsim today. */
  queueable: boolean;
  /** Set exactly when queueable is false: why no run can be ordered yet. */
  blockedReason?: string;
}

export const SOVEREIGN_DEMAND_SCENARIOS: readonly SovereignDemandScenario[] = [
  {
    id: "baseline-1001",
    label: "Baseline (control: all gates off)",
    demandChannel: "none",
    runWorldArgs: [
      "--sovereign-issuance-consolidation=false",
      "--index-fund-bond-liquidity=false",
      "--domestic-sovereign-bond-coverage=false",
    ],
    queueable: true,
  },
  {
    id: "issuance-consolidation-1001",
    label: "Issuance consolidation (gated tranche merge)",
    demandChannel: "consolidation",
    runWorldArgs: [
      "--sovereign-issuance-consolidation=true",
      "--index-fund-bond-liquidity=false",
      "--domestic-sovereign-bond-coverage=false",
    ],
    queueable: true,
  },
  {
    id: "cross-border-eligibility-1001",
    label: "Safe cross-border fund eligibility (#968 facility)",
    demandChannel: "cross-border",
    runWorldArgs: [
      "--sovereign-issuance-consolidation=false",
      "--index-fund-bond-liquidity=true",
      "--domestic-sovereign-bond-coverage=false",
    ],
    queueable: true,
  },
  {
    id: "domestic-fund-coverage-1001",
    label: "Domestic fund coverage (gated home-sovereign funds)",
    demandChannel: "domestic-coverage",
    runWorldArgs: [
      "--sovereign-issuance-consolidation=false",
      "--index-fund-bond-liquidity=false",
      "--domestic-sovereign-bond-coverage=true",
    ],
    queueable: true,
  },
];

/**
 * Stress overlays applied AFTER a candidate passes the controlled
 * comparison, via existing sim infrastructure. Hooks only: they name real
 * commands, they run nothing here.
 */
export interface SovereignDemandStressHook {
  id: string;
  description: string;
  /** Command template; <scenarioDb> is the candidate's sandbox database. */
  command: string;
}

export const SOVEREIGN_DEMAND_STRESS_HOOKS: readonly SovereignDemandStressHook[] = [
  {
    id: "post-pass-stress",
    description:
      "Run the standing economic stress suite against the passing " +
      "candidate's sandbox world before any activation discussion.",
    command: "npx tsx scripts/sim/economicStressTests.ts --db=<scenarioDb>",
  },
  {
    id: "extended-soak",
    description:
      "Resume the passing candidate's world for a longer soak (runWorld " +
      "continues from the current turn on re-run) to confirm the terminal " +
      "window is stable, not a transient.",
    command:
      "SIM_MONGODB_URI=<sandbox> npx tsx scripts/sim/runWorld.ts " +
      "--seed=<seed> --preset=<preset> --turns=<longer> <scenario runWorldArgs>",
  },
];

export function stressCommandsFor(scenarioDb: string): string[] {
  return SOVEREIGN_DEMAND_STRESS_HOOKS.map((hook) =>
    hook.command.replaceAll("<scenarioDb>", scenarioDb)
  );
}

/** One active fund's backing posture at the terminal turn, in anchor. */
export interface SovereignDemandFundEvidence {
  fundId: string;
  status: string;
  backingRatio: number | null;
  cashAnchor: number | null;
  totalBackingAnchor: number | null;
}

/** Terminal reconciliation posture: counts only, lower is better. */
export interface SovereignDemandLedgerEvidence {
  trialBalanceUnbalancedCount: number | null;
  unattributedCount: number | null;
}

/**
 * Evidence exported from one sandbox world for one scenario. Every series is
 * oldest-to-newest over the terminal window (up to 12 turns); the module
 * takes medians, so short windows still evaluate with their observation
 * count on the record. Null entries are skipped, never zero-filled.
 */
export interface SovereignDemandEvidence {
  scenarioId: string;
  terminalTurn: number;
  sovereignNoHolderShareByTurn: ReadonlyArray<number | null>;
  twoSidedListingShareByTurn: ReadonlyArray<number | null>;
  depthToMarketCapByTurn: ReadonlyArray<number | null>;
  funds: readonly SovereignDemandFundEvidence[];
  /** Per-country terminal goods-fill medians (0-1 fractions). */
  countryGoodsFill: ReadonlyArray<{ countryId: string; fill: number | null }>;
  ledger: SovereignDemandLedgerEvidence | null;
}

export type SovereignDemandCheckId =
  | "no-holder-rate"
  | "fund-backing"
  | "goods-fill"
  | "trial-balance"
  | "money-attribution"
  | "equity-depth";

export interface SovereignDemandCheckResult {
  check: SovereignDemandCheckId;
  status: "pass" | "fail" | "missing";
  detail: string;
  /** The numbers that decided it (thresholds plus observed values). */
  evidence: Record<string, number | string | null>;
}

export interface SovereignDemandScenarioReport {
  scenarioId: SovereignDemandScenarioId;
  label: string;
  status: "pass" | "fail" | "missing";
  /** First failing (or missing) check in issue gate order; null on pass. */
  firstFailure: SovereignDemandCheckResult | null;
  checks: SovereignDemandCheckResult[];
  /** Scenarios with evidence but no run ordered yet cannot happen; kept for symmetry. */
  queueable: boolean;
}

function median(values: number[]): number | null {
  const finite = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  if (finite.length === 0) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function medianOfSeries(series: ReadonlyArray<number | null>): {
  median: number | null;
  observations: number;
} {
  const finite = series.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  return { median: median(finite), observations: finite.length };
}

function checkNoHolderRate(evidence: SovereignDemandEvidence): SovereignDemandCheckResult {
  const { median: rate, observations } = medianOfSeries(evidence.sovereignNoHolderShareByTurn);
  if (rate === null) {
    return {
      check: "no-holder-rate",
      status: "missing",
      detail: `No sovereign no-holder observations in the terminal window (turn ${evidence.terminalTurn}).`,
      evidence: { observations, threshold: SOVEREIGN_NO_HOLDER_MAX_SHARE, rate: null },
    };
  }
  if (rate < SOVEREIGN_NO_HOLDER_MAX_SHARE) {
    return {
      check: "no-holder-rate",
      status: "pass",
      detail: `Terminal ${SOVEREIGN_DEMAND_EVALUATION_WINDOW_TURNS}-turn median no-holder share ${(rate * 100).toFixed(2)}% is below 35% over ${observations} observations.`,
      evidence: { observations, threshold: SOVEREIGN_NO_HOLDER_MAX_SHARE, rate },
    };
  }
  return {
    check: "no-holder-rate",
    status: "fail",
    detail: `Terminal ${SOVEREIGN_DEMAND_EVALUATION_WINDOW_TURNS}-turn median no-holder share ${(rate * 100).toFixed(2)}% is at or above 35% over ${observations} observations.`,
    evidence: { observations, threshold: SOVEREIGN_NO_HOLDER_MAX_SHARE, rate },
  };
}

function checkFundBacking(evidence: SovereignDemandEvidence): SovereignDemandCheckResult {
  const active = evidence.funds.filter((fund) => fund.status === "active");
  if (active.length === 0) {
    return {
      check: "fund-backing",
      status: "missing",
      detail: "No active fund rows in evidence: backing and cash buffer cannot be judged.",
      evidence: {
        activeFunds: 0,
        backingMin: FUND_BACKING_MIN_RATIO,
        cashBufferMin: FUND_CASH_BUFFER_MIN_FRACTION,
      },
    };
  }
  const sorted = [...active].sort((a, b) => a.fundId.localeCompare(b.fundId));
  for (const fund of sorted) {
    if (
      fund.backingRatio === null ||
      fund.cashAnchor === null ||
      fund.totalBackingAnchor === null ||
      !Number.isFinite(fund.backingRatio) ||
      !Number.isFinite(fund.cashAnchor) ||
      !Number.isFinite(fund.totalBackingAnchor)
    ) {
      return {
        check: "fund-backing",
        status: "missing",
        detail: `Fund ${fund.fundId} is missing backing evidence (ratio, cash, or backing anchor).`,
        evidence: {
          activeFunds: active.length,
          fundId: fund.fundId,
          backingRatio: fund.backingRatio,
          cashAnchor: fund.cashAnchor,
          totalBackingAnchor: fund.totalBackingAnchor,
        },
      };
    }
    if (fund.backingRatio < FUND_BACKING_MIN_RATIO) {
      return {
        check: "fund-backing",
        status: "fail",
        detail: `Fund ${fund.fundId} is not fully backed (ratio ${fund.backingRatio.toFixed(4)} below 1).`,
        evidence: {
          activeFunds: active.length,
          fundId: fund.fundId,
          backingRatio: fund.backingRatio,
          backingMin: FUND_BACKING_MIN_RATIO,
        },
      };
    }
    const bufferFloor = FUND_CASH_BUFFER_MIN_FRACTION * Math.max(0, fund.totalBackingAnchor);
    if (fund.cashAnchor < bufferFloor) {
      return {
        check: "fund-backing",
        status: "fail",
        detail: `Fund ${fund.fundId} holds ${Math.round(fund.cashAnchor).toLocaleString()} anchor cash against a 5% floor of ${Math.round(bufferFloor).toLocaleString()} anchor.`,
        evidence: {
          activeFunds: active.length,
          fundId: fund.fundId,
          cashAnchor: fund.cashAnchor,
          bufferFloor,
          cashBufferMin: FUND_CASH_BUFFER_MIN_FRACTION,
        },
      };
    }
  }
  return {
    check: "fund-backing",
    status: "pass",
    detail: `All ${active.length} active funds fully backed with at least the 5% cash buffer.`,
    evidence: {
      activeFunds: active.length,
      backingMin: FUND_BACKING_MIN_RATIO,
      cashBufferMin: FUND_CASH_BUFFER_MIN_FRACTION,
    },
  };
}

function checkGoodsFill(
  baseline: SovereignDemandEvidence,
  candidate: SovereignDemandEvidence
): SovereignDemandCheckResult {
  const baseByCountry = new Map(baseline.countryGoodsFill.map((row) => [row.countryId, row.fill]));
  const candByCountry = new Map(candidate.countryGoodsFill.map((row) => [row.countryId, row.fill]));
  const countries = [...baseByCountry.keys()].sort();
  if (countries.length === 0) {
    return {
      check: "goods-fill",
      status: "missing",
      detail: "Baseline carries no per-country goods-fill medians.",
      evidence: { countries: 0, maxDeclinePoints: GOODS_FILL_MAX_DECLINE_POINTS },
    };
  }
  let worst: { countryId: string; delta: number } | null = null;
  for (const countryId of countries) {
    const base = baseByCountry.get(countryId);
    const current = candByCountry.get(countryId);
    if (
      typeof base !== "number" ||
      !Number.isFinite(base) ||
      typeof current !== "number" ||
      !Number.isFinite(current)
    ) {
      return {
        check: "goods-fill",
        status: "missing",
        detail: `Country ${countryId} is missing a goods-fill median on one side of the comparison.`,
        evidence: { countryId, baseline: base ?? null, candidate: current ?? null },
      };
    }
    const delta = current - base;
    if (worst === null || delta < worst.delta) worst = { countryId, delta };
  }
  if (worst !== null && worst.delta < -GOODS_FILL_MAX_DECLINE_POINTS) {
    return {
      check: "goods-fill",
      status: "fail",
      detail: `Country ${worst.countryId} goods-fill fell ${(worst.delta * 100).toFixed(2)} points vs baseline, beyond the 5-point guardrail.`,
      evidence: {
        countryId: worst.countryId,
        delta: worst.delta,
        maxDeclinePoints: -GOODS_FILL_MAX_DECLINE_POINTS,
      },
    };
  }
  return {
    check: "goods-fill",
    status: "pass",
    detail:
      worst === null
        ? "No comparable countries; nothing declined."
        : `Worst country delta is ${(worst.delta * 100).toFixed(2)} points (${worst.countryId}) across ${countries.length} countries, inside the 5-point guardrail.`,
    evidence: {
      countries: countries.length,
      worstDelta: worst?.delta ?? null,
      worstCountry: worst?.countryId ?? null,
      maxDeclinePoints: -GOODS_FILL_MAX_DECLINE_POINTS,
    },
  };
}

function checkLedgerCount(
  check: SovereignDemandCheckId,
  label: string,
  baselineValue: number | null,
  candidateValue: number | null
): SovereignDemandCheckResult {
  if (
    typeof baselineValue !== "number" ||
    !Number.isFinite(baselineValue) ||
    typeof candidateValue !== "number" ||
    !Number.isFinite(candidateValue)
  ) {
    return {
      check,
      status: "missing",
      detail: `${label} is missing terminal reconciliation evidence on one side of the comparison.`,
      evidence: { baseline: baselineValue, candidate: candidateValue },
    };
  }
  if (candidateValue <= baselineValue) {
    return {
      check,
      status: "pass",
      detail: `${label}: candidate ${candidateValue} vs baseline ${baselineValue}, no regression.`,
      evidence: { baseline: baselineValue, candidate: candidateValue },
    };
  }
  return {
    check,
    status: "fail",
    detail: `${label}: candidate ${candidateValue} regressed past baseline ${baselineValue}.`,
    evidence: { baseline: baselineValue, candidate: candidateValue },
  };
}

function checkEquityDepth(
  baseline: SovereignDemandEvidence,
  candidate: SovereignDemandEvidence
): SovereignDemandCheckResult {
  const baseTwoSided = medianOfSeries(baseline.twoSidedListingShareByTurn);
  const candTwoSided = medianOfSeries(candidate.twoSidedListingShareByTurn);
  const baseDepth = medianOfSeries(baseline.depthToMarketCapByTurn);
  const candDepth = medianOfSeries(candidate.depthToMarketCapByTurn);
  if (
    baseTwoSided.median === null ||
    candTwoSided.median === null ||
    baseDepth.median === null ||
    candDepth.median === null
  ) {
    return {
      check: "equity-depth",
      status: "missing",
      detail:
        "Two-sided share or depth-to-mcap is missing terminal observations on one side of the comparison.",
      evidence: {
        baselineTwoSided: baseTwoSided.median,
        candidateTwoSided: candTwoSided.median,
        baselineDepth: baseDepth.median,
        candidateDepth: candDepth.median,
      },
    };
  }
  if (candTwoSided.median < baseTwoSided.median) {
    return {
      check: "equity-depth",
      status: "fail",
      detail: `Two-sided listing share regressed: candidate ${(candTwoSided.median * 100).toFixed(2)}% vs baseline ${(baseTwoSided.median * 100).toFixed(2)}%.`,
      evidence: {
        baselineTwoSided: baseTwoSided.median,
        candidateTwoSided: candTwoSided.median,
        baselineDepth: baseDepth.median,
        candidateDepth: candDepth.median,
      },
    };
  }
  if (candDepth.median < baseDepth.median) {
    return {
      check: "equity-depth",
      status: "fail",
      detail: `Depth-to-mcap regressed: candidate ${candDepth.median.toFixed(4)} vs baseline ${baseDepth.median.toFixed(4)}.`,
      evidence: {
        baselineTwoSided: baseTwoSided.median,
        candidateTwoSided: candTwoSided.median,
        baselineDepth: baseDepth.median,
        candidateDepth: candDepth.median,
      },
    };
  }
  return {
    check: "equity-depth",
    status: "pass",
    detail: `Two-sided share ${(candTwoSided.median * 100).toFixed(2)}% and depth-to-mcap ${candDepth.median.toFixed(4)} hold at or above baseline.`,
    evidence: {
      baselineTwoSided: baseTwoSided.median,
      candidateTwoSided: candTwoSided.median,
      baselineDepth: baseDepth.median,
      candidateDepth: candDepth.median,
    },
  };
}

/**
 * Evaluate one scenario against the issue gates. Relational checks
 * (goods-fill, trial balance, money attribution, equity depth) compare
 * against baseline evidence; absolute checks (no-holder rate, fund backing)
 * judge the candidate alone. A null or identity-mismatched evidence bundle
 * yields missing, never a pass.
 */
export function evaluateSovereignDemandScenario(
  scenario: SovereignDemandScenario,
  baseline: SovereignDemandEvidence | null,
  evidence: SovereignDemandEvidence | null
): SovereignDemandScenarioReport {
  const missing = (
    detail: string,
    evidenceRecord: Record<string, number | string | null> = {}
  ): SovereignDemandScenarioReport => {
    const check: SovereignDemandCheckResult = {
      check: "no-holder-rate",
      status: "missing",
      detail,
      evidence: evidenceRecord,
    };
    return {
      scenarioId: scenario.id,
      label: scenario.label,
      status: "missing",
      firstFailure: check,
      checks: [check],
      queueable: scenario.queueable,
    };
  };
  if (evidence === null) {
    return missing(
      scenario.queueable
        ? `No evidence collected yet for ${scenario.id}: queue the scenario on worldsim first.`
        : (scenario.blockedReason ?? `No evidence can exist yet for ${scenario.id}.`)
    );
  }
  if (evidence.scenarioId !== scenario.id) {
    return missing(
      `Evidence identity mismatch: bundle claims ${evidence.scenarioId} but was evaluated as ${scenario.id}. Refusing to judge another scenario's run.`,
      { evidenceScenarioId: evidence.scenarioId, expectedScenarioId: scenario.id }
    );
  }
  if (baseline === null) {
    return missing(
      "Baseline evidence is missing: relational checks have nothing to compare against."
    );
  }

  const checks: SovereignDemandCheckResult[] = [
    checkNoHolderRate(evidence),
    checkFundBacking(evidence),
    checkGoodsFill(baseline, evidence),
    checkLedgerCount(
      "trial-balance",
      "Trial balance unbalanced count",
      baseline.ledger?.trialBalanceUnbalancedCount ?? null,
      evidence.ledger?.trialBalanceUnbalancedCount ?? null
    ),
    checkLedgerCount(
      "money-attribution",
      "Money attribution unattributed count",
      baseline.ledger?.unattributedCount ?? null,
      evidence.ledger?.unattributedCount ?? null
    ),
    checkEquityDepth(baseline, evidence),
  ];
  const firstFailure = checks.find((check) => check.status !== "pass") ?? null;
  return {
    scenarioId: scenario.id,
    label: scenario.label,
    status: firstFailure === null ? "pass" : firstFailure.status === "fail" ? "fail" : "missing",
    firstFailure,
    checks,
    queueable: scenario.queueable,
  };
}

export interface SovereignDemandMatrixReport {
  generatedBy: string;
  baselineScenarioId: SovereignDemandScenarioId;
  scenarios: SovereignDemandScenarioReport[];
  /** Scenario ids with no evidence, in matrix order. */
  missingEvidence: SovereignDemandScenarioId[];
  /**
   * Exact order commands for worldsim: one entry per scenario, runnable ones
   * carrying the runWorld fragment, blocked ones carrying the reason.
   */
  queue: Array<{
    scenarioId: SovereignDemandScenarioId;
    queueable: boolean;
    runWorldArgs: string[] | null;
    blockedReason?: string;
  }>;
}

/**
 * Evaluate the whole matrix. Baseline evidence doubles as the baseline's own
 * candidate evidence (its relational checks compare against itself and pass
 * trivially); every other scenario is judged from its own bundle or marked
 * missing when no bundle was supplied.
 */
export function evaluateSovereignDemandMatrix(
  baseline: SovereignDemandEvidence | null,
  byScenario: Partial<Record<SovereignDemandScenarioId, SovereignDemandEvidence | null>>
): SovereignDemandMatrixReport {
  const scenarios = SOVEREIGN_DEMAND_SCENARIOS.map((scenario) => {
    const evidence = scenario.id === "baseline-1001" ? baseline : (byScenario[scenario.id] ?? null);
    return evaluateSovereignDemandScenario(scenario, baseline, evidence);
  });
  return {
    generatedBy: "sovereignDemandEvaluation (#1001): controlled comparison, no mechanic enabled",
    baselineScenarioId: "baseline-1001",
    scenarios,
    missingEvidence: scenarios
      .filter((report) => report.status === "missing")
      .map((report) => report.scenarioId),
    queue: SOVEREIGN_DEMAND_SCENARIOS.map((scenario) => ({
      scenarioId: scenario.id,
      queueable: scenario.queueable,
      runWorldArgs: scenario.runWorldArgs,
      ...(scenario.blockedReason ? { blockedReason: scenario.blockedReason } : {}),
    })),
  };
}
