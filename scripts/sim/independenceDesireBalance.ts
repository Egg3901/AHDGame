/**
 * Deterministic UK desire balance qualification, without database access.
 * Run: npx tsx scripts/sim/independenceDesireBalance.ts <absolute-report-path.json>
 * Fixed-input trajectories isolate drift and seed changes, not whole-world feedback.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { runInNewContext } from "node:vm";
import { ModuleKind, transpileModule } from "typescript";
import { computeIndependenceDesireDriftSnapshot as candidate } from "@/lib/governorOffice/devolution/rules";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

type Inputs = Parameters<typeof candidate>[0];
const baselineCommit = "9abed56ca5";
const horizon = 2_400;
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const files = [
  "src/lib/constants/devolution.ts",
  "src/lib/governorOffice/devolution/independenceDesireDrift.ts",
  "src/lib/countries/uk/seed.ts",
];
const baselineText = Object.fromEntries(
  files.map((path) => [
    path,
    execFileSync("git", ["show", baselineCommit + ":" + path], { encoding: "utf8" }),
  ])
);
const baselineSources = Object.fromEntries(
  Object.entries(baselineText).map(([path, source]) => [path, sha256(source)])
);

// Execute the actual pinned pure baseline modules, not a rewritten reference.
// Type-only imports disappear; the only runtime import is the old constants.
function loadBaselineModule(path: string, imports: Record<string, unknown> = {}) {
  const exports: Record<string, unknown> = {};
  const code = transpileModule(baselineText[path], {
    compilerOptions: { module: ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(
    code,
    {
      exports,
      require: (name: string) => {
        assert(Object.hasOwn(imports, name), "Unexpected baseline runtime import: " + name);
        return imports[name];
      },
    },
    { timeout: 1_000 }
  );
  return exports;
}
const baselineConstants = loadBaselineModule(files[0]);
const baselineModule = loadBaselineModule(files[1], {
  "@/lib/constants/devolution": baselineConstants,
});
const legacySnapshot = baselineModule.computeIndependenceDesireDriftSnapshot as typeof candidate;
const legacy = (args: Inputs) => legacySnapshot(args).next;

const scenarios: { name: string; inputs: Omit<Inputs, "previous">; reverseAt?: number }[] = [
  {
    name: "neutral",
    inputs: {
      policy: "pro",
      westminsterPolicy: "pro",
      regionalApproval: 50,
      nationalApproval: 50,
      inflationPercent: 3,
    },
  },
  {
    name: "policy_only",
    inputs: {
      policy: "independence",
      regionalApproval: 50,
      nationalApproval: 50,
      inflationPercent: 3,
    },
  },
  {
    name: "popular_fm",
    inputs: {
      policy: "independence",
      regionalApproval: 70,
      nationalApproval: 50,
      inflationPercent: 3,
    },
  },
  {
    name: "favourable",
    inputs: {
      policy: "independence",
      regionalApproval: 70,
      nationalApproval: 30,
      inflationPercent: 6,
    },
  },
  {
    name: "maximum",
    inputs: {
      policy: "independence",
      regionalApproval: 100,
      nationalApproval: 0,
      inflationPercent: 6,
    },
  },
  {
    name: "rejected_fm",
    inputs: {
      policy: "independence",
      regionalApproval: 25,
      nationalApproval: 50,
      inflationPercent: 3,
    },
  },
  {
    name: "popular_westminster",
    inputs: {
      policy: "independence",
      regionalApproval: 50,
      nationalApproval: 80,
      inflationPercent: 3,
    },
  },
  {
    name: "unionist",
    inputs: { policy: "anti", regionalApproval: 70, nationalApproval: 70, inflationPercent: 3 },
  },
  {
    name: "mandate_reversal",
    inputs: {
      policy: "independence",
      regionalApproval: 70,
      nationalApproval: 50,
      inflationPercent: 3,
    },
    reverseAt: 192,
  },
];
const seeds = {
  old1991: { SCO: 25, NIR: 30, WAL: 10 },
  new1991: { SCO: 35, NIR: 23, WAL: 10 },
  modern: { SCO: 45, NIR: 40, WAL: 25 },
};
const arms = [
  { name: "baseline_1991", seeds: seeds.old1991, compute: legacy },
  { name: "corrected_seeds_legacy_rules", seeds: seeds.new1991, compute: legacy },
  { name: "candidate_1991", seeds: seeds.new1991, compute: (args: Inputs) => candidate(args).next },
  { name: "baseline_2019", seeds: seeds.modern, compute: legacy },
  { name: "candidate_2019", seeds: seeds.modern, compute: (args: Inputs) => candidate(args).next },
];
const trajectories = arms.flatMap((arm) =>
  scenarios.flatMap((scenario) =>
    Object.entries(arm.seeds).map(([region, start]) => {
      let value = start;
      let thresholdTurn: number | null = null;
      const samples: Record<number, number> = { 0: start };
      for (let turn = 1; turn <= horizon; turn++) {
        const inputs = { ...scenario.inputs };
        if (scenario.reverseAt && turn > scenario.reverseAt) inputs.regionalApproval = 25;
        value = arm.compute({ ...inputs, previous: value });
        assert(Number.isFinite(value) && value >= 0 && value <= 100);
        if (value >= 60 && thresholdTurn === null) thresholdTurn = turn;
        if ([48, 192, 480, 960, horizon].includes(turn)) samples[turn] = value;
      }
      return { arm: arm.name, scenario: scenario.name, region, start, thresholdTurn, samples };
    })
  )
);
const gain = (scenario: string) => {
  const row = trajectories.find(
    (row) => row.arm === "candidate_1991" && row.region === "SCO" && row.scenario === scenario
  )!;
  return row.samples[48] - row.start;
};
assert(gain("popular_fm") >= 3 && gain("popular_fm") <= 5);
assert(gain("maximum") <= 8.2);
assert(Math.abs(gain("neutral") + 0.144) < 1e-6);
assert(gain("rejected_fm") < 0);
assert(Math.abs(gain("popular_westminster") - 0.096) < 1e-6);
for (const previous of [24.999, 25.001]) {
  assert.equal(candidate({ ...scenarios[0].inputs, previous }).next, 25);
}
const output = process.argv[2];
assert(output && isAbsolute(output), "Supply an absolute report path outside the repository");
const outputRelative = relative(process.cwd(), output);
assert(
  outputRelative.startsWith("..") || isAbsolute(outputRelative),
  "Reports belong outside the repository"
);
const report = {
  question:
    "Does precision survive accumulation and does ordinary approval matter more without increasing extreme annual drift?",
  scope: "Portable rules only; fixed inputs, no database, live player data or whole-world feedback",
  verdict: "passed",
  baselineCommit,
  candidateCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  candidateHasUncommittedChanges:
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
  sourceHashes: {
    baseline: baselineSources,
    candidate: Object.fromEntries(
      [...files, "src/lib/governorOffice/devolution/rules.ts"].map((path) => [
        path,
        sha256(readFileSync(path)),
      ])
    ),
    harness: sha256(readFileSync("scripts/sim/independenceDesireBalance.ts")),
  },
  completedTurns: horizon,
  turnsPerYear: TURNS_PER_YEAR,
  assertions: [
    "all trajectories finite and bounded",
    "popular FM annual gain 3-5",
    "maximum annual gain <=8.2",
    "neutral pro-devolution Westminster preserves 0.144 annual recovery",
    "rejected FM reverses growth; popular unionist Westminster slows a neutral-approval separatist FM to 0.096 annually",
    "baseline recovery stops at target",
  ],
  candidateAnnualGains: Object.fromEntries(
    scenarios
      .filter((scenario) => !scenario.reverseAt)
      .map((scenario) => [scenario.name, Number(gain(scenario.name).toFixed(6))])
  ),
  scenarios,
  trajectories,
};
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      reportPath: output,
      verdict: report.verdict,
      trajectories: trajectories.length,
      horizon,
      candidateAnnualGains: report.candidateAnnualGains,
    },
    null,
    2
  )
);
