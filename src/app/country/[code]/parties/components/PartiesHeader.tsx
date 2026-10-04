"use client";

import Link from "next/link";
import { HeroImage } from "@/components/HeroImage";
import { Tooltip } from "@/components/Tooltip";
import { Button } from "@/components/ui";
import {
  PARTY_LABEL_CLASS,
  PARTY_PAGE_TITLE_CLASS,
  PARTY_VALUE_CLASS,
  partyTabClass,
} from "@/components/party/partyPageStyles";
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

const TAB_LABELS: Record<"parties" | "coalitions", string> = {
  parties: "Parties",
  coalitions: "Coalitions",
};

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
    <header className="mb-12 overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="relative min-h-52 sm:min-h-60">
        <HeroImage
          src="/api/images/hero/parties"
          alt="A national political convention floor"
          fill
          className="object-cover object-center"
          sizes="(max-width: 1280px) 100vw, 1280px"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/75 to-card/20" />
        <div className="relative flex min-h-52 flex-col justify-between gap-8 p-5 sm:min-h-60 sm:p-7">
          {/* Wraps instead of scrolling, so no country is hidden past the edge on a phone. */}
          <nav aria-label="Country parties" className="flex flex-wrap gap-1.5">
            {enabledCountries.map((country) => {
              const active = effectiveCountry === country.id;
              return (
                <Link
                  key={country.id}
                  href={partiesUrl(country.id)}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md border px-3 py-1.5 text-body-sm font-medium transition-colors ${
                    active
                      ? "border-foreground/40 bg-card text-foreground"
                      : "border-card-border bg-card/80 text-muted hover:text-foreground"
                  }`}
                >
                  {country.name}
                </Link>
              );
            })}
          </nav>
          <div className="max-w-2xl">
            <h1 data-coach="nav-parties" className={PARTY_PAGE_TITLE_CLASS}>
              Political parties
            </h1>
            <p className="mt-2 text-body text-foreground/80 sm:text-body-lg">
              Every party in the country, ranked by membership, with its treasury, its chair and
              last turn&apos;s change in members.
            </p>
          </div>
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-10 gap-y-3 border-t border-card-border px-5 py-4 sm:px-7">
        <div>
          <dt className={PARTY_LABEL_CLASS}>Parties</dt>
          <dd className={PARTY_VALUE_CLASS}>{parties.length}</dd>
        </div>
        <div className="min-w-0">
          <dt className={PARTY_LABEL_CLASS}>Largest</dt>
          <dd className={`truncate ${PARTY_VALUE_CLASS}`}>
            {largestParty?.abbreviation ?? "None"}
          </dd>
        </div>
        <div>
          <dt className={PARTY_LABEL_CLASS}>Members</dt>
          <dd className={PARTY_VALUE_CLASS}>{totalMembers.toLocaleString("en-US")}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-3 border-t border-card-border px-5 sm:flex-row sm:items-end sm:justify-between sm:px-7">
        <div className="flex gap-6">
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
                className={partyTabClass(activeTab === tab)}
              >
                {TAB_LABELS[tab]}
              </button>
            </Tooltip>
          ))}
        </div>

        {canShowCreateButton && (
          <div className="grid grid-cols-2 gap-2 pb-4 sm:flex sm:py-2">
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
