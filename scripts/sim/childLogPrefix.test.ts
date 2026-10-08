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

describe("budgeted engine lifetime", () => {
  it("terminates a stalled process group and reports timeout even for graceful exit", async () => {
    const result = await spawnWithPrefixedLogs(
      process.execPath,
      ["-e", "process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},1000)"],
      identityA,
      () => {},
      { timeoutMs: 500 }
    );
    expect(result.timedOut).toBe(true);
  });
  it("does not mark a normally completed child as timed out", async () => {
    const result = await spawnWithPrefixedLogs(
      process.execPath,
      ["-e", "process.exit(0)"],
      identityA,
      () => {},
      { timeoutMs: 5000 }
    );
    expect(result.code).toBe(0);
    expect(result.timedOut).toBeUndefined();
  });
});

it("kills an owned descendant that ignores graceful termination", async () => {
  const lines: string[] = [];
  const stubborn =
    "process.on('SIGTERM',()=>{}); console.log('descendant-ready'); setInterval(()=>{},1000)";
  const parent = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(stubborn)}],{stdio:'inherit'}); process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},1000)`;
  const result = await spawnWithPrefixedLogs(
    process.execPath,
    ["-e", parent],
    identityA,
    (l) => lines.push(l),
    { timeoutMs: 1500 }
  );
  expect(lines.some((l) => l.includes("descendant-ready"))).toBe(true);
  expect(result.timedOut).toBe(true);
});

it("keeps the budget watchdog alive after its queue-worker parent dies", async () => {
  const { spawn } = await import("node:child_process");
  const { join } = await import("node:path");
  const watchdog = join(__dirname, "budgetProcess.mjs");
  const engine = "console.log('engine-ready'); setInterval(()=>{},1000)";
  const launcher = `require('child_process').spawn(process.execPath,[${JSON.stringify(watchdog)},'800',process.execPath,'-e',${JSON.stringify(engine)}],{stdio:'inherit'}); setInterval(()=>{},1000)`;
  const worker = spawn(process.execPath, ["-e", launcher], { stdio: ["ignore", "pipe", "pipe"] });
  let killed = false;
  worker.stdout.on("data", (chunk) => {
    if (String(chunk).includes("engine-ready")) {
      killed = true;
      worker.kill("SIGKILL");
    }
  });
  const closed = await new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.kill("SIGKILL");
      reject(new Error("Orphan watchdog failed to close inherited engine pipes"));
    }, 4000);
    worker.on("error", reject);
    worker.on("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  expect(killed).toBe(true);
  expect(closed).toBe(true);
});
