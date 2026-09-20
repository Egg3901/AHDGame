import { describe, expect, it } from "vitest";
import {
  buildChildLogPrefix,
  prefixChildLine,
  spawnWithPrefixedLogs,
  type ChildRunIdentity,
} from "./childLogPrefix";

const identityA: ChildRunIdentity = {
  runId: "audit-allflags-1953-r3",
  seed: "seed-1953",
  dbName: "ahd_sim_1953",
  slot: 2,
  workerInstance: "worker-1:1234",
};

const identityB: ChildRunIdentity = {
  runId: "audit-allflags-1991-r3",
  seed: "seed-1991",
  dbName: "ahd_sim_1991",
  slot: 1,
  workerInstance: "worker-1:1234",
};

describe("concurrent child log attribution (#2071)", () => {
  it("prefixes every line with runId, seed, database, worker instance, and slot", () => {
    const prefix = buildChildLogPrefix(identityA);
    expect(prefix).toContain("audit-allflags-1953-r3");
    expect(prefix).toContain("seed-1953");
    expect(prefix).toContain("ahd_sim_1953");
    expect(prefix).toContain("worker-1:1234");
    expect(prefix).toContain("2");
    expect(
      prefixChildLine(prefix, "[BudgetInvariant] turn 5 DE surplus: NOT reconciled")
    ).toContain("audit-allflags-1953-r3");
  });

  it("separates simultaneous jobs emitting identical warning types", async () => {
    const linesA: string[] = [];
    const linesB: string[] = [];
    // Same warning text from both children, plus one distinct marker each —
    // mirrors the unattributable [BudgetInvariant]/[clearing] lines in #2071.
    const stub = (marker: string) =>
      `console.log('[BudgetInvariant] turn 5 DE surplus: NOT reconciled');` +
      `console.log('${marker}');` +
      `console.error('[clearing] post-normalization order-book/ledger unit mismatch');`;
    const [resA, resB] = await Promise.all([
      spawnWithPrefixedLogs(process.execPath, ["-e", stub("MARKER-1953")], identityA, (line) =>
        linesA.push(line)
      ),
      spawnWithPrefixedLogs(process.execPath, ["-e", stub("MARKER-1991")], identityB, (line) =>
        linesB.push(line)
      ),
    ]);
    expect(resA.code).toBe(0);
    expect(resB.code).toBe(0);
    // Every captured line carries its own run identity on both streams.
    expect(linesA.length).toBeGreaterThan(0);
    expect(linesB.length).toBeGreaterThan(0);
    for (const line of linesA) {
      expect(line).toContain("audit-allflags-1953-r3");
      expect(line).not.toContain("audit-allflags-1991-r3");
    }
    for (const line of linesB) {
      expect(line).toContain("audit-allflags-1991-r3");
      expect(line).not.toContain("audit-allflags-1953-r3");
    }
    // Distinct markers are attributable without PID inference.
    expect(linesA.some((line) => line.includes("MARKER-1953"))).toBe(true);
    expect(linesB.some((line) => line.includes("MARKER-1991"))).toBe(true);
    expect(linesA.some((line) => line.includes("MARKER-1991"))).toBe(false);
    expect(linesB.some((line) => line.includes("MARKER-1953"))).toBe(false);
  });
});
