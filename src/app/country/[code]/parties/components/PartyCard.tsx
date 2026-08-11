"use client";

import Link from "next/link";
import { PartyLogo } from "@/components/PartyLogo";
import { PartyRegimeBadge } from "@/components/parties/PartyRegimeBadge";
import { DiscordInviteButton } from "@/components/DiscordInviteButton";
import { Avatar } from "@/components/Avatar";
import { PositionLabel } from "@/components/PositionLabel";
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

  return (
    <article className="group overflow-hidden rounded-xl border border-card-border bg-card shadow-card transition hover:border-primary/40 hover:shadow-panel">
      <div className="h-1.5" style={{ backgroundColor: party.color }} />
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="w-6 shrink-0 pt-1 font-mono text-body-sm font-bold text-muted">
            {rank.toString().padStart(2, "0")}
          </span>
          <Link
            href={`/country/${effectiveCountry}/parties/${party.id}`}
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            <PartyLogo
              partyId={party.id}
              partyColor={party.color}
              size="h-12 w-12"
              className="shrink-0"
              countryId={party.countryId}
            />
            <div className="min-w-0">
              <h3 className="truncate text-heading-sm font-bold transition-colors group-hover:text-primary">
                {party.name}
              </h3>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <span className="text-body-sm font-bold" style={{ color: party.color }}>
                  {party.abbreviation}
                </span>
                <PartyRegimeBadge regimeStatus={party.regimeStatus} />
                <span className="rounded-full border border-card-border px-2 py-0.5 text-body-xs capitalize text-muted">
                  {tier}
                </span>
              </div>
            </div>
          </Link>
          <DiscordInviteButton inviteUrl={party.discordInviteUrl} entityName={party.name} />
        </div>

        <div className="mt-5 grid grid-cols-[1fr_auto] items-end gap-4 border-b border-card-border pb-4">
          <div>
            <p className="text-body-xs font-bold uppercase tracking-widest text-muted">
              Membership share
            </p>
            <p className="mt-1 text-display font-extrabold tabular-nums">{share.toFixed(1)}%</p>
          </div>
          <div className="text-right">
            <p className="text-body-sm text-muted">
              <span className="font-semibold text-foreground">
                {party.memberCount.toLocaleString("en-US")}
              </span>{" "}
              members
            </p>
            <p
              className={`mt-1 text-body-sm font-semibold ${
                momentum === null
                  ? "text-muted"
                  : momentum > 0
                    ? "text-success"
                    : momentum < 0
                      ? "text-error"
                      : "text-muted"
              }`}
            >
              {momentum === null
                ? "No trend yet"
                : momentum === 0
                  ? "No change"
                  : `${momentum > 0 ? "▲" : "▼"} ${Math.abs(momentum)} last turn`}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="min-w-0 rounded-lg bg-card-muted/60 p-3">
            <p className="text-body-xs text-muted">Players</p>
            <p className="mt-1 font-mono text-body-lg font-bold tabular-nums">
              {party.playerCount}
            </p>
          </div>
          <div className="min-w-0 rounded-lg bg-card-muted/60 p-3">
            <p className="text-body-xs text-muted">NPPs</p>
            <p className="mt-1 font-mono text-body-lg font-bold tabular-nums">{party.nppCount}</p>
          </div>
          <div className="min-w-0 rounded-lg bg-card-muted/60 p-3">
            <p className="text-body-xs text-muted">Treasury</p>
            <p
              className="mt-1 truncate font-mono text-body-sm font-bold text-warning"
              title={formatPartyCountryMoney(party.treasury, party.countryId)}
            >
              {formatPartyCountryMoney(party.treasury, party.countryId)}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2 text-body-sm">
            {party.chair ? (
              <Link
                href={`/character/${party.chair.sequentialId ?? party.chair.id}`}
                className="flex min-w-0 items-center gap-2 text-muted hover:text-primary"
              >
                <Avatar
                  url={party.chair.avatarUrl}
                  name={party.chair.name}
                  size="h-7 w-7"
                  className="shrink-0 rounded-md"
                  borderKey={party.chair.borderKey}
                  tintColor={party.chair.tintColor}
                />
                <span className="truncate">Chair: {party.chair.name}</span>
              </Link>
            ) : (
              <span className="italic text-muted">Chair vacant</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <PositionLabel value={party.economicPosition} axis="economic" />
            <PositionLabel value={party.socialPosition} axis="social" />
          </div>
        </div>

        <Link
          href={`/country/${effectiveCountry}/parties/${party.id}`}
          className="mt-4 flex items-center justify-between rounded-lg border border-card-border bg-card-muted/30 px-3 py-2 text-body-sm font-semibold transition-colors hover:border-primary/40 hover:text-primary"
        >
          Open party headquarters <span aria-hidden>→</span>
        </Link>
      </div>
    </article>
  );
}
