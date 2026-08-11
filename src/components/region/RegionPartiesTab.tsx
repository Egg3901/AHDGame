"use client";

import { useState } from "react";
import Link from "next/link";
import type { CountryId } from "@/lib/constants/countries";
import { getOrgLabel } from "@/lib/utils/partyOrg";
import { PartyLogo } from "@/components/PartyLogo";
import { regionPartyUrl } from "@/lib/urls";
import type { PartyOrgDisplay } from "@/components/state/StatePageTabsTypes";

/**
 * Country-specific customization knobs for the shared region parties tab.
 * All fields are optional with sensible defaults so a country wanting the
 * vanilla view can pass nothing at all.
 */
export interface RegionPartiesTabConfig {
  /** Heading shown above the description. Defaults to "Party Organizations in {regionName}". */
  headingLabel?: string;
  /** Description paragraph beneath the heading. Defaults to generic copy. */
  description?: string;
  /** Word used for "region" in fallback copy (e.g. "state", "Land"). Defaults to "region". */
  regionNoun?: string;
  /**
   * Optional flavor text shown at the bottom of each top-3 party card. Returning
   * null skips the flavor row. Used by US to surface major-vs-third-party copy
   * driven by state lean; other countries can omit.
   */
  partyFlavor?: (party: PartyOrgDisplay) => string | null;
  /**
   * Optional sort override for the parties array. Defaults to descending Org%.
   * US uses this to float Democrat/Republican to the top of the list.
   */
  sortComparator?: (a: PartyOrgDisplay, b: PartyOrgDisplay) => number;
  /** Extra hint shown in the empty state. */
  emptyStateHint?: string;
  /** Empty-state CTA link (href + label). */
  emptyStateLink?: { href: string; label: string };
}

interface RegionPartiesTabProps {
  /** Country that owns the region (drives URL building). */
  countryId: CountryId;
  /** Stable region identifier — DB _id for US states, constants id for UK regions. */
  regionId: string;
  /** Display name shown in headings and copy. */
  regionName: string;
  /** Party org rows for this region. */
  partyOrg: PartyOrgDisplay[];
  /** Country-specific customizations. */
  config?: RegionPartiesTabConfig;
}

function OrgDonut({ value, color }: { value: number; color: string }) {
  const size = 64;
  const strokeWidth = 8;
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;
  const filledDash = (value / 100) * circ;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-card-elevated"
      />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${filledDash} ${circ - filledDash}`}
        strokeLinecap="butt"
      />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fontSize: 14,
          fontWeight: 700,
          fill: "currentColor",
          transform: "rotate(90deg)",
          transformOrigin: `${cx}px ${cy}px`,
        }}
      >
        {Math.round(value)}
      </text>
    </svg>
  );
}

interface PartyCardProps {
  party: PartyOrgDisplay;
  countryId: CountryId;
  regionId: string;
  flavor: string | null;
}

function PartyCard({ party, countryId, regionId, flavor }: PartyCardProps) {
  const orgLabel = getOrgLabel(party.organization);

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div
        className="px-4 py-3"
        style={{
          backgroundColor: `${party.partyColor}20`,
          borderBottom: `3px solid ${party.partyColor}`,
        }}
      >
        <div className="flex items-center gap-3">
          <PartyLogo
            partyId={party.partyId}
            partyColor={party.partyColor}
            size="h-4 w-4"
            countryId={party.countryId}
          />
          <div>
            <Link
              href={regionPartyUrl(countryId, regionId, party.partyId)}
              className="font-semibold hover:text-primary transition-colors"
            >
              {party.partyName}
            </Link>
            <div className="text-xs text-muted">{party.partyAbbreviation}</div>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-4">
          <OrgDonut value={party.organization} color={party.partyColor} />
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Organization</span>
              <div className="flex items-center gap-1.5">
                <span className={`text-lg font-bold leading-none ${orgLabel.color}`}>
                  {party.organization.toFixed(1)}%
                </span>
                <span className={`text-xs ${orgLabel.color}`}>{orgLabel.label}</span>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-card-elevated overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, Math.max(0, party.organization))}%`,
                  backgroundColor: party.partyColor,
                }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">Chair</span>
          {party.chairName && party.chairCharacterId ? (
            <Link
              href={`/character/${party.chairCharacterId}`}
              className="font-medium hover:text-primary transition-colors"
            >
              {party.chairName} →
            </Link>
          ) : (
            <span className="text-muted italic">Vacant</span>
          )}
        </div>

        {flavor && (
          <div className="pt-3 border-t border-card-border">
            <p className="text-[11px] text-muted/70 leading-relaxed italic">{flavor}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AccordionToggle({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-muted hover:text-foreground hover:bg-card-elevated transition-colors"
    >
      <span>{label}</span>
      <svg
        className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

export function RegionPartiesTab({
  countryId,
  regionId,
  regionName,
  partyOrg,
  config = {},
}: RegionPartiesTabProps) {
  const [showAllOrg, setShowAllOrg] = useState(false);
  const [showNoOrg, setShowNoOrg] = useState(false);

  const regionNoun = config.regionNoun ?? "region";
  const heading = config.headingLabel ?? `Party Organizations in ${regionName}`;
  const description =
    config.description ??
    `Party organization reflects each party's share of the ${regionNoun} Org pool. Org decays passively each turn; spend Political Strength on Build Org to push it back up.`;

  if (partyOrg.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6">
        <div className="py-12 text-center text-muted">
          <svg
            className="mx-auto h-12 w-12 mb-4 opacity-50"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"
            />
          </svg>
          <p className="font-medium">No party organizations in this {regionNoun}</p>
          {config.emptyStateHint && <p className="text-sm mt-1">{config.emptyStateHint}</p>}
          {config.emptyStateLink && (
            <Link
              href={config.emptyStateLink.href}
              className="mt-4 inline-block text-sm text-primary hover:text-primary/80 transition-colors"
            >
              {config.emptyStateLink.label}
            </Link>
          )}
        </div>
      </div>
    );
  }

  const comparator =
    config.sortComparator ??
    ((a: PartyOrgDisplay, b: PartyOrgDisplay) => b.organization - a.organization);
  const sorted = [...partyOrg].sort(comparator);
  const withOrg = sorted.filter((p) => p.organization > 0);
  const withoutOrg = sorted.filter((p) => p.organization === 0);
  const top3 = withOrg.slice(0, 3);
  const hasMore = withOrg.length > 3;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-card-border bg-card p-5">
        <div className="flex items-center gap-2.5 mb-2">
          <svg
            className="h-5 w-5 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
            />
          </svg>
          <h2 className="text-lg font-semibold">{heading}</h2>
        </div>
        <p className="text-sm text-muted leading-relaxed">{description}</p>
      </div>

      {top3.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-3">
          {top3.map((party) => (
            <PartyCard
              key={party._id}
              party={party}
              countryId={countryId}
              regionId={regionId}
              flavor={config.partyFlavor ? config.partyFlavor(party) : null}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted px-1">
          No parties have active organization in this {regionNoun}.
        </p>
      )}

      {hasMore && (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          <AccordionToggle
            label={`All ${withOrg.length} parties with organization`}
            open={showAllOrg}
            onToggle={() => setShowAllOrg((v) => !v)}
          />
          {showAllOrg && (
            <div className="px-4 pb-4 pt-1 grid gap-4 md:grid-cols-3 border-t border-card-border">
              {withOrg.map((party) => (
                <PartyCard
                  key={party._id}
                  party={party}
                  countryId={countryId}
                  regionId={regionId}
                  flavor={config.partyFlavor ? config.partyFlavor(party) : null}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {withoutOrg.length > 0 && (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          <AccordionToggle
            label={`${withoutOrg.length} ${withoutOrg.length === 1 ? "party" : "parties"} without active organization`}
            open={showNoOrg}
            onToggle={() => setShowNoOrg((v) => !v)}
          />
          {showNoOrg && (
            <div className="border-t border-card-border divide-y divide-card-border/50">
              {withoutOrg.map((party) => (
                <div key={party._id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <PartyLogo
                      partyId={party.partyId}
                      partyColor={party.partyColor}
                      size="h-4 w-4"
                      countryId={party.countryId}
                    />
                    <Link
                      href={regionPartyUrl(countryId, regionId, party.partyId)}
                      className="text-sm font-medium hover:text-primary transition-colors"
                    >
                      {party.partyName}
                    </Link>
                    <span className="text-xs text-muted">{party.partyAbbreviation}</span>
                  </div>
                  <span className="text-xs text-muted">No organization</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
