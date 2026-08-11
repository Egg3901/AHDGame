"use client";

import Link from "next/link";
import { HeroImage } from "@/components/HeroImage";
import { Tooltip } from "@/components/Tooltip";
import { Button, HeroStatsStrip } from "@/components/ui";
import { Party } from "../partiesTypes";
import { partiesUrl } from "@/lib/urls";

interface PartiesHeaderProps {
  effectiveCountry: string;
  parties: Party[];
  canShowCreateButton: boolean;
  onCreatePartyClick: () => void;
  activeTab: "parties" | "coalitions";
  onTabChange: (tab: "parties" | "coalitions") => void;
  isNationalChair: boolean;
  isInCoalition: boolean;
  onCreateCoalitionClick: () => void;
  enabledCountries?: { id: string; name: string }[];
}

export function PartiesHeader({
  effectiveCountry,
  parties,
  canShowCreateButton,
  onCreatePartyClick,
  activeTab,
  onTabChange,
  isNationalChair,
  isInCoalition,
  onCreateCoalitionClick,
  enabledCountries = [],
}: PartiesHeaderProps) {
  const totalMembers = parties.reduce((sum, party) => sum + party.memberCount, 0);
  const largestParty = [...parties].sort((a, b) => b.memberCount - a.memberCount)[0];

  return (
    <header className="mb-6 overflow-hidden rounded-xl border border-card-border bg-card shadow-panel">
      <div className="relative min-h-52 sm:min-h-60">
        <HeroImage
          src="/api/images/hero/parties"
          alt="A national political convention floor"
          fill
          className="object-cover object-center"
          sizes="(max-width: 1280px) 100vw, 1280px"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/20" />
        <div className="relative flex min-h-52 flex-col justify-between gap-8 p-5 sm:min-h-60 sm:p-7">
          <nav aria-label="Country parties" className="flex max-w-full gap-1 overflow-x-auto pb-1">
            {enabledCountries.map((country) => (
              <Link
                key={country.id}
                href={partiesUrl(country.id)}
                className={`shrink-0 rounded-lg border px-3 py-1.5 text-body-sm font-semibold transition-colors ${
                  effectiveCountry === country.id
                    ? "border-primary/50 bg-primary/20 text-foreground"
                    : "border-card-border bg-card/80 text-muted hover:text-foreground"
                }`}
              >
                {country.name}
              </Link>
            ))}
          </nav>
          <div className="max-w-2xl">
            <p className="mb-1 text-body-xs font-bold uppercase tracking-widest text-primary">
              Balance of power
            </p>
            <h1 data-coach="nav-parties" className="text-display font-extrabold tracking-tight">
              Political Parties
            </h1>
            <p className="mt-2 text-body text-foreground/80 sm:text-body-lg">
              Compare national strength, track momentum, and find the allies who can move the
              country.
            </p>
          </div>
        </div>
      </div>

      <HeroStatsStrip layout="grid">
        <div className="px-4 py-3">
          <span className="block text-body-xs uppercase tracking-widest text-muted">Parties</span>
          <span className="text-heading font-bold tabular-nums">{parties.length}</span>
        </div>
        <div className="min-w-0 px-4 py-3">
          <span className="block text-body-xs uppercase tracking-widest text-muted">Largest</span>
          <span className="block truncate text-heading font-bold">
            {largestParty?.abbreviation ?? "—"}
          </span>
        </div>
        <div className="px-4 py-3">
          <span className="block text-body-xs uppercase tracking-widest text-muted">Members</span>
          <span className="text-heading font-bold tabular-nums">
            {totalMembers.toLocaleString("en-US")}
          </span>
        </div>
      </HeroStatsStrip>

      <div className="flex flex-col gap-3 border-t border-card-border p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-2 rounded-lg border border-card-border bg-background p-1">
          {(["parties", "coalitions"] as const).map((tab) => (
            <Tooltip
              key={tab}
              content={
                tab === "parties" ? "Browse party strength and platforms" : "View alliance blocs"
              }
            >
              <button
                type="button"
                onClick={() => onTabChange(tab)}
                aria-pressed={activeTab === tab}
                className={`rounded-md px-4 py-2 text-body-sm font-semibold capitalize transition-colors ${
                  activeTab === tab
                    ? "bg-card-elevated text-foreground shadow-card"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {tab}
              </button>
            </Tooltip>
          ))}
        </div>

        {canShowCreateButton && (
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Tooltip
              content={
                !isNationalChair
                  ? "Only national party chairs can create coalitions"
                  : isInCoalition
                    ? "Your party is already in a coalition"
                    : "Create a new alliance bloc"
              }
            >
              <span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onCreateCoalitionClick}
                  disabled={!isNationalChair || isInCoalition}
                  className="w-full"
                >
                  Create coalition
                </Button>
              </span>
            </Tooltip>
            <Button size="sm" onClick={onCreatePartyClick} className="w-full">
              Create party
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
