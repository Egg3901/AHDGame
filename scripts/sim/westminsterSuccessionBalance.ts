/** Synthetic fixed-condition replay of an inherited Westminster stance cooldown. */
import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  computeIndependenceDesireDriftSnapshot as step,
  westminsterStanceChangeError,
} from "../../src/lib/governorOffice/devolution/rules";
import type { DevolutionPolicy } from "../../src/lib/db/types/governorOfficeState";
const scenarios = [];
for (const region of ["WAL", "SCO", "NIR"]) {
  for (const approval of [30, 50, 70]) {
    for (const inheritedAt of [29, 99, 100]) {
      const arms = [];
      for (const candidate of [false, true]) {
        let previous = region === "WAL" ? 10 : region === "SCO" ? 35 : 23;
        let policy: DevolutionPolicy = "anti";
        let changedAtTurn = inheritedAt;
        let changedUnderGovernment = "outgoing";
        let spent = 0;
        let changedTurn: number | null = null;
        for (let turn = 100; turn < 292; turn++) {
          const args = {
            currentPolicy: policy,
            policy: "independence" as const,
            changedAtTurn,
            changedUnderGovernment,
            currentTurn: turn,
            actions: 2,
            government: candidate ? { key: "incoming", formedTurn: 100 } : null,
          };
          if (changedTurn == null && westminsterStanceChangeError(args) == null) {
            policy = "independence";
            changedAtTurn = turn;
            changedUnderGovernment = "incoming";
            changedTurn = turn;
            spent += 2;
            assert.match(
              westminsterStanceChangeError({
                ...args,
                currentPolicy: policy,
                policy: "pro",
                changedAtTurn,
                changedUnderGovernment,
              })!,
              /cooldown/
            );
            assert.match(westminsterStanceChangeError({ ...args, actions: 1 })!, /Insufficient/);
          }
          previous = step({
            previous,
            policy: "independence",
            westminsterPolicy: policy,
            regionalApproval: 70,
            nationalApproval: approval,
            inflationPercent: 3,
          }).next;
          assert.ok(Number.isFinite(previous) && previous >= 0 && previous <= 100);
        }
        assert.equal(spent, 2);
        assert.equal(changedTurn, candidate ? 100 : Math.max(100, inheritedAt + 72));
        arms.push({ candidate, changedTurn, spent, finalDesire: previous });
      }
      assert.ok(arms[1].finalDesire >= arms[0].finalDesire);
      scenarios.push({ region, approval, inheritedAt, arms });
    }
  }
}
const rulesPath = "src/lib/governorOffice/devolution/rules.ts";
const report = {
  verdict: "passed",
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  rulesSha256: createHash("sha256").update(readFileSync(rulesPath)).digest("hex"),
  fixture: "Synthetic fixed approval/inflation, no player data or database access",
  turnsPerArm: 192,
  qualification:
    "Cooldown eligibility and AP invariants with fixed-condition Desire trajectories, not a whole-world forecast. Baseline omits the government allowance; drift formulas are identical.",
  scenarios,
};
const output = process.argv[2];
assert.ok(output, "Pass a report path outside the repository");
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(`${scenarios.length * 2} arms passed over 192 turns; report: ${output}`);
