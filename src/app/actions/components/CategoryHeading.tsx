"use client";

import { useCurrency } from "@/contexts/CurrencyContext";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS } from "../actionsConstants";

export interface DonorSummary {
  level: number;
  /** Already in campaign-treasury local face value; do not re-convert. */
  fundraiseYield: number;
  currency: CurrencyCode;
  /** Anchor units, formatted through the live currency like the old donor block. */
  upgradeCost: number;
}

/**
 * Heading for one category of operations. The Fundraising heading also carries
 * the donor network figures, since that is the section they drive.
 */
export default function CategoryHeading({
  category,
  count,
  donor,
}: {
  category: string;
  count: number;
  donor: DonorSummary | null;
}) {
  const { formatAmount } = useCurrency();
  return (
    <div className="flex flex-col gap-4 border-b border-card-border pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2
          id={`actions-${category}-title`}
          className="text-heading-lg font-semibold tracking-tight text-foreground"
        >
          {CATEGORY_LABELS[category] ?? category}
          <span className="ml-2 text-body font-normal tabular-nums text-muted">{count}</span>
        </h2>
        {CATEGORY_DESCRIPTIONS[category] && (
          <p className="mt-1 text-body text-muted">{CATEGORY_DESCRIPTIONS[category]}</p>
        )}
      </div>
      {donor && (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 sm:justify-end">
          <div>
            <dt className="text-body-sm text-muted">Donor level</dt>
            <dd className="text-body-lg font-semibold tabular-nums text-foreground">
              {donor.level}
            </dd>
          </div>
          <div>
            <dt className="text-body-sm text-muted">Each fundraise</dt>
            <dd className="text-body-lg font-semibold tabular-nums text-success">
              +{formatCurrencyFaceAmount(donor.fundraiseYield, donor.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-body-sm text-muted">Next level costs</dt>
            <dd className="text-body-lg font-semibold tabular-nums text-foreground">
              {formatAmount(donor.upgradeCost)}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
