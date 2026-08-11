import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { formatDiagnosticSummary } from "./index";
import type { SeedDiagnosticCheck, SeedDiagnosticReport } from "./types";

function report(checks: SeedDiagnosticCheck[]): SeedDiagnosticReport {
  const summary = {
    ok: checks.filter((c) => c.severity === "ok").length,
    warn: checks.filter((c) => c.severity === "warn").length,
    critical: checks.filter((c) => c.severity === "critical").length,
  };
  return {
    _id: new ObjectId(),
    ranAt: new Date("2026-07-31T00:00:00.000Z"),
    mode: "conformance",
    trigger: "post-reset",
    preset: "1953-default",
    turn: 1,
    calendarTurn: 0,
    summary,
    checks,
  };
}

function check(id: string, severity: SeedDiagnosticCheck["severity"]): SeedDiagnosticCheck {
  return { id, scope: "global", metric: "m", expected: 1, actual: 1, severity };
}

describe("formatDiagnosticSummary", () => {
  it("names the failing checks, so the reset log is actionable on its own", () => {
    // The summary line is the only trace a reset leaves in the log. Reporting
    // "1 critical" without the id cost a full re-seed to find out which check
    // it was.
    const line = formatDiagnosticSummary(
      report([check("a.ok", "ok"), check("readiness.DE.RegionMetrics", "critical")])
    );
    expect(line).toContain("1 critical");
    expect(line).toContain("readiness.DE.RegionMetrics");
  });

  it("lists every critical when there are several", () => {
    const line = formatDiagnosticSummary(
      report([check("x.one", "critical"), check("y.two", "critical")])
    );
    expect(line).toContain("x.one");
    expect(line).toContain("y.two");
  });

  it("caps a long critical list so the log line stays readable", () => {
    const many = Array.from({ length: 9 }, (_, i) => check(`c.${i}`, "critical"));
    const line = formatDiagnosticSummary(report(many));
    expect(line).toContain("c.0");
    expect(line).toContain("+4 more");
    expect(line).not.toContain("c.8");
  });

  it("appends nothing when the run is clean", () => {
    const line = formatDiagnosticSummary(report([check("a.ok", "ok")]));
    expect(line).toBe("Seed diagnostic (conformance): 1 ok, 0 warn, 0 critical");
  });
});
