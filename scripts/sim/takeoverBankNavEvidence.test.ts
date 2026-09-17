/**
 * Machine-checkable gate for the issue #1750 worldsim evidence scenario.
 * Fixed seed, no DB, no clock, no randomness: rerunning this file must
 * produce the identical report. Worldsim itself cannot traverse the
 * hostile / privatization / fund-only player-command paths (see the module
 * header), so this scenario plus the per-path wiring tests
 * (route.bankNavFloor, openPrivatizationVote "bank-NAV floor",
 * fundOnlyBuyout) are the pre-simulation evidence for PR #1936.
 */
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_KIND,
  EVIDENCE_SEED,
  evidenceExitCode,
  runGatedTakeoverBankNavEvidence,
  runTakeoverBankNavEvidence,
  serializeEvidenceReport,
  type EvidenceReport,
} from "./takeoverBankNavEvidence";
import type { SimSourceDeps } from "./simSource";

const POINTER_NAV = 1_300_000_000;
const AUTHORITATIVE_NAV = 1_250_000_000;

describe("takeover bank-NAV evidence (issue #1750, PR #1936 gate)", () => {
  it("passes every invariant at the fixed seed", () => {
    const report = runTakeoverBankNavEvidence(EVIDENCE_SEED);
    expect(report.pass).toBe(true);
    expect(report.invariants.length).toBeGreaterThan(20);
    expect(report.invariants.filter((i) => !i.pass)).toEqual([]);
  });

  it("pins the exploit fixture NAV in both deposit-policy modes", () => {
    const report = runTakeoverBankNavEvidence(EVIDENCE_SEED);
    const hostile = (mode: string) =>
      report.cases.find(
        (c) => c.fixture === "exploit-bank" && c.policyMode === mode && c.path === "hostile"
      )!;
    expect(hostile("pointer").navTotal).toBe(POINTER_NAV);
    expect(hostile("authoritative").navTotal).toBe(AUTHORITATIVE_NAV);
    // Pointer deposits arrive as no cash, so they add no liability; the
    // authoritative read nets the full 50M exactly once.
    expect(hostile("pointer").navTotal - hostile("authoritative").navTotal).toBe(50_000_000);
  });

  it("reproduces the arbitrage in control and closes it in treatment, all paths", () => {
    const report = runTakeoverBankNavEvidence(EVIDENCE_SEED);
    const legs: Array<[string, number]> = [
      ["hostile", 12.5],
      ["voted-privatization", 11],
      ["fund-only", 10],
    ];
    for (const [path, market] of legs) {
      const c = report.cases.find(
        (cc) => cc.fixture === "exploit-bank" && cc.policyMode === "pointer" && cc.path === path
      )!;
      expect(c.marketPerShare).toBe(market);
      expect(c.floorPerShare).toBe(130);
      expect(c.floorApplied).toBe(true);
      // 100k minority shares: 1.25M control vs 13M of realizable bank NAV.
      expect(c.controlTotal).toBeLessThan(MINORITY_NAV(130));
      expect(c.settledTotal).toBe(MINORITY_NAV(130));
    }
  });

  it("leaves underwater and bankless pricing exactly at the market leg", () => {
    const report = runTakeoverBankNavEvidence(EVIDENCE_SEED);
    const underwater = report.cases.find((c) => c.fixture === "underwater-bank")!;
    expect(underwater.floorPerShare).toBe(0);
    expect(underwater.floorApplied).toBe(false);
    for (const c of report.cases.filter((cc) => cc.fixture === "no-bank")) {
      expect(c.floorPerShare).toBe(0);
      expect(c.settledTotal).toBe(c.controlTotal);
    }
  });

  it("is deterministic: two runs at the fixed seed are identical", () => {
    expect(runTakeoverBankNavEvidence(EVIDENCE_SEED)).toEqual(
      runTakeoverBankNavEvidence(EVIDENCE_SEED)
    );
  });

  it("rejects a malformed pinned source instead of unattributed evidence", () => {
    expect(() =>
      runTakeoverBankNavEvidence(EVIDENCE_SEED, { worktree: "muse-1750", commit: "abc" })
    ).toThrow();
    expect(
      () =>
        runTakeoverBankNavEvidence(EVIDENCE_SEED, {
          worktree: "muse-1750",
          commit: "a".repeat(40),
        }).source
    ).toBeDefined();
  });
});

function MINORITY_NAV(floorPerShare: number): number {
  return 100_000 * floorPerShare;
}

const GATE_SHA = "c".repeat(40);
const OTHER_SHA = "d".repeat(40);
const GATE_OPTS = { root: "/root/projects/AHDGame/worktrees", main: "/root/projects/AHDGame" };

function gateDeps(over: Partial<SimSourceDeps> = {}): SimSourceDeps {
  return {
    realpath: (p: string) => p,
    isDirectory: () => true,
    gitHead: () => GATE_SHA,
    gitPorcelain: () => "",
    ...over,
  };
}

function failReport(report: EvidenceReport, id: string): EvidenceReport {
  return {
    ...report,
    invariants: report.invariants.map((i) => (i.id === id ? { ...i, pass: false } : i)),
    pass: false,
  };
}

describe("takeover bank-NAV evidence gate (operational contract)", () => {
  it("stamps the deterministic command-path kind, not worldsim coverage", () => {
    const { report, exitCode } = runGatedTakeoverBankNavEvidence(
      { seed: EVIDENCE_SEED, sourceWorktree: "muse-1750", sourceCommit: GATE_SHA },
      gateDeps(),
      GATE_OPTS
    );
    expect(exitCode).toBe(0);
    expect(report.pass).toBe(true);
    expect(report.kind).toBe(EVIDENCE_KIND);
    expect(report.kind).toBe("deterministic-command-path");
    expect(report.worldsimCoversAuthenticatedCommands).toBe(false);
    expect(report.worldsimNote).toMatch("runWorld");
    expect(report.source).toEqual({ worktree: "muse-1750", commit: GATE_SHA });
  });

  it("cannot pass unpinned: exit 1 with a failed G-source-verified invariant", () => {
    for (const req of [{}, { seed: EVIDENCE_SEED }]) {
      const { report, exitCode } = runGatedTakeoverBankNavEvidence(req, gateDeps(), GATE_OPTS);
      expect(exitCode).toBe(1);
      expect(report.pass).toBe(false);
      expect(evidenceExitCode(report)).toBe(1);
      const gate = report.invariants.find((i) => i.id === "G-source-verified")!;
      expect(gate.pass).toBe(false);
      expect(gate.statement).toMatch("pinned");
    }
  });

  it("rejects a source mismatch (stale pin) with exit 1", () => {
    const { report, exitCode } = runGatedTakeoverBankNavEvidence(
      { seed: EVIDENCE_SEED, sourceWorktree: "muse-1750", sourceCommit: OTHER_SHA },
      gateDeps(),
      GATE_OPTS
    );
    expect(exitCode).toBe(1);
    expect(report.pass).toBe(false);
    expect(report.invariants.find((i) => i.id === "G-source-verified")?.pass).toBe(false);
  });

  it("rejects a dirty checkout with exit 1", () => {
    const { report, exitCode } = runGatedTakeoverBankNavEvidence(
      { seed: EVIDENCE_SEED, sourceWorktree: "muse-1750", sourceCommit: GATE_SHA },
      gateDeps({ gitPorcelain: () => " M src/lib/x.ts\n" }),
      GATE_OPTS
    );
    expect(exitCode).toBe(1);
    expect(report.pass).toBe(false);
    expect(report.invariants.find((i) => i.id === "G-source-verified")?.pass).toBe(false);
  });

  it("reports a failed scenario invariant with exit 1 in the artifact", () => {
    const { report } = runGatedTakeoverBankNavEvidence(
      { seed: EVIDENCE_SEED, sourceWorktree: "muse-1750", sourceCommit: GATE_SHA },
      gateDeps(),
      GATE_OPTS
    );
    const broken = failReport(report, "A-closed-pointer-hostile");
    expect(broken.pass).toBe(false);
    expect(evidenceExitCode(broken)).toBe(1);
    const parsed = JSON.parse(serializeEvidenceReport(broken)) as EvidenceReport;
    expect(parsed.pass).toBe(false);
    expect(parsed.invariants.find((i) => i.id === "A-closed-pointer-hostile")?.pass).toBe(false);
  });

  it("serializes canonically: two runs are byte-identical", () => {
    const opts = { seed: EVIDENCE_SEED, sourceWorktree: "muse-1750", sourceCommit: GATE_SHA };
    const a = serializeEvidenceReport(
      runGatedTakeoverBankNavEvidence(opts, gateDeps(), GATE_OPTS).report
    );
    const b = serializeEvidenceReport(
      runGatedTakeoverBankNavEvidence(opts, gateDeps(), GATE_OPTS).report
    );
    expect(a).toBe(b);
    // Canonical form: sorted keys, trailing newline, parses back to the report.
    expect(a.endsWith("\n")).toBe(true);
    expect(JSON.parse(a)).toEqual(JSON.parse(b));
  });
});
