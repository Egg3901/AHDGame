"use client";

import { useCurrency } from "@/contexts/CurrencyContext";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import type { CurrencyCode } from "@/lib/constants/currencies";

interface DonorNetworkStatsProps {
  /** Already in campaign-treasury local face value; do not re-convert. */
  fundraiseAmount: number;
  fundraiseCurrency: CurrencyCode;
  donorUpgradeCost: number;
}

export default function DonorNetworkStats({
  fundraiseAmount,
  fundraiseCurrency,
  donorUpgradeCost,
}: DonorNetworkStatsProps) {
  const { formatAmount } = useCurrency();
  return (
    <section
      aria-labelledby="donor-network-title"
      className="flex flex-col gap-4 pt-4 sm:flex-row sm:items-end sm:justify-between"
    >
      <div>
        <h2
          id="donor-network-title"
          className="text-heading-lg font-semibold tracking-tight text-foreground"
        >
          Donor network
        </h2>
        <p className="mt-1 text-body text-muted">
          Expand your network to increase fundraising efficiency.
        </p>
      </div>

      <dl className="flex flex-wrap gap-x-10 gap-y-3 sm:justify-end">
        <div>
          <dt className="text-body-sm text-muted">Fundraise yield</dt>
          <dd className="text-heading font-semibold tabular-nums text-foreground">
            {formatCurrencyFaceAmount(fundraiseAmount, fundraiseCurrency)}
          </dd>
        </div>
        <div>
          <dt className="text-body-sm text-muted">Upgrade cost</dt>
          <dd className="text-heading font-semibold tabular-nums text-foreground">
            {formatAmount(donorUpgradeCost)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
