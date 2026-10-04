"use client";

import Link from "next/link";
import { CoalitionLogo } from "@/components/CoalitionLogo";
import { DiscordInviteButton } from "@/components/DiscordInviteButton";
import {
  PARTY_LABEL_CLASS,
  PARTY_LINK_CLASS,
  PARTY_SMALL_VALUE_CLASS,
  PartySwatch,
} from "@/components/party/partyPageStyles";
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
    <article className="card-hover rounded-xl border border-card-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Link href={href} className="group flex min-w-0 flex-1 items-center gap-3">
          <CoalitionLogo
            coalitionId={coalition.id}
            coalitionColor={coalition.color}
            size="h-12 w-12"
            className="shrink-0"
            logoUrl={coalition.logoUrl}
            countryId={coalition.countryId}
          />
          <div className="min-w-0">
            <h3 className="flex items-baseline gap-2 text-heading-sm font-semibold text-foreground">
              <PartySwatch color={coalition.color} className="self-center" />
              <span className="line-clamp-2 break-words group-hover:underline group-hover:underline-offset-4">
                {coalition.name}
              </span>
            </h3>
            <p className="mt-0.5 text-body-sm font-medium text-foreground">
              {coalition.abbreviation}
            </p>
          </div>
        </Link>
        <DiscordInviteButton inviteUrl={coalition.discordInviteUrl} entityName={coalition.name} />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className={PARTY_LABEL_CLASS}>Member parties</dt>
          <dd className={PARTY_SMALL_VALUE_CLASS}>{coalition.partyCount}</dd>
        </div>
        <div className="min-w-0">
          <dt className={PARTY_LABEL_CLASS}>Combined members</dt>
          <dd className={PARTY_SMALL_VALUE_CLASS}>
            {coalition.totalMembers.toLocaleString("en-US")}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={PARTY_LABEL_CLASS}>Chair</dt>
          <dd
            className={`truncate text-body-lg ${
              coalition.chairName ? "font-semibold text-foreground" : "text-muted"
            }`}
          >
            {coalition.chairName ?? "Vacant"}
          </dd>
        </div>
      </dl>

      {visibleMemberParties.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-body-sm">
          {visibleMemberParties.map((party) => (
            <li
              key={party.partyId}
              className="inline-flex items-center gap-1.5 font-medium text-foreground"
              title={party.name}
            >
              <PartySwatch color={party.color} />
              {party.abbreviation}
            </li>
          ))}
          {hiddenPartyCount > 0 && <li className="text-muted">+{hiddenPartyCount} more</li>}
        </ul>
      )}

      <div className="mt-5 border-t border-card-border pt-4">
        <Link href={href} className={`text-body ${PARTY_LINK_CLASS}`}>
          Open coalition briefing <span aria-hidden>→</span>
        </Link>
      </div>
    </article>
  );
}
