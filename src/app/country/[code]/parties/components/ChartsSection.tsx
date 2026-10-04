"use client";

import { useState } from "react";
import { Party, OrgParty, PartyTrendPoint } from "../partiesTypes";
import { DonutChart } from "./DonutChart";
import { DonutChartBase } from "./DonutChartBase";
import { PartyTrendChart } from "./PartyTrendChart";
import {
  PARTY_LABEL_CLASS,
  PARTY_SECTION_HEADING_CLASS,
  PARTY_SUBHEADING_CLASS,
  PartySwatch,
} from "@/components/party/partyPageStyles";

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

  const segmentClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-body font-medium transition-colors ${
      active ? "bg-card-elevated text-foreground" : "text-muted hover:text-foreground"
    }`;

  return (
    <div className="mb-12 space-y-12">
      <section aria-labelledby="power-briefing-title">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="power-briefing-title" className={PARTY_SECTION_HEADING_CLASS}>
            Balance of power
          </h2>
          <p className={PARTY_LABEL_CLASS}>Membership share</p>
        </div>

        <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(16rem,1fr)]">
          <div className="min-w-0">
            <div
              className="flex h-4 w-full overflow-hidden rounded-sm bg-track"
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
            <ol className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {rankedParties.map((party, index) => {
                const share = totalMembers ? (party.memberCount / totalMembers) * 100 : 0;
                return (
                  <li key={party.id} className="flex min-w-0 items-center gap-2 text-body">
                    <PartySwatch color={party.color} />
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      <span className="tabular-nums text-muted">{index + 1}.</span> {party.name}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-foreground">
                      {share.toFixed(1)}%
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
            <div className="min-w-0">
              <dt className={PARTY_LABEL_CLASS}>
                {leadingParty?.regimeStatus === "ruling" ? "Ruling party" : "Largest party"}
              </dt>
              <dd className="mt-1 line-clamp-2 break-words text-heading font-semibold text-foreground">
                {leadingParty?.name ?? "No leader"}
              </dd>
              <dd className="mt-1 text-body-sm text-muted">
                {leadingParty
                  ? `${leadingParty.memberCount.toLocaleString("en-US")} members · ${
                      totalMembers
                        ? ((leadingParty.memberCount / totalMembers) * 100).toFixed(1)
                        : "0.0"
                    }% share`
                  : "No party membership recorded"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className={PARTY_LABEL_CLASS}>Strongest momentum</dt>
              <dd className="mt-1 line-clamp-2 break-words text-heading font-semibold text-foreground">
                {biggestMover?.party.name ?? "Awaiting history"}
              </dd>
              <dd
                className={`mt-1 text-body-sm ${
                  !biggestMover
                    ? "text-muted"
                    : biggestMover.change > 0
                      ? "font-medium text-success"
                      : "font-medium text-error"
                }`}
              >
                {biggestMover
                  ? `${biggestMover.change > 0 ? "+" : ""}${biggestMover.change.toLocaleString("en-US")} members last turn`
                  : "Two turns of data are needed"}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section aria-labelledby="party-charts-title">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="party-charts-title" className={PARTY_SECTION_HEADING_CLASS}>
              Party charts
            </h2>
            <p className="mt-1 text-body text-muted">
              Switch between live snapshots and party trend lines.
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-card-border p-1">
            <button
              type="button"
              onClick={() => setMode("trend")}
              className={segmentClass(mode === "trend")}
            >
              Trend
            </button>
            <button
              type="button"
              onClick={() => setMode("snapshot")}
              className={segmentClass(mode === "snapshot")}
            >
              Snapshot
            </button>
          </div>
        </div>

        {mode === "trend" ? (
          <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
              <label className="space-y-1">
                <span className={`block font-medium ${PARTY_LABEL_CLASS}`}>Party</span>
                <select
                  value={resolvedPartyId}
                  onChange={(e) => setSelectedPartyId(e.target.value)}
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-body text-foreground outline-none transition-colors focus:border-primary"
                >
                  {parties.map((party) => (
                    <option key={party.id} value={party.id}>
                      {party.abbreviation} - {party.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="space-y-1 lg:min-w-56">
                <span className={`block font-medium ${PARTY_LABEL_CLASS}`}>Series</span>
                <div className="inline-flex w-full rounded-lg border border-card-border p-1">
                  <button
                    type="button"
                    onClick={() => setTrendSeries("membership")}
                    className={`flex-1 ${segmentClass(trendSeries === "membership")}`}
                  >
                    Membership
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrendSeries("organization")}
                    className={`flex-1 ${segmentClass(trendSeries === "organization")}`}
                  >
                    Organization
                  </button>
                </div>
              </div>

              {trendSeries === "membership" ? (
                <label className="space-y-1 lg:min-w-56">
                  <span className={`block font-medium ${PARTY_LABEL_CLASS}`}>
                    Membership detail
                  </span>
                  <div className="inline-flex w-full rounded-lg border border-card-border p-1">
                    <button
                      type="button"
                      onClick={() => setIncludeNpps(false)}
                      className={`flex-1 ${segmentClass(!includeNpps)}`}
                    >
                      Players only
                    </button>
                    <button
                      type="button"
                      onClick={() => setIncludeNpps(true)}
                      className={`flex-1 ${segmentClass(includeNpps)}`}
                    >
                      With NPPs
                    </button>
                  </div>
                </label>
              ) : (
                <div className="hidden lg:block" />
              )}
            </div>

            {selectedParty ? (
              <PartyTrendChart
                history={selectedHistory}
                partyName={selectedParty.name}
                partyColor={selectedParty.color}
                series={trendSeries}
                includeNpps={includeNpps}
              />
            ) : (
              <div className="flex h-40 items-center justify-center text-body text-muted">
                No party selected.
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2">
            {parties.length > 0 && (
              <div>
                <h3 className={`mb-4 ${PARTY_SUBHEADING_CLASS}`}>Membership</h3>
                <DonutChart parties={parties} />
              </div>
            )}
            {orgParties.length > 0 && (
              <div>
                <h3 className={`mb-4 ${PARTY_SUBHEADING_CLASS}`}>Organization</h3>
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
      </section>
    </div>
  );
}
