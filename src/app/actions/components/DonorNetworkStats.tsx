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
    <div className="rounded-xl border border-card-border bg-card p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-foreground">Donor Network Analytics</h3>
          <p className="text-sm text-muted">
            Expand your network to increase fundraising efficiency.
          </p>
        </div>

        <div className="flex items-center gap-8">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted font-bold">
              Fundraise Yield
            </div>
            <div className="text-xl font-bold text-green-400 tabular-nums">
              {formatCurrencyFaceAmount(fundraiseAmount, fundraiseCurrency)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted font-bold">
              Upgrade Cost
            </div>
            <div className="text-xl font-bold text-foreground tabular-nums">
              {formatAmount(donorUpgradeCost)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
