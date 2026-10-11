/**
 * Deterministic Westminster stance balance and shell-I/O qualification.
 * Run: npx tsx scripts/sim/westminsterDesireBalance.ts <absolute-report-path.json>
 * Synthetic fixtures only; approval providers are fixed, not a whole-world forecast.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { runInNewContext } from "node:vm";
import { ModuleKind, transpileModule } from "typescript";
import { BSON } from "mongodb";
import * as rules from "@/lib/governorOffice/devolution/rules";
import { mergeRegionMetrics } from "@/lib/macroMetrics/merge";

async function main() {
  const baselineCommit = "25e0c327f8cfc84ec5ac9fdbf421be1677229198";
  const rulesPath = "src/lib/governorOffice/devolution/rules.ts";
  const shellPath = "src/lib/turn/independenceDesireDrift.ts";
  const baseline = (path: string) =>
    execFileSync("git", ["show", `${baselineCommit}:${path}`], { encoding: "utf8" });
  const hash = (source: string | Buffer) => createHash("sha256").update(source).digest("hex");
  function execute(source: string, imports: Record<string, unknown> = {}) {
    const exports: Record<string, unknown> = {};
    runInNewContext(
      transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText,
      {
        exports,
        Date,
        require: (name: string) => {
          assert(Object.hasOwn(imports, name), `Unexpected runtime import: ${name}`);
          return imports[name];
        },
      },
      { timeout: 1000 }
    );
    return exports;
  }
  const queryPath = "src/lib/governorOffice/devolution/queries.ts";
  const oldRules = execute(baseline(rulesPath));
  const oldStep =
    oldRules.computeIndependenceDesireDriftSnapshot as typeof rules.computeIndependenceDesireDriftSnapshot;
  const starts = { SCO: 35, WAL: 10, NIR: 23 };
  const policies = ["anti", "pro", "independence"] as const;
  const horizon = 2400;
  const trajectories = [];
  for (const [region, start] of Object.entries(starts)) {
    for (const policy of policies)
      for (const westminsterPolicy of policies) {
        for (const regionalApproval of [30, 50, 70])
          for (const nationalApproval of [30, 50, 70]) {
            for (const reverse of [false, true]) {
              const inputs = {
                policy,
                westminsterPolicy,
                regionalApproval,
                nationalApproval,
                inflationPercent: 3,
              };
              const arms = [];
              for (const [name, step] of [
                ["baseline", oldStep],
                ["candidate", rules.computeIndependenceDesireDriftSnapshot],
              ] as const) {
                let previous = start;
                let thresholdTurn: number | null = null;
                const samples: Record<number, number> = {};
                for (let turn = 1; turn <= horizon; turn++) {
                  const result = step({
                    ...inputs,
                    previous,
                    westminsterPolicy: reverse && turn > 192 ? "anti" : westminsterPolicy,
                  });
                  assert(result.next >= 0 && result.next <= 100 && Number.isFinite(result.next));
                  assert(Math.abs(result.delta - (result.next - previous)) < 1e-6);
                  if (result.next >= 60 && thresholdTurn === null) thresholdTurn = turn;
                  previous = result.next;
                  if ([48, 192, 480, 960, horizon].includes(turn)) samples[turn] = previous;
                }
                arms.push({ name, thresholdTurn, samples });
              }
              trajectories.push({
                region,
                start,
                ...inputs,
                reverseWestminsterAfter192: reverse,
                arms,
              });
            }
          }
      }
  }
  const annualGains = Object.fromEntries(
    policies.map((westminsterPolicy) => {
      let previous = 35;
      for (let turn = 0; turn < 48; turn++)
        previous = rules.computeIndependenceDesireDriftSnapshot({
          previous,
          policy: "independence",
          westminsterPolicy,
          regionalApproval: 70,
          nationalApproval: 70,
          inflationPercent: 3,
        }).next;
      return [westminsterPolicy, Number((previous - 35).toFixed(6))];
    })
  );
  assert.deepEqual(annualGains, { anti: 2.256, pro: 4.176, independence: 6.336 });
  for (const policy of policies)
    for (const approval of [0, 30, 49.9, 50, 70, 100]) {
      assert.equal(rules.westminsterPolicyDrift(policy), rules.DEVOLUTION_POLICY_DRIFT[policy] / 2);
      assert.equal(
        rules.nationalApprovalDrift(approval, policy),
        rules.regionalApprovalDrift(approval, policy) / 2
      );
    }

  // Replay the actual old/new turn shells against the same owned, synthetic fixture.
  // Upstream approval scoring is fixed at 70 to isolate this phase's direct I/O.
  // Count BSON payload bytes and awaited commands; this excludes wire envelopes and provider I/O.
  const now = new Date(0);
  const fixture = {
    states: Object.keys(starts).map((_id) => ({ _id, countryId: "UK" })),
    macroMetrics: Object.entries(starts).map(([_id, value]) => ({
      _id,
      countryId: "UK",
      independenceDesire: { value, trend: 0 },
      economic: {},
      population: {},
      lastUpdated: now,
    })),
    governmentApprovals: [{ _id: "UK", approvalRating: 70 }],
    federalBudget: [{ _id: "UK", economicFactors: { inflationRate: 3 } }],
    gameState: [{ _id: "current", preset: "1991-default", currentTurn: 100 }],
    governorOfficeState: [
      ...Object.keys(starts).map((stateId) => ({
        countryId: "UK",
        stateId,
        devolutionPolicy: "independence",
        characterId: null,
        characterName: "Fixture FM",
        gubernatorialActions: 3,
        lastActionGrantedTurn: 99,
        createdAt: now,
        updatedAt: now,
      })),
      {
        countryId: "UK",
        stateId: "uk_national",
        characterId: null,
        characterName: "Fixture PM",
        gubernatorialActions: 3,
        lastActionGrantedTurn: 99,
        createdAt: now,
        updatedAt: now,
        westminsterStances: {
          SCO: { policy: "independence" },
          WAL: { policy: "pro" },
          NIR: { policy: "anti" },
        },
      },
    ],
  };
  type Row = Record<string, unknown>;
  function matches(row: Row, filter: Row): boolean {
    return Object.entries(filter).every(([key, value]) =>
      typeof value === "object" && value !== null && "$in" in value
        ? (value.$in as unknown[]).includes(row[key])
        : row[key] === value
    );
  }
  async function replay(source: string, math: Record<string, unknown>) {
    const telemetry = { commands: 0, returnedDocuments: 0, returnedBsonBytes: 0 };
    let writes: {
      updateOne: {
        filter: { _id: string };
        update: { $set: { independenceDesire: { value: number; trend: number } } };
      };
    }[] = [];
    const collect = (rows: Row[]) => {
      telemetry.commands++;
      telemetry.returnedDocuments += rows.length;
      telemetry.returnedBsonBytes += rows.reduce((sum, row) => sum + BSON.serialize(row).length, 0);
      return rows;
    };
    const db = {
      collection: (name: keyof typeof fixture) => ({
        distinct: async (key: string, filter: Row) => {
          const values = fixture[name]
            .filter((row) => matches(row, filter))
            .map((row: Row) => row[key]);
          telemetry.commands++;
          telemetry.returnedBsonBytes += BSON.serialize({ values }).length;
          return values;
        },
        findOne: async (filter: Row) =>
          collect(fixture[name].filter((row) => matches(row, filter)))[0] ?? null,
        find: (filter: Row) => {
          let projection: Row | undefined;
          const cursor = {
            project: (fields: Row) => {
              projection = fields;
              return cursor;
            },
            toArray: async () =>
              collect(
                fixture[name]
                  .filter((row) => matches(row, filter))
                  .map((row: Row) =>
                    projection
                      ? Object.fromEntries(
                          Object.entries(row).filter(([key]) => projection![key] === 1)
                        )
                      : row
                  )
              ),
          };
          return cursor;
        },
        bulkWrite: async (operations: typeof writes) => {
          telemetry.commands++;
          writes = operations;
        },
      }),
    };
    const imports = {
      "@/lib/era/era": { resolveGameYear: () => 1991 },
      "@/lib/constants/devolution": { UK_DEVOLUTION_REGIONS: new Set(Object.keys(starts)) },
      "@/lib/utils/governmentApproval": {
        BASE_APPROVAL: 50,
        calculateStateApproval: () => 70,
        computeNationalAveragesFromMetrics: () => ({}),
        loadElectorateGroups: async () => new Map(),
        weightingFor: () => ({}),
      },
      "@/lib/politicalLegislation/politicalApprovalProvider": {
        loadPoliticalApprovalBases: async () => null,
      },
      "@/lib/macroMetrics/merge": { mergeRegionMetrics },
      "@/lib/bonds/sovereign": { getNationalBudgetId: () => "UK" },
      "@/lib/policy/nationalStateId": { getNationalStateId: () => "uk_national" },
      "@/lib/governorOffice/devolution/independenceDesireDrift": math,
      "@/lib/governorOffice/devolution/rules": math,
      "@/lib/constants/seedPreset": { DEFAULT_SEED_PRESET: "2019-default" },
    };
    const shell = execute(source, {
      ...imports,
      "@/lib/governorOffice/devolution/queries": execute(readFileSync(queryPath, "utf8"), imports),
    });
    const process = shell.processIndependenceDesireDrift as (
      db: unknown,
      turn: number
    ) => Promise<{ perRegion: { stateId: string; next: number; delta: number }[] }>;
    const result = await process(db, 100);
    assert.equal(writes.length, 3);
    for (const row of result.perRegion) {
      const write = writes.find((write) => write.updateOne.filter._id === row.stateId)!;
      assert.equal(write.updateOne.update.$set.independenceDesire.value, row.next);
      assert.equal(write.updateOne.update.$set.independenceDesire.trend, row.delta);
    }
    return { telemetry, result };
  }
  const before = await replay(baseline(shellPath), oldRules);
  const after = await replay(readFileSync(shellPath, "utf8"), rules);
  assert.equal(after.telemetry.commands, before.telemetry.commands);
  assert(after.telemetry.returnedBsonBytes <= before.telemetry.returnedBsonBytes);
  const nationalFixture = fixture.governorOfficeState.at(-1)!;
  assert("westminsterStances" in nationalFixture);
  for (const row of after.result.perRegion) {
    const policy = nationalFixture.westminsterStances[row.stateId as keyof typeof starts]
      .policy as (typeof policies)[number];
    const expected = rules.computeIndependenceDesireDriftSnapshot({
      previous: starts[row.stateId as keyof typeof starts],
      policy: "independence",
      westminsterPolicy: policy,
      regionalApproval: 70,
      nationalApproval: 70,
      inflationPercent: 3,
    });
    assert.equal(row.next, expected.next);
    assert.equal(row.delta, expected.delta);
  }
  const output = process.argv[2];
  assert(output && isAbsolute(output), "Supply an absolute report path outside the repository");
  const outputRelative = relative(process.cwd(), output);
  assert(
    outputRelative.startsWith("..") || isAbsolute(outputRelative),
    "Reports belong outside the repository"
  );
  const report = {
    verdict: "passed",
    baselineCommit,
    candidateCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    candidateHasUncommittedChanges:
      execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
    question:
      "Does each Westminster stance exert half the FM influence, with bounded trajectories and no extra phase round trips?",
    scope:
      "Fixed-input portable rules plus synthetic turn-shell replay. No live data, remote Mongo latency, full approval-provider I/O or whole-world feedback.",
    sourceHashes: {
      baselineRules: hash(baseline(rulesPath)),
      candidateRules: hash(readFileSync(rulesPath)),
      baselineShell: hash(baseline(shellPath)),
      candidateShell: hash(readFileSync(shellPath)),
      candidateQueries: hash(readFileSync(queryPath)),
      harness: hash(readFileSync("scripts/sim/westminsterDesireBalance.ts")),
      fixture: hash(JSON.stringify(fixture)),
    },
    completedTurns: horizon,
    turnsPerYear: 48,
    trajectories,
    annualGainsPopularSeparatistFMAndWestminster: annualGains,
    shellReplay: { before, after },
    assertions: [
      "all 972 arm trajectories are finite, bounded and preserve actual trend",
      "Westminster direct and approval influence are exactly half the FM's",
      "annual stance ordering is anti < pro < independence",
      "independent regional stances reach the engine and bulk writes",
      "direct phase command count does not increase",
      "projected returned BSON payload does not increase",
    ],
  };
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        verdict: report.verdict,
        trajectories: trajectories.length * 2,
        annualGains,
        before: before.telemetry,
        after: after.telemetry,
      },
      null,
      2
    )
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
