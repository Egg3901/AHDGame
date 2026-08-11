"use client";

import type { CodeQualitySnapshot } from "@/lib/db/types";

interface Props {
  snapshot: CodeQualitySnapshot | null;
}

function getScoreColor(score: number): string {
  if (score >= 90) return "text-green-500";
  if (score >= 70) return "text-yellow-500";
  if (score >= 50) return "text-orange-500";
  return "text-red-500";
}

function getScoreBg(score: number): string {
  if (score >= 90) return "border-green-500/30";
  if (score >= 70) return "border-yellow-500/30";
  if (score >= 50) return "border-orange-500/30";
  return "border-red-500/30";
}

function ScoreGauge({ label, score }: { label: string; score: number }) {
  return (
    <div
      className={`flex flex-col items-center rounded-xl border-2 bg-card p-6 shadow-sm ${getScoreBg(score)}`}
    >
      <p className="mb-1 text-xs text-muted">{label}</p>
      <p className={`text-4xl font-bold ${getScoreColor(score)}`}>{Math.round(score)}</p>
      <p className="mt-1 text-xs text-muted">/ 100</p>
    </div>
  );
}

export function CodeQualityScoreGauges({ snapshot }: Props) {
  if (!snapshot) {
    return <p className="text-sm text-muted">No code quality data available.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-8">
        <ScoreGauge label="Overall Quality" score={snapshot.overallScore} />
        <ScoreGauge label="Mobile Quality" score={snapshot.mobileScore} />
      </div>
      <div className="text-center text-xs text-muted">
        <span className="font-medium">{snapshot.environment}</span> — Build:{" "}
        <span className="font-mono">{snapshot.gitSha.slice(0, 7)}</span> — Branch:{" "}
        {snapshot.gitBranch}
      </div>
    </div>
  );
}
