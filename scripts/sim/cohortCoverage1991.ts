/**
 * Report model for the #3369 1991 cohort coverage qualification.
 *
 * Pure helpers: snapshot region populations and age bands from a world, check
 * them against fixed jump limits, record source provenance, and render the
 * public report. The Mongo run that feeds them lives in
 * cohortCoverage1991.mongo.test.ts. No engine logic is duplicated here; the
 * seed and turn numbers come from the real bootstrap and demographic phase.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const BANDS = [
  ["0-17", 0, 17],
  ["18-29", 18, 29],
  ["30-44", 30, 44],
  ["45-64", 45, 64],
  ["65+", 65, 100],
] as const;
export type BandName = (typeof BANDS)[number][0];
export type Bands = Record<BandName, number>;

/** Fixed before the run; never tuned to the observed numbers. */
export const LIMITS = {
  /** Seed: 202 cells each rounded to whole people. */
  seedRoundingPeople: 101,
  /** Turn: the phase writes the cohort total back over states.population. */
  writeBackPeople: 0.500001,
  /** Seeded adult bands must carry the resolved source shares. */
  adultShareTolerancePp: 0.05,
  /** One weekly turn. The stale CEN stock produced a 31.6% first-turn jump. */
  maxTurnStepPct: 0.5,
  maxCumulativeDriftPct: 1,
  maxBandShiftPp: 1,
} as const;

export interface Ages {
  male: number[];
  female: number[];
}

export function people(ages: Ages): number {
  let sum = 0;
  for (const value of ages.male) sum += value;
  for (const value of ages.female) sum += value;
  return sum;
}

/** Share of the whole population in each band, in percent. */
export function bandShares(ages: Ages): Bands {
  const total = people(ages);
  const out = {} as Bands;
  for (const [name, lo, hi] of BANDS) {
    let band = 0;
    for (let age = lo; age <= hi; age++) band += (ages.male[age] ?? 0) + (ages.female[age] ?? 0);
    out[name] = total > 0 ? (band * 100) / total : 0;
  }
  return out;
}

/** Share of adults (18+) in each adult band, in percent: the seeded input shape. */
export function adultShares(bands: Bands) {
  const adults = bands["18-29"] + bands["30-44"] + bands["45-64"] + bands["65+"];
  return {
    young: (bands["18-29"] * 100) / adults,
    mid: (bands["30-44"] * 100) / adults,
    mature: (bands["45-64"] * 100) / adults,
    senior: (bands["65+"] * 100) / adults,
  };
}

export interface WorldSnapshot {
  /** Real populated regions only, keyed by region id. */
  regions: Map<string, { countryId: string; statePopulation: number; stock: Ages | null }>;
  /** Stock ids with no populated region behind them (stale or retired). */
  orphanStocks: string[];
}

export interface RegionRow {
  id: string;
  countryId: string;
  /** "census", "FR/ES profile", or the #3369 dated source key. */
  source: string;
  affected: boolean;
  seedPopulation: number;
  seedPeople: number;
  turnPopulation: number[];
  maxStepPct: number;
  driftPct: number;
  seedBands: Bands;
  finalBands: Bands;
  maxBandShiftPp: number;
  maxAdultShareErrorPp: number;
}

const round = (value: number, digits = 4) => Number(value.toFixed(digits));

/**
 * Build per-region rows from the seed snapshot and each turn's snapshot, and
 * list every limit breach. `expectedAdult` is the resolver seedCohortVectors
 * itself uses; it returns null for a region the seed has no shape for.
 */
export function evaluateScenario(input: {
  seed: WorldSnapshot;
  turns: WorldSnapshot[];
  sourceOf: (countryId: string, id: string) => { source: string; affected: boolean };
  expectedAdult: (
    countryId: string,
    id: string
  ) => { young: number; mid: number; mature: number; senior: number } | null;
}): { rows: RegionRow[]; failures: string[] } {
  const failures: string[] = [];
  const rows: RegionRow[] = [];
  for (const snap of [input.seed, ...input.turns]) {
    if (snap.orphanStocks.length > 0)
      failures.push(`orphan stocks survive: ${snap.orphanStocks.join(", ")}`);
  }
  for (const [id, seed] of [...input.seed.regions].sort(([a], [b]) => a.localeCompare(b))) {
    const { source, affected } = input.sourceOf(seed.countryId, id);
    if (!seed.stock) {
      failures.push(`${id}: populated region has no seeded stock`);
      continue;
    }
    const seedPeople = people(seed.stock);
    if (Math.abs(seedPeople - seed.statePopulation) > LIMITS.seedRoundingPeople)
      failures.push(`${id}: seeded stock ${seedPeople} vs population ${seed.statePopulation}`);
    const seedBands = bandShares(seed.stock);
    const expected = input.expectedAdult(seed.countryId, id);
    let maxAdultShareErrorPp = Number.NaN;
    if (!expected) failures.push(`${id}: no resolved age source`);
    else {
      const sum = expected.young + expected.mid + expected.mature + expected.senior;
      const got = adultShares(seedBands);
      maxAdultShareErrorPp = Math.max(
        ...(["young", "mid", "mature", "senior"] as const).map((key) =>
          Math.abs(got[key] - (expected[key] * 100) / sum)
        )
      );
      if (maxAdultShareErrorPp > LIMITS.adultShareTolerancePp)
        failures.push(`${id}: seeded adult shares miss the source by ${maxAdultShareErrorPp}pp`);
    }

    const turnPopulation: number[] = [];
    let previous = seed.statePopulation;
    let maxStepPct = 0;
    let finalStock: Ages = seed.stock;
    for (const [index, snap] of input.turns.entries()) {
      const region = snap.regions.get(id);
      if (!region?.stock) {
        failures.push(`${id}: no stock after turn ${index + 1}`);
        break;
      }
      const stockPeople = people(region.stock);
      if (Math.abs(stockPeople - region.statePopulation) > LIMITS.writeBackPeople)
        failures.push(`${id}: turn ${index + 1} population is not the cohort total`);
      const step = Math.abs(region.statePopulation / previous - 1) * 100;
      maxStepPct = Math.max(maxStepPct, step);
      if (step > LIMITS.maxTurnStepPct)
        failures.push(`${id}: turn ${index + 1} moved ${round(step, 3)}%`);
      previous = region.statePopulation;
      turnPopulation.push(round(region.statePopulation, 1));
      finalStock = region.stock;
    }
    const driftPct = Math.abs(previous / seed.statePopulation - 1) * 100;
    if (driftPct > LIMITS.maxCumulativeDriftPct)
      failures.push(`${id}: drifted ${round(driftPct, 3)}% over ${input.turns.length} turns`);
    const finalBands = bandShares(finalStock);
    const maxBandShiftPp = Math.max(
      ...BANDS.map(([name]) => Math.abs(finalBands[name] - seedBands[name]))
    );
    if (maxBandShiftPp > LIMITS.maxBandShiftPp)
      failures.push(`${id}: an age band moved ${round(maxBandShiftPp, 3)}pp`);

    rows.push({
      id,
      countryId: seed.countryId,
      source,
      affected,
      seedPopulation: seed.statePopulation,
      seedPeople,
      turnPopulation,
      maxStepPct: round(maxStepPct),
      driftPct: round(driftPct),
      seedBands: roundBands(seedBands),
      finalBands: roundBands(finalBands),
      maxBandShiftPp: round(maxBandShiftPp),
      maxAdultShareErrorPp: round(maxAdultShareErrorPp, 6),
    });
  }
  return { rows, failures };
}

function roundBands(bands: Bands): Bands {
  return Object.fromEntries(BANDS.map(([name]) => [name, round(bands[name], 3)])) as Bands;
}

export interface Provenance {
  baseCommit: string;
  harnessCommit: string;
  /** "clean" only when no tracked or untracked path differs from harnessCommit. */
  sourceState: "clean" | "dirty";
  dirtyPaths: string[];
  harnessInCommit: boolean;
  sourceHashes: Record<string, string>;
}

type Git = (args: string[]) => string;
/** Raw stdout: porcelain status lines start with a significant space. */
const realGit: Git = (args) => execFileSync("git", args, { encoding: "utf8" });

/**
 * Commit the run executed from, its base on development, and whether the tree
 * differed from that commit. A dirty run is labelled dirty with its paths; it
 * is never reported as the commit's output.
 */
export function readProvenance(
  harnessFiles: readonly string[],
  sourceFiles: readonly string[],
  git: Git = realGit,
  read: (path: string) => Buffer = readFileSync
): Provenance {
  const harnessCommit = git(["rev-parse", "HEAD"]).trim();
  let baseCommit = "";
  for (const ref of ["origin/development", "development"]) {
    try {
      baseCommit = git(["merge-base", harnessCommit, ref]).trim();
      break;
    } catch {
      // try the next ref
    }
  }
  const dirtyPaths = git(["status", "--porcelain", "--untracked-files=all"])
    .split("\n")
    .map((line) => line.slice(3).trimEnd())
    .filter((path) => path.length > 0 && !path.startsWith("scripts/sim/reports/"));
  const harnessInCommit = harnessFiles.every((path) => {
    try {
      git(["cat-file", "-e", `${harnessCommit}:${path}`]);
      return true;
    } catch {
      return false;
    }
  });
  return {
    baseCommit: baseCommit || "unknown",
    harnessCommit,
    sourceState: dirtyPaths.length === 0 && harnessInCommit ? "clean" : "dirty",
    dirtyPaths,
    harnessInCommit,
    sourceHashes: Object.fromEntries(
      sourceFiles.map((path) => [path, createHash("sha256").update(read(path)).digest("hex")])
    ),
  };
}

export interface ScenarioReport {
  name: string;
  description: string;
  regions: number;
  affectedRegions: number;
  turns: number;
  failures: string[];
  maxStepPct: number;
  maxDriftPct: number;
  maxBandShiftPp: number;
  rows: RegionRow[];
}

export interface CoverageReport {
  issue: 3369;
  preset: "1991-default";
  provenance: Provenance;
  fixture: string;
  scope: string;
  limits: typeof LIMITS;
  notCovered: string[];
  scenarios: ScenarioReport[];
  freshMatchesStaleReset: boolean;
}

export function summarizeScenario(
  name: string,
  description: string,
  turns: number,
  result: { rows: RegionRow[]; failures: string[] }
): ScenarioReport {
  const max = (pick: (row: RegionRow) => number) => round(Math.max(0, ...result.rows.map(pick)), 4);
  return {
    name,
    description,
    regions: result.rows.length,
    affectedRegions: result.rows.filter((row) => row.affected).length,
    turns,
    failures: result.failures,
    maxStepPct: max((row) => row.maxStepPct),
    maxDriftPct: max((row) => row.driftPct),
    maxBandShiftPp: max((row) => row.maxBandShiftPp),
    rows: result.rows,
  };
}

const fmt = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 });
const bandsCell = (bands: Bands) => BANDS.map(([name]) => bands[name].toFixed(1)).join(" / ");

export function renderMarkdown(report: CoverageReport): string {
  const p = report.provenance;
  const lines = [
    "# 1991 cohort coverage qualification (#3369)",
    "",
    `Source state: **${p.sourceState}**. Harness commit \`${p.harnessCommit}\`, base on development \`${p.baseCommit}\`.` +
      (p.sourceState === "dirty"
        ? ` The run differed from that commit (${p.dirtyPaths.join(", ") || "harness not in commit"}); treat these numbers as unreviewed.`
        : " The tree matched that commit exactly."),
    "",
    `Regenerate: \`AHD_SIM_REPORT=1 AHD_TEST_REAL_MONGO=1 npx vitest run scripts/sim/cohortCoverage1991.mongo.test.ts\``,
    "",
    "## Scope",
    "",
    report.scope,
    "",
    `Fixture: ${report.fixture}`,
    "",
    "Not covered:",
    "",
    ...report.notCovered.map((line) => `- ${line}`),
    "",
    "## Limits (fixed before the run)",
    "",
    `- Seeded stock within ${report.limits.seedRoundingPeople} people of the seeded region population (cell rounding).`,
    `- Seeded adult bands within ${report.limits.adultShareTolerancePp}pp of the resolved source shares.`,
    `- After each turn, \`states.population\` equals the cohort total within ${report.limits.writeBackPeople.toFixed(1)}.`,
    `- No region moves more than ${report.limits.maxTurnStepPct}% in one turn or ${report.limits.maxCumulativeDriftPct}% over the run.`,
    `- No age band moves more than ${report.limits.maxBandShiftPp}pp of population over the run.`,
    "- No stock survives without a populated region behind it.",
    "",
    "## Result",
    "",
    "| Scenario | Regions | #3369 regions | Turns | Max step % | Max drift % | Max band shift pp | Failures |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...report.scenarios.map(
      (s) =>
        `| ${s.name} | ${s.regions} | ${s.affectedRegions} | ${s.turns} | ${s.maxStepPct} | ${s.maxDriftPct} | ${s.maxBandShiftPp} | ${s.failures.length} |`
    ),
    "",
    `Fresh seed equals stale-reset seed for every region: **${report.freshMatchesStaleReset ? "yes" : "no"}**.`,
    "",
  ];
  for (const scenario of report.scenarios) {
    lines.push(`## ${scenario.name}`, "", scenario.description, "");
    if (scenario.failures.length > 0)
      lines.push("Failures:", "", ...scenario.failures.map((f) => `- ${f}`), "");
    lines.push(
      "Bands are percent of population: 0-17 / 18-29 / 30-44 / 45-64 / 65+.",
      "",
      "| Region | Country | Age source | #3369 | Seed population | After last turn | Drift % | Seed bands | Final bands |",
      "|---|---|---|:---:|---:|---:|---:|---|---|",
      ...scenario.rows.map(
        (row) =>
          `| ${row.id} | ${row.countryId} | ${row.source} | ${row.affected ? "yes" : ""} | ${fmt(row.seedPopulation)} | ${fmt(row.turnPopulation.at(-1) ?? Number.NaN)} | ${row.driftPct.toFixed(3)} | ${bandsCell(row.seedBands)} | ${bandsCell(row.finalBands)} |`
      ),
      ""
    );
  }
  return lines.join("\n");
}
