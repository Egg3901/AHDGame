"use client";

import type { CodeQualitySnapshot } from "@/lib/db/types";

interface Props {
  snapshot: CodeQualitySnapshot | null;
}

function MetricCard({
  label,
  lines,
  score,
}: {
  label: string;
  lines: { label: string; value: string }[];
  score?: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <p className="mb-2 text-xs font-semibold text-foreground">{label}</p>
      <div className="space-y-1">
        {lines.map((l) => (
          <div key={l.label} className="flex justify-between text-xs">
            <span className="text-muted">{l.label}</span>
            <span className="font-medium">{l.value}</span>
          </div>
        ))}
      </div>
      {score !== undefined && (
        <p className="mt-2 text-right text-xs text-muted">
          Score: <span className="font-bold">{Math.round(score)}</span>
        </p>
      )}
    </div>
  );
}

// Score formulas matching the spec and post-build script
function calcTypescriptScore(errors: number): number {
  return Math.max(0, 100 - errors * 10);
}

function calcTestScore(passRate: number, coverage: number): number {
  return passRate * 60 + coverage * 0.4;
}

function calcLintScore(errors: number, warnings: number): number {
  return Math.max(0, 100 - errors * 5 - warnings);
}

function calcFormatScore(violations: number): number {
  return Math.max(0, 100 - violations * 3);
}

function calcBundleScore(buildSuccess: boolean, totalBytes: number): number {
  if (!buildSuccess) return 0;
  const kb = totalBytes / 1024;
  return Math.max(0, 100 - Math.max(0, kb - 500) / 10);
}

function calcDepsScore(
  vulns: { critical: number; high: number; moderate: number },
  outdated: number
): number {
  return Math.max(0, 100 - vulns.critical * 25 - vulns.high * 10 - vulns.moderate * 3 - outdated);
}

export function CodeQualityMetricCards({ snapshot }: Props) {
  if (!snapshot) return null;

  const { tests, lint, typescript, format, bundle, dependencies } = snapshot;
  const passRate = tests.total > 0 ? tests.passed / tests.total : 1;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <MetricCard
        label="TypeScript"
        lines={[{ label: "Errors", value: String(typescript.errorCount) }]}
        score={calcTypescriptScore(typescript.errorCount)}
      />
      <MetricCard
        label="Tests"
        lines={[
          { label: "Pass/Fail", value: `${tests.passed}/${tests.total}` },
          { label: "Coverage", value: `${tests.coveragePercent.toFixed(1)}%` },
        ]}
        score={calcTestScore(passRate, tests.coveragePercent)}
      />
      <MetricCard
        label="Lint"
        lines={[
          { label: "Errors", value: String(lint.errorCount) },
          { label: "Warnings", value: String(lint.warningCount) },
        ]}
        score={calcLintScore(lint.errorCount, lint.warningCount)}
      />
      <MetricCard
        label="Format"
        lines={[{ label: "Violations", value: String(format.violationCount) }]}
        score={calcFormatScore(format.violationCount)}
      />
      <MetricCard
        label="Bundle"
        lines={[
          { label: "Build", value: bundle.buildSuccess ? "Pass" : "FAIL" },
          { label: "Size", value: `${(bundle.totalSizeBytes / 1024).toFixed(0)}KB` },
        ]}
        score={calcBundleScore(bundle.buildSuccess, bundle.totalSizeBytes)}
      />
      <MetricCard
        label="Dependencies"
        lines={[
          {
            label: "Vulnerabilities",
            value: `${dependencies.vulnerabilities.critical}C ${dependencies.vulnerabilities.high}H ${dependencies.vulnerabilities.moderate}M`,
          },
          { label: "Outdated", value: String(dependencies.outdatedCount) },
        ]}
        score={calcDepsScore(dependencies.vulnerabilities, dependencies.outdatedCount)}
      />
    </div>
  );
}
