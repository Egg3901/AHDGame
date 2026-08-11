"use client";

import Link from "next/link";
import { CoalitionLogo } from "@/components/CoalitionLogo";
import { DiscordInviteButton } from "@/components/DiscordInviteButton";
import type { CoalitionListItem } from "../coalitionTypes";

interface CoalitionCardProps {
  coalition: CoalitionListItem;
  effectiveCountry: string;
}

export function CoalitionCard({ coalition, effectiveCountry }: CoalitionCardProps) {
  const href = `/country/${effectiveCountry}/parties/coalition/${coalition.id}`;
  const visibleMemberParties = coalition.memberParties.slice(0, 5);
  const hiddenPartyCount = Math.max(
    0,
    coalition.memberParties.length - visibleMemberParties.length
  );

  return (
    <article className="group overflow-hidden rounded-xl border border-card-border bg-card shadow-card transition hover:border-primary/40 hover:shadow-panel">
      <div className="h-1.5" style={{ backgroundColor: coalition.color }} />
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Link href={href} className="flex min-w-0 flex-1 items-center gap-3">
            <CoalitionLogo
              coalitionId={coalition.id}
              coalitionColor={coalition.color}
              size="h-12 w-12"
              className="shrink-0"
              logoUrl={coalition.logoUrl}
              countryId={coalition.countryId}
            />
            <div className="min-w-0">
              <h3 className="truncate text-heading-sm font-bold transition-colors group-hover:text-primary">
                {coalition.name}
              </h3>
              <span className="text-body-sm font-bold" style={{ color: coalition.color }}>
                {coalition.abbreviation}
              </span>
            </div>
          </Link>
          <DiscordInviteButton inviteUrl={coalition.discordInviteUrl} entityName={coalition.name} />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-card-muted/60 p-3">
            <p className="text-body-xs text-muted">Member parties</p>
            <p className="mt-1 text-heading font-bold tabular-nums">{coalition.partyCount}</p>
          </div>
          <div className="rounded-lg bg-card-muted/60 p-3">
            <p className="text-body-xs text-muted">Combined members</p>
            <p className="mt-1 text-heading font-bold tabular-nums">
              {coalition.totalMembers.toLocaleString("en-US")}
            </p>
          </div>
        </div>

        <div className="mt-4 flex min-w-0 items-center justify-between gap-3 text-body-sm">
          <span className="text-muted">Chair</span>
          <span
            className={`truncate font-semibold ${coalition.chairName ? "" : "italic text-muted"}`}
          >
            {coalition.chairName ?? "Vacant"}
          </span>
        </div>

        {visibleMemberParties.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5 border-t border-card-border pt-4">
            {visibleMemberParties.map((party) => (
              <span
                key={party.partyId}
                className="rounded-full border border-card-border bg-card-muted px-2 py-1 text-body-xs font-bold"
                title={party.name}
              >
                <span style={{ color: party.color }}>{party.abbreviation}</span>
              </span>
            ))}
            {hiddenPartyCount > 0 && (
              <span className="rounded-full border border-card-border px-2 py-1 text-body-xs text-muted">
                +{hiddenPartyCount} more
              </span>
            )}
          </div>
        )}

        <Link
          href={href}
          className="mt-4 flex items-center justify-between rounded-lg border border-card-border bg-card-muted/30 px-3 py-2 text-body-sm font-semibold transition-colors hover:border-primary/40 hover:text-primary"
        >
          Open coalition briefing <span aria-hidden>→</span>
        </Link>
      </div>
    </article>
  );
}
