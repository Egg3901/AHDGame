"use client";

import Link from "next/link";
import { PositionLabel } from "@/components/PositionLabel";
import { Avatar } from "@/components/Avatar";
import type { PartyData, PartyLeader } from "./types";
import { POSITIONS, getPositionLabels, POSITION_DESC } from "./helpers";

// ─── Props ────────────────────────────────────────────────────────────────────

interface PartyOverviewPanelProps {
  party: PartyData;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PartyOverviewPanel({ party }: PartyOverviewPanelProps) {
  const positionLabels = getPositionLabels(party.countryId);
  const strengthPercent =
    party.effectivePsCap > 0
      ? Math.min(100, Math.max(0, ((party.politicalStrength ?? 0) / party.effectivePsCap) * 100))
      : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
      <section aria-labelledby="leadership-title" className="min-w-0">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <p className="text-body-xs font-bold uppercase tracking-widest text-primary">
              Who holds power
            </p>
            <h2 id="leadership-title" className="text-heading-lg font-extrabold tracking-tight">
              National leadership
            </h2>
          </div>
          <span className="font-mono text-body-sm text-muted">3 offices</span>
        </div>

        <div className="overflow-hidden rounded-xl border border-card-border bg-card shadow-card">
          {POSITIONS.map((pos) => {
            const leader = party[pos] as PartyLeader | null;

            return (
              <div
                key={pos}
                className="group grid gap-3 border-b border-card-border p-4 last:border-b-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center sm:p-5"
              >
                <div>
                  <p className="text-body-xs font-bold uppercase tracking-widest text-muted">
                    {positionLabels[pos]}
                  </p>
                  <p className="mt-1 text-body-xs leading-relaxed text-muted">
                    {POSITION_DESC[pos]}
                  </p>
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  {leader ? (
                    <>
                      <Avatar
                        url={leader.avatarUrl}
                        name={leader.name}
                        size="h-12 w-12"
                        className="shrink-0 ring-2 ring-card-border"
                      />
                      <Link
                        href={`/character/${leader.sequentialId ?? leader.id}`}
                        className="min-w-0 truncate text-heading-sm font-bold transition-colors group-hover:text-primary"
                      >
                        {leader.name}
                      </Link>
                    </>
                  ) : (
                    <>
                      <div
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-muted bg-muted/10 text-muted"
                        aria-hidden
                      >
                        —
                      </div>
                      <span className="text-heading-sm font-semibold italic text-muted">
                        Vacant
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="platform-title" className="min-w-0">
        <div className="mb-3">
          <p className="text-body-xs font-bold uppercase tracking-widest text-secondary">
            Political identity
          </p>
          <h2 id="platform-title" className="text-heading-lg font-extrabold tracking-tight">
            Party platform
          </h2>
        </div>

        <div className="overflow-hidden rounded-xl border border-card-border bg-card shadow-card">
          <div className="border-b border-card-border bg-card-muted/60 p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-body-xs font-bold uppercase tracking-widest text-muted">
                  Strength capacity
                </p>
                <p className="mt-1 font-mono text-heading-lg font-extrabold tabular-nums">
                  {strengthPercent.toFixed(0)}%
                </p>
              </div>
              <p className="text-right text-body-sm text-muted">
                <span className="font-semibold text-foreground">
                  {(party.politicalStrength ?? 0).toFixed(1)}
                </span>{" "}
                of {party.effectivePsCap}
              </p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-track">
              <div
                className="h-full rounded-full bg-info transition-[width] duration-500"
                style={{ width: `${strengthPercent}%` }}
              />
            </div>
          </div>

          <div className="divide-y divide-card-border">
            <IdeologyAxis
              label="Economic policy"
              descriptor="Left to right"
              value={party.economicPosition}
              axis="economic"
              start="Socialist"
              end="Laissez-faire"
              barClassName="bg-primary"
            />
            <IdeologyAxis
              label="Social policy"
              descriptor="Liberal to conservative"
              value={party.socialPosition}
              axis="social"
              start="Progressive"
              end="Traditional"
              barClassName="bg-secondary"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function IdeologyAxis({
  label,
  descriptor,
  value,
  axis,
  start,
  end,
  barClassName,
}: {
  label: string;
  descriptor: string;
  value: number;
  axis: "economic" | "social";
  start: string;
  end: string;
  barClassName: string;
}) {
  const percent = Math.min(100, Math.max(0, ((value + 5) / 10) * 100));

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-body-xs font-bold uppercase tracking-widest text-muted">{label}</p>
          <p className="mt-0.5 text-body-xs text-muted">{descriptor}</p>
        </div>
        <PositionLabel value={value} axis={axis} className="font-bold" />
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-track">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${barClassName}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between gap-3 text-body-xs text-muted">
        <span>{start}</span>
        <span className="text-right">{end}</span>
      </div>
    </div>
  );
}
