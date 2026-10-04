/**
 * Aged-world turn benchmark gate (#2696).
 *
 * `scripts/perf/aged-benchmark.ts` restores an aged world snapshot, runs real
 * turns and writes a result file. This module turns those turn logs into a
 * per-case result and compares a candidate result against a baseline, so a
 * turn performance change can be qualified with one command:
 *
 *   quiet, NPP-action, fund-rebalance and election-deadline turns are kept
 *   apart, because a faster quiet turn can hide a slower boundary turn;
 *   results are only comparable when the snapshot, RNG seed and feature
 *   posture match;
 *   a case regresses when its median wall time or round trips grow past the
 *   tolerance, and a phase regresses when its round trips do.
 *
 * Pure: plain data in, plain data out. Wall time on a shared host is noisy,
 * so round trips are the primary signal and wall time has the wider default
 * tolerance.
 */
import { attributeTurn, cadenceTier, type CadenceTier, type TurnLogLike } from "./turnAttribution";

export type BenchmarkCase = CadenceTier | "electionDeadline";
export const BENCHMARK_CASES: readonly BenchmarkCase[] = [
  "quiet",
  "nppAction",
  "fundRebalance",
  "electionDeadline",
];

/**
 * Case for one measured turn. An election deadline outranks the fixed
 * cadences: resolution work is the boundary cost that a quiet-turn median
 * would otherwise hide.
 */
export function benchmarkCaseFor(
  turn: number,
  electionDeadlineTurns: ReadonlySet<number>
): BenchmarkCase {
  return electionDeadlineTurns.has(turn) ? "electionDeadline" : cadenceTier(turn);
}

/** What must match for two results to be comparable. */
export type BenchmarkIdentity = {
  /** Snapshot file name (not a path) and the database restored from it. */
  snapshot: string;
  sourceDb: string;
  startTurn: number;
  warmupTurns: number;
  rngSeed: string;
  /** Stable hash of the restored world's feature posture (gameConfig and gameState flags). */
  featurePosture: string;
};

export type BenchmarkCaseResult = {
  turns: number[];
  medianWallMs: number;
  medianRoundTrips: number;
  /** Median per-phase round trips across this case's turns. */
  phaseRoundTrips: Record<string, number>;
  /** Median interval-attributed wall time per phase (never a raw phase sum). */
  phaseMs: Record<string, number>;
};

export type BenchmarkResult = {
  identity: BenchmarkIdentity;
  /** Source revision the turns ran on. Informational: it is what differs between sides. */
  sourceRevision: string;
  cases: Partial<Record<BenchmarkCase, BenchmarkCaseResult>>;
};

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function medianByKey(rows: Array<Record<string, number>>): Record<string, number> {
  const keys = new Set(rows.flatMap((row) => Object.keys(row)));
  return Object.fromEntries(
    [...keys].sort().map((key) => [key, median(rows.map((row) => row[key] ?? 0))])
  );
}

/** Group measured turn logs into per-case results. */
export function buildBenchmarkResult(args: {
  identity: BenchmarkIdentity;
  sourceRevision: string;
  logs: TurnLogLike[];
  electionDeadlineTurns: ReadonlySet<number>;
}): BenchmarkResult {
  const rows = args.logs.map(attributeTurn);
  const cases: BenchmarkResult["cases"] = {};
  for (const name of BENCHMARK_CASES) {
    const inCase = rows.filter(
      (row) => benchmarkCaseFor(row.turn, args.electionDeadlineTurns) === name
    );
    if (inCase.length === 0) continue;
    cases[name] = {
      turns: inCase.map((row) => row.turn),
      medianWallMs: median(inCase.map((row) => row.wallMs)),
      medianRoundTrips: median(inCase.map((row) => row.roundTrips)),
      phaseRoundTrips: medianByKey(inCase.map((row) => row.phaseRoundTrips)),
      phaseMs: medianByKey(inCase.map((row) => row.phaseMs)),
    };
  }
  return { identity: args.identity, sourceRevision: args.sourceRevision, cases };
}

export type BenchmarkTolerance = {
  /** Allowed relative growth in a case's median wall time. */
  wall: number;
  /** Allowed relative growth in a case's median round trips. */
  roundTrips: number;
  /** Allowed relative growth in one phase's round trips. */
  phaseRoundTrips: number;
  /** Phases below this many baseline round trips are not gated individually. */
  phaseMinRoundTrips: number;
};

export const DEFAULT_BENCHMARK_TOLERANCE: BenchmarkTolerance = {
  wall: 0.1,
  roundTrips: 0.05,
  phaseRoundTrips: 0.1,
  phaseMinRoundTrips: 200,
};

export type BenchmarkVerdict = {
  ok: boolean;
  /** Identity fields that differ: the two results are not comparable. */
  mismatches: string[];
  /** Cases the baseline measured that the candidate did not. */
  missingCases: BenchmarkCase[];
  regressions: string[];
  improvements: string[];
};

const pct = (from: number, to: number) =>
  from > 0 ? `${(((to - from) / from) * 100).toFixed(1)}%` : "n/a";

/**
 * Compare a candidate against a baseline. Fails on any identity mismatch, any
 * baseline case the candidate did not measure, or any regression past the
 * tolerance.
 */
export function compareBenchmarks(
  baseline: BenchmarkResult,
  candidate: BenchmarkResult,
  tolerance: BenchmarkTolerance = DEFAULT_BENCHMARK_TOLERANCE
): BenchmarkVerdict {
  const mismatches = (Object.keys(baseline.identity) as Array<keyof BenchmarkIdentity>)
    .filter((key) => baseline.identity[key] !== candidate.identity[key])
    .map((key) => `${key}: ${baseline.identity[key]} vs ${candidate.identity[key]}`);
  const missingCases: BenchmarkCase[] = [];
  const regressions: string[] = [];
  const improvements: string[] = [];

  for (const name of BENCHMARK_CASES) {
    const before = baseline.cases[name];
    if (!before) continue;
    const after = candidate.cases[name];
    if (!after) {
      missingCases.push(name);
      continue;
    }
    const checks: Array<[string, number, number, number]> = [
      ["wall ms", before.medianWallMs, after.medianWallMs, tolerance.wall],
      ["round trips", before.medianRoundTrips, after.medianRoundTrips, tolerance.roundTrips],
    ];
    for (const [phase, rt] of Object.entries(before.phaseRoundTrips)) {
      if (rt < tolerance.phaseMinRoundTrips) continue;
      checks.push([
        `${phase} round trips`,
        rt,
        after.phaseRoundTrips[phase] ?? 0,
        tolerance.phaseRoundTrips,
      ]);
    }
    for (const [label, from, to, allowed] of checks) {
      const line = `${name} ${label}: ${Math.round(from)} -> ${Math.round(to)} (${pct(from, to)})`;
      if (to > from * (1 + allowed)) regressions.push(line);
      else if (to < from) improvements.push(line);
    }
  }

  return {
    ok: mismatches.length === 0 && missingCases.length === 0 && regressions.length === 0,
    mismatches,
    missingCases,
    regressions,
    improvements,
  };
}

/**
 * Stable digest input for a world's feature posture: every boolean and string
 * flag on the config and state singletons, sorted by key. Counters, clocks and
 * ids are excluded so two restores of the same snapshot always agree.
 */
export function featurePostureEntries(
  ...docs: Array<Record<string, unknown> | null | undefined>
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  docs.forEach((doc, index) => {
    for (const [key, value] of Object.entries(doc ?? {})) {
      if (key === "_id") continue;
      if (typeof value === "boolean" || (typeof value === "string" && /(Mode|Level)$/.test(key)))
        out.push([`${index}.${key}`, String(value)]);
    }
  });
  return out.sort(([a], [b]) => a.localeCompare(b));
}
