"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { PlainPositionLabel } from "@/components/party/PlainPositionLabel";
import {
  PARTY_LABEL_CLASS,
  PARTY_SECTION_HEADING_CLASS,
  PARTY_SUBHEADING_CLASS,
  PARTY_VALUE_CLASS,
} from "@/components/party/partyPageStyles";
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
    <div className="grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
      <section aria-labelledby="leadership-title" className="min-w-0">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="leadership-title" className={PARTY_SECTION_HEADING_CLASS}>
            National leadership
          </h2>
          <p className={PARTY_LABEL_CLASS}>3 offices</p>
        </div>

        <ul className="border-t border-card-border">
          {POSITIONS.map((pos) => {
            const leader = party[pos] as PartyLeader | null;

            return (
              <li
                key={pos}
                className="grid gap-3 border-b border-card-border py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center sm:gap-6"
              >
                <div>
                  <p className="text-body font-semibold text-foreground">{positionLabels[pos]}</p>
                  <p className="mt-0.5 text-body-sm leading-relaxed text-muted">
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
                        className="shrink-0"
                      />
                      <Link
                        href={`/character/${leader.sequentialId ?? leader.id}`}
                        className="min-w-0 line-clamp-2 break-words text-heading-sm font-semibold text-foreground hover:underline hover:underline-offset-4"
                      >
                        {leader.name}
                      </Link>
                    </>
                  ) : (
                    <>
                      <span
                        className="h-12 w-12 shrink-0 rounded-full border border-dashed border-card-border"
                        aria-hidden
                      />
                      <span className="text-heading-sm text-muted">Vacant</span>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="platform-title" className="min-w-0">
        <h2 id="platform-title" className={`mb-4 ${PARTY_SECTION_HEADING_CLASS}`}>
          Party platform
        </h2>

        <div className="space-y-8">
          <div>
            <p className={PARTY_LABEL_CLASS}>Strength capacity</p>
            <div className="mt-0.5 flex items-baseline justify-between gap-3">
              <p className={PARTY_VALUE_CLASS}>{strengthPercent.toFixed(0)}%</p>
              <p className="text-right text-body-sm text-muted">
                <span className="font-semibold tabular-nums text-foreground">
                  {(party.politicalStrength ?? 0).toFixed(1)}
                </span>{" "}
                of {party.effectivePsCap}
              </p>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-card-border" aria-hidden>
              <div
                className="h-full rounded-full bg-foreground/70 transition-[width] duration-500"
                style={{ width: `${strengthPercent}%` }}
              />
            </div>
          </div>

          <IdeologyAxis
            label="Economic policy"
            descriptor="Left to right"
            value={party.economicPosition}
            axis="economic"
            start="Socialist"
            end="Laissez-faire"
          />
          <IdeologyAxis
            label="Social policy"
            descriptor="Liberal to conservative"
            value={party.socialPosition}
            axis="social"
            start="Progressive"
            end="Traditional"
          />
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
}: {
  label: string;
  descriptor: string;
  value: number;
  axis: "economic" | "social";
  start: string;
  end: string;
}) {
  const percent = Math.min(100, Math.max(0, ((value + 5) / 10) * 100));

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className={PARTY_SUBHEADING_CLASS}>{label}</h3>
          <p className="text-body-sm text-muted">{descriptor}</p>
        </div>
        <PlainPositionLabel
          value={value}
          axis={axis}
          className="text-body-lg font-semibold text-foreground"
        />
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-card-border" aria-hidden>
        <div
          className="h-full rounded-full bg-foreground/70 transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between gap-3 text-body-sm text-muted">
        <span>{start}</span>
        <span className="text-right">{end}</span>
      </div>
    </div>
  );
}
