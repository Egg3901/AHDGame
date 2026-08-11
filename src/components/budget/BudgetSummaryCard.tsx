"use client";

import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";

interface BudgetSummaryCardProps {
  label: string;
  value: number;
  trend?: number;
  variant?: "default" | "surplus" | "deficit";
  currencyCode?: string;
  /** Country ID — used to derive currency when currencyCode is not available */
  countryId?: string;
}

export function BudgetSummaryCard({
  label,
  value,
  trend,
  variant = "default",
  currencyCode,
  countryId,
}: BudgetSummaryCardProps) {
  const prefix = getCurrencyPrefix(countryId, currencyCode);

  const formatMoney = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 1e12) return `${prefix}${(n / 1e12).toFixed(1)}T`;
    if (abs >= 1e9) return `${prefix}${(n / 1e9).toFixed(1)}B`;
    return `${prefix}${(n / 1e6).toFixed(1)}M`;
  };

  const variantStyles = {
    default: "bg-card border-card-border",
    surplus: "bg-success/10 border-success/30",
    deficit: "bg-error/10 border-error/30",
  };

  const valueStyles = {
    default: "text-foreground",
    surplus: "text-success",
    deficit: "text-error",
  };

  return (
    <div className={`rounded-xl border p-4 ${variantStyles[variant]}`}>
      <p className="text-sm text-muted mb-1">{label}</p>
      <p className={`text-2xl font-bold ${valueStyles[variant]}`}>{formatMoney(value)}</p>
      {trend !== undefined && (
        <p className={`text-xs mt-1 ${trend >= 0 ? "text-success" : "text-error"}`}>
          {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}%
        </p>
      )}
    </div>
  );
}
