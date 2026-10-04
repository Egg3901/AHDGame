"use client";

/**
 * Relevant legislation (political-legislation spec §8): the metric's primary
 * law at its enacted level with its annual net and a propose link, and the
 * secondaries that touch it beneath at reduced prominence.
 */

import Link from "next/link";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import type { MetricLegislationInfo } from "@/lib/politicalMetrics/queries/countryPoliticalMetrics";
import { formatLocalAmount } from "@/lib/utils/formatters";
import { legislatureUrl } from "@/lib/urls";

const MINUS = "−";

export function RelevantLegislationPanel({
  countryId,
  legislation,
}: {
  countryId: string;
  legislation: MetricLegislationInfo | null;
}) {
  const currency = COUNTRY_CURRENCY_MAP[countryId as CountryId];
  return (
    <section aria-labelledby="pm-metric-legislation">
      <h3 id="pm-metric-legislation" className="text-heading-sm font-semibold text-foreground">
        Relevant legislation
      </h3>
      {!legislation || (!legislation.primary && legislation.secondaries.length === 0) ? (
        <p className="mt-2 text-body text-muted">None linked yet.</p>
      ) : (
        <div className="mt-3 flex max-w-2xl flex-col gap-3">
          {legislation.primary && (
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <span className="text-body-lg font-semibold text-foreground">
                  {legislation.primary.title}
                </span>
                <span
                  className={`text-body font-medium tabular-nums ${
                    legislation.primary.annualNet >= 0 ? "text-success" : "text-error"
                  }`}
                >
                  {legislation.primary.annualNet >= 0 ? "+" : MINUS}
                  {currency
                    ? formatLocalAmount(Math.abs(legislation.primary.annualNet), currency)
                    : Math.abs(legislation.primary.annualNet).toLocaleString("en-US")}
                  /yr
                </span>
              </div>
              <p className="mt-0.5 text-body text-muted">
                Enacted: {legislation.primary.levelName || `Level ${legislation.primary.level}`} ·{" "}
                <Link
                  href={legislatureUrl(countryId)}
                  className="font-medium text-foreground underline decoration-card-border underline-offset-4 transition-colors hover:decoration-foreground"
                >
                  Propose a change
                </Link>
              </p>
            </div>
          )}
          {legislation.secondaries.length > 0 && (
            <ul className="flex flex-col gap-1 border-t border-card-border/60 pt-2">
              {legislation.secondaries.map((secondary) => (
                <li
                  key={secondary.lawId}
                  className="flex items-baseline justify-between gap-3 text-body-sm text-muted"
                >
                  <span>{secondary.title}</span>
                  <span className="shrink-0">
                    {secondary.levelName || `Level ${secondary.level}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
