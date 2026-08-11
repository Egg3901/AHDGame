"use client";

import type { GameHealthSnapshot } from "@/lib/db/types";

interface Props {
  snapshot: GameHealthSnapshot | null;
}

export function GameHealthSummaryCards({ snapshot }: Props) {
  if (!snapshot) {
    return <p className="text-sm text-muted">No health data available yet.</p>;
  }

  const cards = [
    {
      label: "Last Turn",
      value: `${snapshot.turnProcessing.durationMs.toLocaleString("en-US")}ms`,
      sub: `Turn ${snapshot.turn}`,
    },
    {
      label: "Warnings",
      value: String(snapshot.turnProcessing.warningCount),
      sub: "last 24h",
      color: snapshot.turnProcessing.warningCount > 0 ? "text-yellow-500" : "text-green-500",
    },
    {
      label: "Errors",
      value: String(snapshot.turnProcessing.errorCount),
      sub: "last 24h",
      color: snapshot.turnProcessing.errorCount > 0 ? "text-red-500" : "text-green-500",
    },
    {
      label: "Integrity",
      value: snapshot.dataIntegrity ? `${snapshot.dataIntegrity.issues.length} issues` : "Skipped",
      sub: snapshot.dataIntegrity ? `Turn ${snapshot.dataIntegrity.lastCheckTurn}` : "—",
      color:
        snapshot.dataIntegrity && snapshot.dataIntegrity.issues.length > 0
          ? "text-orange-500"
          : "text-green-500",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-lg border border-border bg-card p-3 text-center shadow-sm"
        >
          <p className="text-xs text-muted">{card.label}</p>
          <p className={`text-xl font-bold ${card.color ?? "text-foreground"}`}>{card.value}</p>
          <p className="text-xs text-muted">{card.sub}</p>
        </div>
      ))}
    </div>
  );
}
