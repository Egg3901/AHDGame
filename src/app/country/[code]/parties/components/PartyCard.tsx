"use client";

import Link from "next/link";
import { PartyLogo } from "@/components/PartyLogo";
import { DiscordInviteButton } from "@/components/DiscordInviteButton";
import { Avatar } from "@/components/Avatar";
import { PlainPositionLabel } from "@/components/party/PlainPositionLabel";
import {
  PARTY_LABEL_CLASS,
  PARTY_LINK_CLASS,
  PARTY_SMALL_VALUE_CLASS,
  PARTY_VALUE_CLASS,
  PartySwatch,
  regimeStatusLabel,
} from "@/components/party/partyPageStyles";
import { Party } from "../partiesTypes";
import { formatPartyCountryMoney } from "@/lib/utils/formatters";

interface PartyCardProps {
  party: Party;
  effectiveCountry: string;
  rank: number;
  totalMembers: number;
  momentum: number | null;
}

export function PartyCard({
  party,
  effectiveCountry,
  rank,
  totalMembers,
  momentum,
}: PartyCardProps) {
  const share = totalMembers ? (party.memberCount / totalMembers) * 100 : 0;
  const tier = party.tier ?? (party.isDefault ? "major" : "minor");
  const regimeLabel = regimeStatusLabel(party.regimeStatus);
  const treasury = formatPartyCountryMoney(party.treasury, party.countryId);
  const href = `/country/${effectiveCountry}/parties/${party.id}`;

  return (
    <article className="card-hover rounded-xl border border-card-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="w-6 shrink-0 pt-1 text-body font-semibold tabular-nums text-muted">
          {rank}
        </span>
        <Link href={href} className="group flex min-w-0 flex-1 items-center gap-3">
          <PartyLogo
            partyId={party.id}
            partyColor={party.color}
            size="h-12 w-12"
            className="shrink-0"
            countryId={party.countryId}
          />
          <div className="min-w-0">
            <h3 className="flex items-baseline gap-2 text-heading-sm font-semibold text-foreground">
              <PartySwatch color={party.color} className="self-center" />
              <span className="line-clamp-2 break-words group-hover:underline group-hover:underline-offset-4">
                {party.name}
              </span>
            </h3>
            <p className="mt-0.5 text-body-sm text-muted">
              <span className="font-medium text-foreground">{party.abbreviation}</span>
              {regimeLabel && <> · {regimeLabel}</>}
              {tier === "major" ? " · Major party" : " · Minor party"}
            </p>
          </div>
        </Link>
        <DiscordInviteButton inviteUrl={party.discordInviteUrl} entityName={party.name} />
      </div>

      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-body-sm text-muted">
          <span className={PARTY_VALUE_CLASS}>{share.toFixed(1)}%</span> membership share
        </p>
        <p
          className={`text-body-sm ${
            momentum === null || momentum === 0
              ? "text-muted"
              : momentum > 0
                ? "font-medium text-success"
                : "font-medium text-error"
          }`}
        >
          {momentum === null
            ? "No trend yet"
            : momentum === 0
              ? "No change"
              : `${momentum > 0 ? "▲" : "▼"} ${Math.abs(momentum)} last turn`}
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className={PARTY_LABEL_CLASS}>Members</dt>
          <dd className={PARTY_SMALL_VALUE_CLASS}>{party.memberCount.toLocaleString("en-US")}</dd>
        </div>
        <div className="min-w-0">
          <dt className={PARTY_LABEL_CLASS}>Players</dt>
          <dd className={PARTY_SMALL_VALUE_CLASS}>{party.playerCount}</dd>
        </div>
        <div className="min-w-0">
          <dt className={PARTY_LABEL_CLASS}>NPPs</dt>
          <dd className={PARTY_SMALL_VALUE_CLASS}>{party.nppCount}</dd>
        </div>
        <div className="min-w-0">
          <dt className={PARTY_LABEL_CLASS}>Treasury</dt>
          <dd className={`truncate ${PARTY_SMALL_VALUE_CLASS}`} title={treasury}>
            {treasury}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={PARTY_LABEL_CLASS}>Economic</dt>
          <dd className="text-body text-foreground">
            <PlainPositionLabel value={party.economicPosition} axis="economic" />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={PARTY_LABEL_CLASS}>Social</dt>
          <dd className="text-body text-foreground">
            <PlainPositionLabel value={party.socialPosition} axis="social" />
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-col gap-3 border-t border-card-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2 text-body">
          {party.chair ? (
            <Link
              href={`/character/${party.chair.sequentialId ?? party.chair.id}`}
              className="flex min-w-0 items-center gap-2 text-muted hover:text-foreground"
            >
              <Avatar
                url={party.chair.avatarUrl}
                name={party.chair.name}
                size="h-7 w-7"
                className="shrink-0 rounded-md"
                borderKey={party.chair.borderKey}
                tintColor={party.chair.tintColor}
              />
              <span className="truncate">
                Chair: <span className="text-foreground">{party.chair.name}</span>
              </span>
            </Link>
          ) : (
            <span className="text-muted">Chair vacant</span>
          )}
        </div>
        <Link href={href} className={`shrink-0 text-body ${PARTY_LINK_CLASS}`}>
          Open party headquarters <span aria-hidden>→</span>
        </Link>
      </div>
    </article>
  );
}
