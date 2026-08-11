"use client";

/**
 * Relevant Legislation panel (political-legislation spec §8): the metric's
 * primary law at its enacted level with its annual net and a propose link;
 * the secondaries that touch it beneath at reduced prominence.
 */

import Link from "next/link";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import type { MetricLegislationInfo } from "@/lib/politicalMetrics/queries/countryPoliticalMetrics";
import { formatLocalAmount } from "@/lib/utils/formatters";
import { legislatureUrl } from "@/lib/urls";

export function RelevantLegislationPanel({
  countryId,
  legislation,
}: {
  countryId: string;
  legislation: MetricLegislationInfo | null;
}) {
  const currency = COUNTRY_CURRENCY_MAP[countryId as CountryId];
  return (
    <div className="rounded-lg border border-card-border bg-card p-4 shadow-card">
      <div className="mb-2.5 font-mono text-body-xs uppercase tracking-widest text-muted">
        Relevant legislation
      </div>
      {!legislation || (!legislation.primary && legislation.secondaries.length === 0) ? (
        <div className="text-body-sm italic text-muted">None linked yet.</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {legislation.primary && (
            <div className="border-l-2 border-primary pl-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-body-sm font-semibold text-foreground">
                  {legislation.primary.title}
                </span>
                <span
                  className={`text-body-xs font-medium tabular-nums ${
                    legislation.primary.annualNet >= 0 ? "text-success" : "text-error"
                  }`}
                >
                  {legislation.primary.annualNet >= 0 ? "+" : "−"}
                  {currency
                    ? formatLocalAmount(Math.abs(legislation.primary.annualNet), currency)
                    : Math.abs(legislation.primary.annualNet).toLocaleString("en-US")}
                  /yr
                </span>
              </div>
              <div className="mt-0.5 text-body-xs text-muted">
                Enacted: {legislation.primary.levelName || `Level ${legislation.primary.level}`} ·{" "}
                <Link
                  href={legislatureUrl(countryId)}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  Propose a change
                </Link>
              </div>
            </div>
          )}
          {legislation.secondaries.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-dashed border-card-border pt-2">
              {legislation.secondaries.map((secondary) => (
                <div
                  key={secondary.lawId}
                  className="flex items-baseline justify-between gap-3 text-body-xs text-muted"
                >
                  <span>{secondary.title}</span>
                  <span className="shrink-0">
                    {secondary.levelName || `Level ${secondary.level}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
