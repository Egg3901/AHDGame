"use client";

import type { ReactNode } from "react";
import { HeroImage } from "@/components/HeroImage";
import type { InstitutionIdentity } from "@/lib/constants/institutionIdentity";

/**
 * The central bank's header band: the page's one surface change. The bank's
 * photo when it has one, then the bank's name as a plain title with its
 * registry line and chair beneath, the prime rate on the right, and a row of
 * figures along the bottom edge.
 *
 * A plain counterpart of the shared `InstitutionMasthead`, which the
 * executive, policy and trade pages keep: no brand gradient, seal or gold
 * accent lines here.
 */
export function CentralBankHeader({
  identity,
  heroImage,
  details,
  primeRate,
  figures,
}: {
  identity: InstitutionIdentity;
  heroImage?: { src: string; alt: string } | null;
  /** Chair, term and intervention status, as one line of text under the title. */
  details?: ReactNode;
  primeRate: string;
  /** The figures row along the bottom of the band. */
  figures: ReactNode;
}) {
  return (
    <header className="overflow-hidden rounded-xl border border-card-border bg-card">
      {heroImage && (
        <div className="relative h-[110px] w-full sm:h-[160px]">
          <HeroImage
            src={heroImage.src}
            alt={heroImage.alt}
            fill
            className="object-cover object-center"
            sizes="(max-width: 1280px) 100vw, 1280px"
            priority
          />
        </div>
      )}

      <div className="flex flex-col gap-4 px-5 pt-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h1 className="break-words text-display font-bold tracking-tight text-foreground sm:text-[2.25rem] sm:leading-tight">
            {identity.title}
            {identity.titleEn && (
              <span className="ml-3 align-middle text-heading font-semibold text-muted">
                {identity.titleEn}
              </span>
            )}
          </h1>
          <p className="mt-1 text-body text-muted">{identity.registry}</p>
          {details && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-foreground">
              {details}
            </div>
          )}
        </div>
        <div className="shrink-0 sm:text-right">
          <div className="text-body-sm text-muted">Prime rate</div>
          <div className="text-heading-lg font-semibold tabular-nums text-foreground">
            {primeRate}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-card-border px-5 py-4 sm:grid-cols-3 sm:px-6">
        {figures}
      </div>
    </header>
  );
}
