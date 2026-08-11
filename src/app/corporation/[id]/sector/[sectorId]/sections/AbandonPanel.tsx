"use client";

import { useCurrency } from "@/contexts/CurrencyContext";
import type { SectorData, Financials, CorporationRef } from "../types";
import type { CurrencyCode } from "@/lib/constants/currencies";

interface AbandonPanelProps {
  sector: SectorData;
  financials: Financials | null;
  corporation: CorporationRef;
  abandonConfirm: boolean;
  abandoning: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onShowConfirm: () => void;
}

export default function AbandonPanel({
  sector,
  financials,
  corporation,
  abandonConfirm,
  abandoning,
  onConfirm,
  onCancel,
  onShowConfirm,
}: AbandonPanelProps) {
  const { formatAmount, toInternalFrom } = useCurrency();
  const liquidCode = (corporation.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
  const fmtMoney = (value: number) =>
    formatAmount(liquidCode ? toInternalFrom(value, liquidCode) : value, liquidCode);
  if (!abandonConfirm) {
    return (
      <div className="rounded-xl border border-error/20 bg-error/5 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-error">Abandon Sector</h3>
            <p className="text-xs text-muted mt-0.5">
              Revenue returns to the unowned pool. This cannot be undone.
            </p>
          </div>
          <button
            onClick={onShowConfirm}
            className="rounded-lg border border-error/30 bg-error/10 px-4 py-2 text-sm font-medium text-error transition-colors hover:bg-error/20"
          >
            Abandon
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-error/20 bg-error/5 p-6">
      <div className="space-y-3">
        <p className="text-sm text-error font-medium">
          Abandon {sector.sectorLabel} in {sector.stateName}?
        </p>
        <p className="text-xs text-muted">
          {financials
            ? `${fmtMoney(financials.revenue)}/day in revenue will return to the unowned pool.`
            : "Are you sure? This cannot be undone."}
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={onConfirm}
            disabled={abandoning}
            className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-error/90 disabled:opacity-50"
          >
            {abandoning ? "Abandoning..." : "Confirm Abandon"}
          </button>
          <button
            onClick={onCancel}
            disabled={abandoning}
            className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
