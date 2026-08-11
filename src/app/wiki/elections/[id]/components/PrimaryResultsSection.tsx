"use client";

import React, { memo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { SectionLabel } from "@/components/ui";
import { formatPct } from "../wikiElectionHelpers";
import type { PrimaryResult, PrimarySnapshotPoint } from "../wikiElectionTypes";

interface PrimaryResultsSectionProps {
  primaryResults: PrimaryResult[];
  snapshotHistory?: PrimarySnapshotPoint[];
}

// Generate distinct shades of a hex color for multiple candidates in the same party
function shadedColor(hex: string, index: number, total: number): string {
  if (total <= 1) return hex;
  // Lighten progressively for later candidates
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const factor = 1 - index * (0.45 / Math.max(total - 1, 1));
  const blend = (c: number) => Math.round(c * factor + 255 * (1 - factor));
  return `rgb(${blend(r)},${blend(g)},${blend(b)})`;
}

const PrimaryTrendChart = memo(function PrimaryTrendChart({
  partyId,
  partyName,
  partyColor,
  candidates,
  snapshotHistory,
}: {
  partyId: string;
  partyName: string;
  partyColor: string;
  candidates: PrimaryResult["candidates"];
  snapshotHistory: PrimarySnapshotPoint[];
}) {
  // Build [{ t: N, "Candidate A": 45.2, ... }, ...]
  const data = snapshotHistory
    .map((snap, i) => {
      const entries = snap.byParty[partyId] ?? [];
      const row: Record<string, number | string> = { t: i + 1 };
      for (const e of entries) {
        row[e.characterName] = Math.round(e.sharePct * 10) / 10;
      }
      return row;
    })
    .filter((row) => Object.keys(row).length > 1); // skip snapshots missing this party

  if (data.length < 2) return null;

  const names = candidates.map((c) => c.characterName);

  // Reduce x-axis tick density for readability
  const tickInterval = Math.max(1, Math.floor(data.length / 8));

  return (
    <div className="mb-4">
      <p className="text-xs text-muted mb-2 font-medium uppercase tracking-wide">
        {partyName} — Share Over Time
      </p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="t"
            tick={{ fontSize: 10, fill: "var(--color-muted)" }}
            interval={tickInterval - 1}
            tickLine={false}
            axisLine={false}
            label={{
              value: "Turn",
              position: "insideBottomRight",
              offset: 0,
              fontSize: 10,
              fill: "var(--color-muted)",
            }}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: "var(--color-muted)" }}
            tickFormatter={(v) => `${v}%`}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <RechartsTooltip
            contentStyle={{
              backgroundColor: "var(--color-card)",
              border: "1px solid var(--color-card-border)",
              borderRadius: "8px",
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--color-muted)", marginBottom: 4 }}
            labelFormatter={(v) => `Turn ${v}`}
            formatter={(value) => [
              typeof value === "number" ? `${value.toFixed(1)}%` : String(value),
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
            formatter={(value) => <span style={{ color: "var(--color-muted)" }}>{value}</span>}
          />
          {names.map((name, i) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              stroke={shadedColor(partyColor, i, names.length)}
              strokeWidth={i === 0 ? 2 : 1.5}
              dot={false}
              activeDot={{ r: 3 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

export const PrimaryResultsSection = memo(function PrimaryResultsSection({
  primaryResults,
  snapshotHistory,
}: PrimaryResultsSectionProps) {
  const [showTrend, setShowTrend] = useState(true);

  if (primaryResults.length === 0) return null;

  const hasTrend = snapshotHistory && snapshotHistory.length >= 2;

  return (
    <section className="mb-10 rounded-xl border border-card-border bg-card/40 p-6 shadow-panel">
      <div className="flex items-center justify-between mb-1">
        <SectionLabel as="h3">Primary Results by Party</SectionLabel>
        {hasTrend && (
          <button
            onClick={() => setShowTrend((v) => !v)}
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            {showTrend ? "Hide trend" : "Show trend"}
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-muted">
        The primary phase determined each party&apos;s nominee through competitive intra-party
        contests. Results reflect weighted primary scores incorporating campaign performance
        metrics. The candidate with the highest score in each party secured that party&apos;s
        nomination for the general election.
      </p>
      <div className="space-y-6">
        {primaryResults.map((party) => (
          <div key={party.partyId} className="rounded-lg border border-card-border bg-card/60 p-4">
            <h3 className="mb-3 font-medium" style={{ color: party.partyColor }}>
              {party.partyName}
            </h3>

            {/* Trendline chart */}
            {hasTrend && showTrend && (
              <PrimaryTrendChart
                partyId={party.partyId}
                partyName={party.partyName}
                partyColor={party.partyColor}
                candidates={party.candidates}
                snapshotHistory={snapshotHistory!}
              />
            )}

            {/* Share bars */}
            <div className="mb-4 space-y-2">
              {party.candidates.map((candidate) => (
                <div key={`primary-bar-${party.partyId}-${candidate.characterName}`}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                    <span className="truncate font-medium text-foreground">
                      {candidate.characterName}
                    </span>
                    <span className="font-mono text-muted">{formatPct(candidate.sharePct)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-card-elevated">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(candidate.sharePct, candidate.primaryScore > 0 ? 1 : 0)}%`,
                        backgroundColor: party.partyColor,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Detail table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-card-elevated">
                  <tr className="border-b border-card-border text-left">
                    <th className="pb-2 pr-4 font-medium text-foreground">Candidate</th>
                    <th className="pb-2 pr-4 font-medium text-foreground">Primary Score</th>
                    <th className="pb-2 pr-4 font-medium text-foreground">Share</th>
                    <th className="pb-2 font-medium text-foreground">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {party.candidates.map((c) => (
                    <tr
                      key={c.characterName}
                      className="border-b border-card-border/50 last:border-0 hover:bg-card-elevated/30 transition-colors"
                    >
                      <td className="py-2 pr-4 font-medium text-foreground">{c.characterName}</td>
                      <td className="py-2 pr-4 text-muted">{c.primaryScore.toFixed(1)}</td>
                      <td className="py-2 pr-4 text-muted">{formatPct(c.sharePct)}</td>
                      <td className="py-2">
                        {c.won ? (
                          <span className="rounded bg-success/10 border border-success/25 px-2 py-0.5 text-xs font-medium text-success">
                            Nominee
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
});
