"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";

type HolderRow = {
  holderKind: string;
  holderId: string;
  displayName: string;
  units: number;
  avgNavAnchor: number | null;
  marketValueAnchor: number | null;
  countryId?: string;
  party?: string;
};

type HoldersResponse = {
  holders: HolderRow[];
  byKind: {
    players: HolderRow[];
    npps: HolderRow[];
    imperial: HolderRow[];
    reserve: HolderRow[];
  };
  queuedRedemptions: {
    units: number;
    requestedAmountAnchor: number;
    status: string;
  }[];
};

interface FundSubscribersTabProps {
  fundId: string;
  anchorCurrencyCode: string;
}

export default function FundSubscribersTab({
  fundId,
  anchorCurrencyCode,
}: FundSubscribersTabProps) {
  const { formatAmount } = useCurrency();
  const [data, setData] = useState<HoldersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const ccy = anchorCurrencyCode as CurrencyCode;

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/investment-funds/${fundId}/holders`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json) setData(json as HoldersResponse);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fundId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-center text-muted">
        Failed to load subscribers.
      </div>
    );
  }

  const { byKind, queuedRedemptions } = data;

  return (
    <div className="space-y-6">
      {queuedRedemptions.length > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
          {queuedRedemptions.length} queued redemption
          {queuedRedemptions.length === 1 ? "" : "s"} awaiting fund cash (
          {formatAmount(
            queuedRedemptions.reduce((s, q) => s + q.requestedAmountAnchor, 0),
            ccy
          )}{" "}
          total).
        </div>
      )}

      {byKind.players.length > 0 && (
        <HolderTable
          title="Player subscribers"
          rows={byKind.players}
          ccy={ccy}
          formatAmount={formatAmount}
        />
      )}

      {byKind.imperial.length > 0 && (
        <HolderTable
          title="Imperial holders"
          rows={byKind.imperial}
          ccy={ccy}
          formatAmount={formatAmount}
        />
      )}

      {byKind.reserve.length > 0 && (
        <HolderTable
          title="Fund reserve"
          rows={byKind.reserve}
          ccy={ccy}
          formatAmount={formatAmount}
        />
      )}

      {byKind.players.length === 0 &&
        byKind.imperial.length === 0 &&
        byKind.reserve.length === 0 && (
          <div className="rounded-xl border border-card-border bg-card p-6 text-center text-muted">
            No subscribers yet.
          </div>
        )}
    </div>
  );
}

function HolderTable({
  title,
  rows,
  ccy,
  formatAmount,
}: {
  title: string;
  rows: HolderRow[];
  ccy: CurrencyCode;
  formatAmount: (n: number, c?: CurrencyCode) => string;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
      <div className="bg-card-elevated px-4 py-3 border-b border-card-border">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-muted border-b border-card-border">
            <tr>
              <th className="px-4 py-2">Holder</th>
              <th className="px-4 py-2 text-right">Units</th>
              <th className="px-4 py-2 text-right">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {rows.map((row) => (
              <tr key={`${row.holderKind}-${row.holderId}`}>
                <td className="px-4 py-2.5">
                  <span className="font-medium">{row.displayName}</span>
                  {row.party && <span className="ml-2 text-xs text-muted">({row.party})</span>}
                  {row.countryId && (
                    <span className="ml-1 text-[10px] text-muted uppercase">{row.countryId}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {row.units.toLocaleString("en-US")}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatAmount(row.marketValueAnchor ?? 0, ccy)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
