"use client";

import { positionBucketHex } from "@/lib/utils/politics";
import type { NationalAxes } from "@/lib/policy/nationalAxes";
import { dominantAxis, getDomainLabel } from "./policyView";

const EUROPEAN_COLOUR_COUNTRIES = new Set(["UK", "DE"]);

export interface RailDomain {
  domain: string;
  count: number;
  axes: NationalAxes;
}

/**
 * Sticky Titles rail (Bold composite): each domain row carries an R4
 * diverging mini-tick of its lean — scanning the rail gives an instant read
 * of where the country's law tilts, domain by domain. Domains and averages
 * come strictly from grouped records (never a hardcoded list); axis-less
 * domains render a muted "—", not a fake zero.
 */
export function TitlesRail({
  countryId,
  domains,
  activeDomain,
  onSelect,
}: {
  countryId: string;
  domains: RailDomain[];
  activeDomain: string | null;
  onSelect: (domain: string) => void;
}) {
  return (
    <nav
      aria-label="Titles"
      className="flex gap-1.5 overflow-x-auto rounded-xl border border-card-border bg-card p-1.5 lg:sticky lg:top-24 lg:block lg:gap-0 lg:self-start lg:overflow-visible lg:p-0"
    >
      <div className="hidden border-b border-card-border bg-card-muted px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-muted lg:block">
        Titles
      </div>
      {domains.map(({ domain, axes }) => {
        const lean = dominantAxis(axes.economic, axes.social);
        const european = lean?.axis === "economic" && EUROPEAN_COLOUR_COUNTRIES.has(countryId);
        const active = activeDomain === domain;
        return (
          <button
            key={domain}
            type="button"
            onClick={() => onSelect(domain)}
            aria-current={active ? "true" : undefined}
            className={`flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors lg:w-full lg:rounded-none lg:border-l-2 lg:px-4 ${
              active
                ? "bg-primary/10 text-foreground lg:border-primary lg:bg-primary/5"
                : "text-muted hover:bg-card-elevated/40 hover:text-foreground lg:border-transparent"
            }`}
          >
            <span className="truncate">{getDomainLabel(domain)}</span>
            {lean ? (
              <span
                className="font-mono text-[10px] font-semibold"
                // Bucket ramp hex — the established chart-colour exception.
                style={{ color: positionBucketHex(lean.value, lean.axis, european) }}
              >
                {lean.value > 0 ? "+" : ""}
                {lean.value.toFixed(1)}
              </span>
            ) : (
              <span className="font-mono text-[10px] text-muted/50">—</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
