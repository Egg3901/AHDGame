"use client";

import { useState } from "react";
import { Party, OrgParty, PartyTrendPoint } from "../partiesTypes";
import { DonutChart } from "./DonutChart";
import { DonutChartBase } from "./DonutChartBase";
import { PartyTrendChart } from "./PartyTrendChart";

interface ChartsSectionProps {
  parties: Party[];
  orgParties: OrgParty[];
  partyHistory: PartyTrendPoint[];
  defaultPartyId: string;
}

type ChartMode = "trend" | "snapshot";
type TrendSeries = "membership" | "organization";

export function ChartsSection({
  parties,
  orgParties,
  partyHistory,
  defaultPartyId,
}: ChartsSectionProps) {
  const [mode, setMode] = useState<ChartMode>("snapshot");
  const [selectedPartyId, setSelectedPartyId] = useState(defaultPartyId);
  const [trendSeries, setTrendSeries] = useState<TrendSeries>("membership");
  const [includeNpps, setIncludeNpps] = useState(true);

  const resolvedPartyId =
    selectedPartyId && parties.some((party) => party.id === selectedPartyId)
      ? selectedPartyId
      : defaultPartyId || parties[0]?.id || "";
  const selectedParty = parties.find((party) => party.id === resolvedPartyId) ?? parties[0] ?? null;
  const selectedHistory = partyHistory
    .filter((point) => point.partyId === (selectedParty?.id ?? ""))
    .sort((a, b) => a.turn - b.turn);

  const totalMembers = parties.reduce((sum, party) => sum + party.memberCount, 0);
  const rankedParties = [...parties].sort((a, b) => b.memberCount - a.memberCount);
  const leadingParty = parties.find((party) => party.regimeStatus === "ruling") ?? rankedParties[0];
  const momentum = parties
    .map((party) => {
      const history = partyHistory
        .filter((point) => point.partyId === party.id)
        .sort((a, b) => a.turn - b.turn);
      const latest = history.at(-1);
      const previous = history.at(-2);
      return { party, change: latest && previous ? latest.memberCount - previous.memberCount : 0 };
    })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const biggestMover = momentum.find((item) => item.change !== 0);

  if (parties.length === 0 && orgParties.length === 0) return null;

  return (
    <section className="mb-6 space-y-4" aria-labelledby="power-briefing-title">
      <div className="overflow-hidden rounded-xl border border-card-border bg-card shadow-card">
        <div className="grid lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,1fr)]">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-body-xs font-bold uppercase tracking-widest text-muted">
                  National picture
                </p>
                <h2 id="power-briefing-title" className="mt-1 text-heading-lg font-extrabold">
                  Balance of power
                </h2>
              </div>
              <span className="rounded-full border border-card-border bg-card-muted px-3 py-1 text-body-xs text-muted">
                Membership share
              </span>
            </div>

            <div
              className="mt-6 flex h-5 w-full overflow-hidden rounded-full bg-track"
              aria-label={`Membership balance across ${parties.length} parties`}
            >
              {rankedParties.map((party) => (
                <div
                  key={party.id}
                  title={`${party.name}: ${totalMembers ? ((party.memberCount / totalMembers) * 100).toFixed(1) : "0.0"}%`}
                  style={{
                    width: `${totalMembers ? (party.memberCount / totalMembers) * 100 : 0}%`,
                    backgroundColor: party.color,
                  }}
                  className="min-w-px border-r border-background/40 last:border-r-0"
                />
              ))}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {rankedParties.map((party, index) => {
                const share = totalMembers ? (party.memberCount / totalMembers) * 100 : 0;
                return (
                  <div key={party.id} className="flex min-w-0 items-center gap-2 text-body-sm">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: party.color }}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {index + 1}. {party.name}
                    </span>
                    <span className="shrink-0 font-mono font-semibold tabular-nums">
                      {share.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid border-t border-card-border bg-card-muted/40 sm:grid-cols-2 lg:grid-cols-1 lg:border-l lg:border-t-0">
            <div className="p-5 sm:p-6">
              <p className="text-body-xs font-bold uppercase tracking-widest text-muted">
                {leadingParty?.regimeStatus === "ruling" ? "Ruling party" : "Largest party"}
              </p>
              <p className="mt-2 truncate text-heading-lg font-extrabold">
                {leadingParty?.name ?? "No leader"}
              </p>
              <p className="mt-1 text-body-sm text-muted">
                {leadingParty
                  ? `${leadingParty.memberCount.toLocaleString("en-US")} members · ${
                      totalMembers
                        ? ((leadingParty.memberCount / totalMembers) * 100).toFixed(1)
                        : "0.0"
                    }% share`
                  : "No party membership recorded"}
              </p>
            </div>
            <div className="border-t border-card-border p-5 sm:border-l sm:border-t-0 sm:p-6 lg:border-l-0 lg:border-t">
              <p className="text-body-xs font-bold uppercase tracking-widest text-muted">
                Strongest momentum
              </p>
              <p className="mt-2 truncate text-heading font-extrabold">
                {biggestMover?.party.name ?? "Awaiting history"}
              </p>
              <p
                className={`mt-1 text-body-sm font-semibold ${
                  !biggestMover
                    ? "text-muted"
                    : biggestMover.change > 0
                      ? "text-success"
                      : "text-error"
                }`}
              >
                {biggestMover
                  ? `${biggestMover.change > 0 ? "+" : ""}${biggestMover.change.toLocaleString("en-US")} members last turn`
                  : "Two turns of data are needed"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">
              Party Charts
            </p>
            <p className="text-sm text-muted">
              Switch between live snapshots and party trend lines.
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-card-border bg-background p-1">
            <button
              type="button"
              onClick={() => setMode("trend")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === "trend"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Trend
            </button>
            <button
              type="button"
              onClick={() => setMode("snapshot")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === "snapshot"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Snapshot
            </button>
          </div>
        </div>

        {mode === "trend" ? (
          <div className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted">
                  Party
                </span>
                <select
                  value={resolvedPartyId}
                  onChange={(e) => setSelectedPartyId(e.target.value)}
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
                >
                  {parties.map((party) => (
                    <option key={party.id} value={party.id}>
                      {party.abbreviation} - {party.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="space-y-1 lg:min-w-56">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted">
                  Series
                </span>
                <div className="inline-flex w-full rounded-lg border border-card-border bg-background p-1">
                  <button
                    type="button"
                    onClick={() => setTrendSeries("membership")}
                    className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      trendSeries === "membership"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    Membership
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrendSeries("organization")}
                    className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      trendSeries === "organization"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    Organization
                  </button>
                </div>
              </div>

              {trendSeries === "membership" ? (
                <label className="space-y-1 lg:min-w-56">
                  <span className="text-xs font-semibold uppercase tracking-widest text-muted">
                    Membership detail
                  </span>
                  <div className="inline-flex w-full rounded-lg border border-card-border bg-background p-1">
                    <button
                      type="button"
                      onClick={() => setIncludeNpps(false)}
                      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        !includeNpps
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      Players only
                    </button>
                    <button
                      type="button"
                      onClick={() => setIncludeNpps(true)}
                      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        includeNpps
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      With NPPs
                    </button>
                  </div>
                </label>
              ) : (
                <div className="hidden lg:block" />
              )}
            </div>

            <div className="rounded-xl border border-card-border bg-card-muted/20 p-4">
              {selectedParty ? (
                <PartyTrendChart
                  history={selectedHistory}
                  partyName={selectedParty.name}
                  partyColor={selectedParty.color}
                  series={trendSeries}
                  includeNpps={includeNpps}
                />
              ) : (
                <div className="flex h-40 items-center justify-center text-sm text-muted">
                  No party selected.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:divide-x sm:divide-card-border">
            {parties.length > 0 && (
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">
                  Membership
                </p>
                <DonutChart parties={parties} />
              </div>
            )}
            {orgParties.length > 0 && (
              <div className="sm:pl-6">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">
                  Organization
                </p>
                <DonutChartBase
                  items={orgParties.map((p) => ({
                    id: p.id,
                    name: p.name,
                    abbreviation: p.abbreviation,
                    color: p.color,
                    value: p.totalOrg,
                  }))}
                  centerLabel="total org"
                  formatValue={(v) => v.toLocaleString("en-US")}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
